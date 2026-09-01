/**
 * Which files a client may attach to a questionnaire.
 *
 * Its own module for one reason: it is a rule, and a rule should be testable
 * without standing up a database client. It deliberately imports nothing —
 * anything reaching for Supabase belongs in intake-public.ts.
 *
 * The storage bucket carries the same list and remains the authority. This
 * copy exists so a client on a phone learns the answer before spending four
 * minutes pushing a video over cellular data. Nothing here admits a file the
 * bucket would refuse; if the two ever drift, storage answers and the client
 * sees that instead.
 */

export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

/** Matches storage.buckets.file_size_limit for intake-uploads. */
export const MAX_BYTES = 26214400;

/**
 * For the file picker, so a phone stops offering video in the first place.
 *
 * Extensions as well as types: Android pickers regularly report a file's type
 * as empty or generic, and filter on the extension instead.
 */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_TYPES,
  ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".webp", ".doc", ".docx", ".txt",
].join(",");

/** Only what the rule needs, so a test does not have to build a real File. */
export type FileFacts = { name: string; type: string; size: number };

/**
 * Why this file cannot be sent, or null if it can.
 *
 * A file whose type the browser does not report is passed through to storage
 * rather than guessed at here. Some Android pickers do that for ordinary PDFs,
 * and refusing them locally would block a real document over a browser quirk —
 * the bucket will still refuse it if it truly is not allowed.
 */
export function whyFileIsRefused(file: FileFacts): string | null {
  if (file.size > MAX_BYTES) {
    return `הקובץ ${file.name} גדול מדי. עד 25 מ״ב לקובץ.`;
  }
  if (!file.type || ACCEPTED_TYPES.includes(file.type)) return null;

  // Worth naming, because it is the mistake people actually make: the camera
  // was left on video. "Unsupported type" tells them nothing they can act on.
  const hint = file.type.startsWith("video/")
    ? " נראה שצילמת סרטון — כאן צריך תמונה או קובץ."
    : "";
  return `הקובץ ${file.name} מסוג שאינו נתמך.${hint} אפשר PDF, תמונה או מסמך Word.`;
}
