import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import { contradicts, describeMismatch, SNIFF_BYTES } from "@/lib/file-signature";

const BUCKET = "matter-documents";

/** Matches the bucket's own limit, so the refusal happens before the upload. */
const MAX_BYTES = 25 * 1024 * 1024;

export type DocumentRow = {
  id: string;
  storage_path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  version_group_id: string;
  version_no: number;
  scan_status: string;
  created_at: string;
  uploader: { full_name: string | null; email: string | null } | null;
};

/** One entry per document, newest version first, with its history behind it. */
export type DocumentGroup = {
  version_group_id: string;
  latest: DocumentRow;
  older: DocumentRow[];
};

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} ב׳`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ק״ב`;
  return `${(bytes / 1024 / 1024).toFixed(1)} מ״ב`;
}

export async function listDocuments(matterId: string): Promise<DocumentGroup[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, storage_path, filename, mime, size_bytes, version_group_id, version_no, scan_status, created_at, uploader:profiles!documents_uploaded_by_fkey(full_name, email)",
    )
    .eq("matter_id", matterId)
    .order("version_no", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  const rows = (data ?? []).map((row) => {
    const { uploader, ...rest } = row as never as Omit<DocumentRow, "uploader"> & {
      uploader: unknown;
    };
    const u = uploader as DocumentRow["uploader"][] | DocumentRow["uploader"];
    return { ...rest, uploader: Array.isArray(u) ? (u[0] ?? null) : u };
  });

  const groups = new Map<string, DocumentRow[]>();
  for (const r of rows) {
    const list = groups.get(r.version_group_id) ?? [];
    list.push(r);
    groups.set(r.version_group_id, list);
  }

  return [...groups.values()]
    .map((versions) => ({
      version_group_id: versions[0].version_group_id,
      latest: versions[0],
      older: versions.slice(1),
    }))
    .sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
}

/**
 * Sends the file straight to storage, then files it under the matter.
 *
 * The row is written only after the bytes have landed. The other order would
 * leave the matter listing a document nobody can open.
 */
export async function uploadDocument(input: {
  org_id: string;
  matter_id: string;
  file: File;
  /** Set to add a version to an existing document rather than start a new one. */
  version_group_id?: string;
}): Promise<void> {
  const { file } = input;

  if (file.size > MAX_BYTES) {
    throw new Error(`הקובץ גדול מ־${formatSize(MAX_BYTES)}. נסה קובץ קטן יותר.`);
  }

  // The bucket refuses anything outside a short list of types, but it judges by
  // the type the browser declares. These few bytes are the only evidence of
  // what the file actually is, and reading them costs one slice of one file.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  if (file.type && contradicts(file.type, head)) {
    throw new Error(describeMismatch(file.name, head));
  }

  // The first segment is the firm id: that is what the storage policy reads.
  const path = `${input.org_id}/${input.matter_id}/${crypto.randomUUID()}`;

  const signed = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) throw new Error(translateStorageError(signed.error.message));

  const sent = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, signed.data.token, file, { contentType: file.type || undefined });
  if (sent.error) throw new Error(translateStorageError(sent.error.message));

  const { error } = await supabase.from("documents").insert({
    org_id: input.org_id,
    matter_id: input.matter_id,
    storage_path: path,
    filename: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    ...(input.version_group_id ? { version_group_id: input.version_group_id } : {}),
  });
  if (error) throw new Error(describeDbError(error));
}

/**
 * A link good for one minute. Long enough to click, short enough that a copied
 * URL in a chat window is already dead.
 */
export async function getDownloadUrl(doc: DocumentRow): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.filename });
  if (error) throw new Error(translateStorageError(error.message));
  return data.signedUrl;
}

function translateStorageError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("mime type") || m.includes("not allowed")) {
    return "סוג הקובץ הזה לא נתמך. אפשר PDF, תמונות, Word, Excel וטקסט.";
  }
  if (m.includes("exceeded") || m.includes("too large")) {
    return "הקובץ גדול מדי.";
  }
  if (m.includes("bucket not found")) {
    return "אחסון הקבצים עוד לא הותקן. פנה למי שמתחזק את המערכת.";
  }
  if (m.includes("row-level security") || m.includes("unauthorized")) {
    return "אין לך הרשאה להעלות קבצים לתיק הזה.";
  }
  console.error("storage error", message);
  return "העלאת הקובץ נכשלה. נסה שוב.";
}
