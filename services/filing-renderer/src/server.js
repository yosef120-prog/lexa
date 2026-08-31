import { createServer } from "node:http";
import { buildFiling, PART_LIMIT_BYTES } from "./build.js";
import { createRest, verifyToken } from "./supabase-rest.js";

const PORT = process.env.PORT || 8080;
const BUCKET = "matter-documents";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.trim();
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
// Public by design, and the right key for identifying a caller: knowing who
// someone is needs no privilege.
const PUBLISHABLE_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");

// The secret key lives here and nowhere else. This process is the only
// component allowed past row level security, and it earns that by checking the
// caller's own membership before it reads anything.
const db = createRest({ url: SUPABASE_URL, key: requiredEnv("SUPABASE_SERVICE_ROLE_KEY") });

const HEBREW_ORDINALS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
  "יא", "יב", "יג", "יד", "טו", "טז", "יז", "יח", "יט", "כ"];

function appendixLabel(position) {
  const letter = HEBREW_ORDINALS[position - 1];
  return letter ? `נספח ${letter}׳` : `נספח ${position}`;
}

const BUNDLE_SELECT = [
  "id", "org_id", "matter_id", "title", "main_document_id", "status",
  "matter:matters(name,court,court_case_no,client:clients(name))",
  "org:organizations(name)",
  "main:documents!filing_bundles_main_document_id_fkey(storage_path,filename)",
  "items:filing_bundle_items(position,document:documents(storage_path,filename))",
].join(",");

function one(value) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function render(bundleId) {
  const bundle = await db.selectOne(
    "filing_bundles",
    `id=eq.${bundleId}&select=${encodeURIComponent(BUNDLE_SELECT)}`,
  );
  if (!bundle) throw new Error("ההגשה לא נמצאה");

  await db.update("filing_bundles", `id=eq.${bundleId}`, {
    status: "building",
    error: null,
    updated_at: new Date().toISOString(),
  });

  try {
    const matter = one(bundle.matter);
    const main = one(bundle.main);
    const items = [...(bundle.items ?? [])].sort((a, b) => a.position - b.position);

    const appendices = [];
    for (const item of items) {
      const doc = one(item.document);
      appendices.push({
        label: appendixLabel(item.position),
        name: doc.filename,
        bytes: await db.downloadObject(BUCKET, doc.storage_path),
      });
    }

    const parts = await buildFiling({
      cover: {
        title: bundle.title,
        firmName: one(bundle.org)?.name,
        matterName: matter?.name,
        clientName: one(matter?.client)?.name,
        court: matter?.court,
        caseNumber: matter?.court_case_no,
        date: new Date().toLocaleDateString("he-IL"),
      },
      main: main ? await db.downloadObject(BUCKET, main.storage_path) : null,
      appendices,
    });

    // Each part is filed as its own document, so a split filing arrives as a set
    // the lawyer uploads one by one rather than a file they must divide.
    const group = crypto.randomUUID();
    let firstId = null;

    for (const [index, bytes] of parts.entries()) {
      const suffix = parts.length > 1 ? ` (חלק ${index + 1} מתוך ${parts.length})` : "";
      const path = `${bundle.org_id}/${bundle.matter_id}/${crypto.randomUUID()}`;

      await db.uploadObject(BUCKET, path, bytes, "application/pdf");

      const row = await db.insert(
        "documents",
        {
          org_id: bundle.org_id,
          matter_id: bundle.matter_id,
          storage_path: path,
          filename: `${bundle.title}${suffix}.pdf`,
          mime: "application/pdf",
          size_bytes: bytes.byteLength,
          version_group_id: group,
        },
        { returning: true },
      );
      firstId ??= row?.id ?? null;
    }

    await db.update("filing_bundles", `id=eq.${bundleId}`, {
      status: "ready",
      output_document_id: firstId,
      page_count: parts.length,
      error: null,
      updated_at: new Date().toISOString(),
    });

    return { ok: true, parts: parts.length };
  } catch (error) {
    // Written where the lawyer will look for it, not only into a log nobody
    // opens.
    try {
      await db.update("filing_bundles", `id=eq.${bundleId}`, {
        status: "failed",
        error: error.message.slice(0, 500),
        updated_at: new Date().toISOString(),
      });
    } catch {
      // The original failure is the one worth reporting.
    }
    throw error;
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "3600",
};

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, limitBytes: PART_LIMIT_BYTES });
  }

  if (req.method !== "POST" || !req.url.startsWith("/build")) {
    return send(404, { error: "Not found" });
  }

  const userId = await verifyToken({
    url: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    authHeader: req.headers.authorization,
  });
  if (!userId) return send(401, { error: "Unauthorized" });

  let payload = "";
  for await (const chunk of req) payload += chunk;

  let bundleId;
  try {
    bundleId = JSON.parse(payload).bundleId;
  } catch {
    return send(400, { error: "Invalid JSON" });
  }
  if (!bundleId) return send(400, { error: "bundleId is required" });

  try {
    // Checked before any work, so a stranger asking for someone else's filing
    // is refused rather than served.
    const owner = await db.selectOne("filing_bundles", `id=eq.${bundleId}&select=org_id`);
    if (!owner) return send(404, { error: "Not found" });

    const membership = await db.selectOne(
      "org_members",
      `org_id=eq.${owner.org_id}&user_id=eq.${userId}&status=eq.active&select=user_id`,
    );
    if (!membership) return send(403, { error: "Forbidden" });

    return send(200, await render(bundleId));
  } catch (error) {
    console.error("render failed", error);
    return send(500, { error: error.message });
  }
}).listen(PORT, async () => {
  console.log(`filing renderer listening on ${PORT}`);

  // Says at startup whether this container can reach Supabase and whether the
  // secret key is accepted, so a later failure is a change rather than a
  // mystery.
  try {
    await db.select("organizations", "select=id&limit=1");
    console.log("supabase: reachable, key accepted");
  } catch (error) {
    console.error(`supabase: ${error.message}`);
  }
});
