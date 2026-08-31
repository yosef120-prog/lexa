import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { buildFiling, PART_LIMIT_BYTES } from "./build.js";

const PORT = process.env.PORT || 8080;
const BUCKET = "matter-documents";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
// Public by design, and the right key for this: checking who someone is needs
// no privilege at all. The secret key below is for reading their firm's data.
const PUBLISHABLE_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");

// The service role key lives here and nowhere else. This process is the only
// component allowed to bypass row level security, and it earns that by checking
// the caller's own membership before it touches anything.
const supabase = createClient(SUPABASE_URL, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  // A stray newline from a secret or a copied value produces an invalid URL and
  // a fetch that fails with nothing useful attached.
  return value.trim();
}

/**
 * Node reports every network problem as "fetch failed" and hides the reason in
 * a nested cause. Unwrapping it is the difference between a diagnosable error
 * and a guess.
 */
function explain(error) {
  const parts = [];
  let current = error;
  while (current && parts.length < 4) {
    parts.push(current.code ? `${current.message} (${current.code})` : current.message);
    current = current.cause;
  }
  return parts.join(" ← ");
}

/**
 * Identifies the caller from their own Supabase token.
 *
 * A shared secret was the obvious design and the wrong one: the browser makes
 * this call, so the secret would ship to every user of the product. The user's
 * own JWT proves who they are, and membership is checked against the bundle
 * below — the same rule the database enforces, applied by the one component
 * that holds a key able to bypass it.
 */
async function callerId(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;

  // Asked of Supabase directly rather than through the admin client. The secret
  // key is not accepted on the auth endpoint, so verifying through a client
  // built with it fails every token -- which is exactly what it did.
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: authHeader },
    });
  } catch (error) {
    console.error("could not reach the auth endpoint", error);
    return null;
  }

  if (!res.ok) {
    console.warn(`token rejected by Supabase: ${res.status}`);
    return null;
  }

  const user = await res.json().catch(() => null);
  return user?.id ?? null;
}

async function isMemberOf(userId, orgId) {
  const { data } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !!data;
}

async function loadBundle(bundleId) {
  const { data, error } = await supabase
    .from("filing_bundles")
    .select(
      "id, org_id, matter_id, title, main_document_id, status, " +
        "matter:matters(name, court, court_case_no, client:clients(name)), " +
        "org:organizations(name), " +
        "main:documents!filing_bundles_main_document_id_fkey(storage_path, filename), " +
        "items:filing_bundle_items(position, document:documents(storage_path, filename))",
    )
    .eq("id", bundleId)
    .single();
  if (error) throw new Error(`bundle not found: ${error.message}`);
  return data;
}

async function download(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`cannot read ${path}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

const HEBREW_ORDINALS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
  "יא", "יב", "יג", "יד", "טו", "טז", "יז", "יח", "יט", "כ"];

function appendixLabel(position) {
  const letter = HEBREW_ORDINALS[position - 1];
  return letter ? `נספח ${letter}׳` : `נספח ${position}`;
}

async function render(bundleId) {
  const bundle = await loadBundle(bundleId);

  await supabase.from("filing_bundles")
    .update({ status: "building", error: null, updated_at: new Date().toISOString() })
    .eq("id", bundleId);

  try {
    const items = [...(bundle.items ?? [])].sort((a, b) => a.position - b.position);

    const appendices = [];
    for (const item of items) {
      appendices.push({
        label: appendixLabel(item.position),
        name: item.document.filename,
        bytes: await download(item.document.storage_path),
      });
    }

    const parts = await buildFiling({
      cover: {
        title: bundle.title,
        firmName: bundle.org?.name,
        matterName: bundle.matter?.name,
        clientName: bundle.matter?.client?.name,
        court: bundle.matter?.court,
        caseNumber: bundle.matter?.court_case_no,
        date: new Date().toLocaleDateString("he-IL"),
      },
      main: bundle.main ? await download(bundle.main.storage_path) : null,
      appendices,
    });

    // Every part is filed as its own document, so a split filing arrives as a
    // set the lawyer can upload one by one rather than a file they must divide.
    const group = crypto.randomUUID();
    let firstId = null;
    let pages = 0;

    for (const [index, bytes] of parts.entries()) {
      const suffix = parts.length > 1 ? ` (חלק ${index + 1} מתוך ${parts.length})` : "";
      const path = `${bundle.org_id}/${bundle.matter_id}/${crypto.randomUUID()}`;

      const upload = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/pdf" });
      if (upload.error) throw new Error(`upload failed: ${upload.error.message}`);

      const { data: row, error: rowError } = await supabase
        .from("documents")
        .insert({
          org_id: bundle.org_id,
          matter_id: bundle.matter_id,
          storage_path: path,
          filename: `${bundle.title}${suffix}.pdf`,
          mime: "application/pdf",
          size_bytes: bytes.byteLength,
          version_group_id: group,
        })
        .select("id")
        .single();
      if (rowError) throw new Error(`could not record output: ${rowError.message}`);

      firstId ??= row.id;
      pages += 1;
    }

    await supabase.from("filing_bundles")
      .update({
        status: "ready",
        output_document_id: firstId,
        page_count: pages,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundleId);

    return { ok: true, parts: parts.length };
  } catch (error) {
    // The reason is stored where the lawyer will look for it, not only in a log
    // nobody opens.
    await supabase.from("filing_bundles")
      .update({
        status: "failed",
        error: error.message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundleId);
    throw error;
  }
}

/**
 * The browser calls this service directly from the app's own origin, so it has
 * to answer preflight.
 *
 * The wildcard is safe here and not laziness: authentication is a bearer token
 * the caller has to hold, never a cookie, so a hostile page cannot make an
 * authenticated request on someone's behalf just by being allowed to ask.
 */
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

  const userId = await callerId(req.headers.authorization);
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
    // Read the bundle before doing any work, so a stranger asking for someone
    // else's filing is refused rather than served.
    //
    // The error is kept rather than discarded: an earlier version dropped it
    // and answered "not found" to what was actually a permission failure,
    // which is a misleading answer to give about someone's own data.
    const { data: owner, error: lookupError } = await supabase
      .from("filing_bundles")
      .select("org_id")
      .eq("id", bundleId)
      .maybeSingle();

    if (lookupError) {
      console.error("bundle lookup failed", lookupError);
      return send(500, { error: `לא ניתן לקרוא את ההגשה: ${explain(lookupError)}` });
    }
    if (!owner) return send(404, { error: "Not found" });
    if (!(await isMemberOf(userId, owner.org_id))) {
      return send(403, { error: "Forbidden" });
    }

    return send(200, await render(bundleId));
  } catch (error) {
    console.error("render failed", error);
    return send(500, { error: explain(error) });
  }
}).listen(PORT, async () => {
  console.log(`filing renderer listening on ${PORT}`);
  console.log(`supabase url: ${JSON.stringify(SUPABASE_URL)}`);

  // Says at startup whether the two routes out of this container work, so a
  // failure later is a change rather than a mystery.
  for (const [label, url] of [
    ["auth", `${SUPABASE_URL}/auth/v1/health`],
    ["rest", `${SUPABASE_URL}/rest/v1/`],
  ]) {
    try {
      const res = await fetch(url, { headers: { apikey: PUBLISHABLE_KEY } });
      console.log(`reachability ${label}: ${res.status}`);
    } catch (error) {
      console.error(`reachability ${label}: ${explain(error)}`);
    }
  }
});
