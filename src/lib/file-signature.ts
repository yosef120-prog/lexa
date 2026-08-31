/**
 * What a file actually is, read from its first bytes.
 *
 * The storage bucket already refuses anything outside a short list of types —
 * but it judges by the type the browser declares, and a declaration is not
 * evidence. These few bytes are.
 *
 * This is not virus scanning and does not pretend to be. It catches the honest
 * case, which is also the common one: a file that is not what its name says,
 * usually because somebody renamed it to get past a limit. Real scanning needs
 * a scanning service, and the note on the upload panel says so plainly rather
 * than letting a green tick imply safety nobody has checked.
 *
 * No Supabase or React import, so it can be tested on its own.
 */

export type Sniffed = "pdf" | "png" | "jpeg" | "gif" | "zip" | "ole" | "rtf" | "unknown";

/** Enough for every signature below; nothing here reaches past the first 8. */
export const SNIFF_BYTES = 8;

const starts = (bytes: Uint8Array, sig: number[]) =>
  sig.every((byte, i) => bytes[i] === byte);

export function sniff(bytes: Uint8Array): Sniffed {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF8

  // Every modern Office file is a zip. So is a zip, which is why matching this
  // proves the container and not the contents.
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";

  // The old compound format behind .doc and .xls.
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "ole";

  if (starts(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return "rtf"; // {\rtf

  return "unknown";
}

/** What each declared type is allowed to look like underneath. */
const EXPECTED: Record<string, Sniffed[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpeg"],
  "image/gif": ["gif"],
  "application/msword": ["ole", "rtf"],
  "application/vnd.ms-excel": ["ole"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
};

/**
 * Whether the bytes agree with the label.
 *
 * Silence is consent: a type with no known signature — plain text, and the
 * image formats browsers invent faster than anyone can list — passes, because
 * refusing what we cannot check would block ordinary work to no purpose.
 */
export function contradicts(declaredMime: string, bytes: Uint8Array): boolean {
  const expected = EXPECTED[declaredMime];
  if (!expected) return false;

  const actual = sniff(bytes);
  if (actual === "unknown") return false;

  return !expected.includes(actual);
}

const SNIFF_LABEL: Record<Sniffed, string> = {
  pdf: "PDF",
  png: "PNG",
  jpeg: "JPEG",
  gif: "GIF",
  zip: "ארכיון או מסמך Office",
  ole: "מסמך Office ישן",
  rtf: "RTF",
  unknown: "לא מזוהה",
};

/**
 * The refusal, in words that say what to do about it.
 *
 * Naming what the file turned out to be is the part that helps: nine times out
 * of ten somebody renamed a PDF to .docx, sees "PDF", and understands
 * immediately.
 */
export function describeMismatch(filename: string, bytes: Uint8Array): string {
  return (
    `הקובץ ${filename} אינו מהסוג שהסיומת שלו מבטיחה — התוכן נראה כמו ` +
    `${SNIFF_LABEL[sniff(bytes)]}. שנה את הסיומת לנכונה ונסה שוב.`
  );
}
