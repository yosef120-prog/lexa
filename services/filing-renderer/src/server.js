import { createServer } from "node:http";
import { buildFiling, PART_LIMIT_BYTES } from "./build.js";
import { createRest, verifyToken } from "./supabase-rest.js";
import { sendMessage, toChatId } from "./whatsapp.js";
import { extractText } from "./extract.js";
import { ask, buildContent, LIMITS } from "./ask.js";

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
//
// A bad key must not stop the container from starting. Cloud Run restarts a
// process that exits, so a throw here becomes a crash loop whose reason is
// buried in logs from a revision that never served a request. Starting and
// saying what is wrong is worth far more than refusing to start.
let db = null;
let configError = null;
try {
  db = createRest({ url: SUPABASE_URL, key: requiredEnv("SUPABASE_SERVICE_ROLE_KEY") });
} catch (error) {
  configError = error.message;
  console.error(`configuration rejected: ${configError}`);
}

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

    const { parts, pageCount } = await buildFiling({
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
      page_count: pageCount,
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
    return send(configError ? 503 : 200, {
      ok: !configError,
      limitBytes: PART_LIMIT_BYTES,
      ...(configError ? { error: configError } : {}),
    });
  }

  const isBuild = req.method === "POST" && req.url.startsWith("/build");
  const isWhatsApp = req.method === "POST" && req.url.startsWith("/whatsapp/send");
  const isIndex = req.method === "POST" && req.url.startsWith("/documents/index");
  const isAsk = req.method === "POST" && req.url.startsWith("/documents/ask");

  if (!isBuild && !isWhatsApp && !isIndex && !isAsk) {
    return send(404, { error: "Not found" });
  }

  if (!db) return send(503, { error: `השירות לא מוגדר כראוי: ${configError}` });

  const userId = await verifyToken({
    url: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    authHeader: req.headers.authorization,
  });
  if (!userId) return send(401, { error: "Unauthorized" });

  let payload = "";
  for await (const chunk of req) payload += chunk;

  if (isWhatsApp) return whatsapp({ send, userId, payload });
  if (isIndex) return indexDocuments({ send, userId, payload });
  if (isAsk) return askDocuments({ send, userId, payload });

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
  /**
   * Whoever is asking, and whether they may.
   *
   * Every one of these endpoints reads a firm's files with a role that
   * bypasses row level security, so membership is established here before
   * anything is opened. A stranger naming somebody else's client is refused
   * before a single byte is read.
   */
  async function memberOfClientOrg(userId, clientId) {
    const client = await db.selectOne("clients", `id=eq.${clientId}&select=org_id`);
    if (!client) return null;
    const seat = await db.selectOne(
      "org_members",
      `org_id=eq.${client.org_id}&user_id=eq.${userId}&status=eq.active&select=user_id`,
    );
    return seat ? client.org_id : null;
  }

  /**
   * Reading the text out of files nobody has read yet.
   *
   * Pulled rather than pushed: an upload does not call this, because an intake
   * file arrives from a client with no session and nothing to make the call.
   * The firm's own browser asks when it opens a card, which means the files
   * that get indexed first are the ones somebody is actually looking at.
   */
  async function indexDocuments({ send, userId, payload }) {
    let clientId;
    try {
      ({ clientId } = JSON.parse(payload));
    } catch {
      return send(400, { error: "Invalid JSON" });
    }
    if (!clientId) return send(400, { error: "clientId is required" });

    const orgId = await memberOfClientOrg(userId, clientId);
    if (!orgId) return send(403, { error: "Forbidden" });

    const pending = await db.select(
      "documents",
      `client_id=eq.${clientId}&text_state=eq.pending&deleted_at=is.null` +
        "&select=id,bucket,storage_path,filename,mime,size_bytes&limit=20",
    );

    let read = 0;
    for (const doc of pending ?? []) {
      // A file too large to hold in memory is skipped rather than crashing the
      // container for every other document behind it.
      if ((doc.size_bytes ?? 0) > 20 * 1024 * 1024) {
        await db.update("documents", `id=eq.${doc.id}`, {
          text_state: "unsupported",
          text_read_at: new Date().toISOString(),
        });
        continue;
      }

      let result;
      try {
        const bytes = await db.downloadObject(doc.bucket, doc.storage_path);
        result = await extractText(bytes, doc.mime, doc.filename);
      } catch (error) {
        result = { state: "failed", text: null, error: String(error.message).slice(0, 300) };
      }

      await db.update("documents", `id=eq.${doc.id}`, {
        text_content: result.text,
        text_pages: result.pages,
        text_state: result.state,
        text_error: result.error,
        text_read_at: new Date().toISOString(),
      });
      if (result.state === "done") read++;
    }

    return send(200, { looked: pending?.length ?? 0, read });
  }

  /**
   * Answering a question about one client's documents.
   *
   * The firm's key is looked up here from the membership and never sent, the
   * same shape as the WhatsApp send. The documents are read with the service
   * role, which is why the membership check above happens first.
   */
  async function askDocuments({ send, userId, payload }) {
    let clientId, question;
    try {
      ({ clientId, question } = JSON.parse(payload));
    } catch {
      return send(400, { error: "Invalid JSON" });
    }
    if (!clientId || !question?.trim()) {
      return send(400, { error: "clientId and question are required" });
    }

    const orgId = await memberOfClientOrg(userId, clientId);
    if (!orgId) return send(403, { error: "Forbidden" });

    const connection = await db.selectOne(
      "ai_connections",
      `org_id=eq.${orgId}&select=id,api_key,model`,
    );
    if (!connection) {
      return send(409, { error: "חיפוש AI לא מופעל. הפעל אותו בהגדרות המשרד." });
    }

    try {
      const rows = await db.select(
        "documents",
        `client_id=eq.${clientId}&deleted_at=is.null` +
          "&select=id,bucket,storage_path,filename,mime,size_bytes,text_content" +
          `&order=created_at.desc&limit=${LIMITS.documents}`,
      );

      // Only the pictures need fetching; anything with text already has it.
      const documents = [];
      for (const row of rows ?? []) {
        let bytes = null;
        if (!row.text_content && (row.size_bytes ?? 0) <= LIMITS.imageBytes) {
          try {
            bytes = await db.downloadObject(row.bucket, row.storage_path);
          } catch {
            bytes = null; // One unreadable file should not lose the answer.
          }
        }
        documents.push({ ...row, bytes });
      }

      const { content, used } = buildContent({ question, documents });
      if (used.length === 0) {
        return send(409, { error: "אין מסמכים שניתן לקרוא עבור הלקוח הזה." });
      }

      const answer = await ask({
        apiKey: connection.api_key,
        model: connection.model,
        content,
      });

      await db.update("ai_connections", `id=eq.${connection.id}`, {
        last_ok_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      });

      return send(200, { answer, read: used });
    } catch (error) {
      console.error("ai search failed", error.message);
      try {
        await db.update("ai_connections", `org_id=eq.${orgId}`, {
          last_error: error.message,
          last_error_at: new Date().toISOString(),
        });
      } catch {
        // The search already failed; failing to record why should not change
        // what the caller is told.
      }
      return send(502, { error: error.message });
    }
  }

  /**
   * Sending one message from the firm's connected WhatsApp.
   *
   * The caller says who and what; the credentials are looked up here from the
   * membership, never sent. Somebody who forges a request can at most make
   * their own firm send a message, which is what they can already do by
   * clicking the button.
   */
  async function whatsapp({ send, userId, payload }) {
    let to, message, orgId;
    try {
      ({ to, message, orgId } = JSON.parse(payload));
    } catch {
      return send(400, { error: "Invalid JSON" });
    }
    if (!to || !message || !orgId) {
      return send(400, { error: "to, message and orgId are required" });
    }

    const chatId = toChatId(to);
    if (!chatId) return send(400, { error: "מספר הטלפון אינו תקין." });

    try {
      // Membership first, so a stranger naming somebody else's firm is refused
      // before its credentials are so much as read.
      const membership = await db.selectOne(
        "org_members",
        `org_id=eq.${orgId}&user_id=eq.${userId}&status=eq.active&select=user_id`,
      );
      if (!membership) return send(403, { error: "Forbidden" });

      const connection = await db.selectOne(
        "whatsapp_connections",
        `org_id=eq.${orgId}&select=id,instance_id,api_token`,
      );
      if (!connection) {
        return send(409, { error: "וואטסאפ לא מחובר. חבר אותו בהגדרות המשרד." });
      }

      const idMessage = await sendMessage({
        instanceId: connection.instance_id,
        apiToken: connection.api_token,
        chatId,
        message,
      });

      // Recorded so the settings screen can say whether the connection still
      // works, rather than only that it was once configured.
      await db.update("whatsapp_connections", `id=eq.${connection.id}`, {
        last_ok_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      });

      return send(200, { ok: true, idMessage });
    } catch (error) {
      console.error("whatsapp send failed", error.message);
      try {
        await db.update("whatsapp_connections", `org_id=eq.${orgId}`, {
          last_error: error.message,
          last_error_at: new Date().toISOString(),
        });
      } catch {
        // The send already failed; failing to record why should not change
        // what the caller is told.
      }
      return send(502, { error: error.message });
    }
  }
}).listen(PORT, async () => {
  console.log(`filing renderer listening on ${PORT}`);

  // Says at startup whether this container can reach Supabase and whether the
  // secret key is accepted, so a later failure is a change rather than a
  // mystery.
  if (!db) {
    console.error("supabase: not configured, see above");
    return;
  }
  try {
    await db.select("organizations", "select=id&limit=1");
    console.log("supabase: reachable, key accepted");
  } catch (error) {
    console.error(`supabase: ${error.message}`);
  }
});
