/**
 * Whether a file is what its name claims.
 *
 * Not virus scanning, and the tests are written so nobody later mistakes it
 * for that: what is checked here is the label against the first few bytes.
 * The failure mode worth guarding is the quiet one in the other direction —
 * refusing an ordinary document because its type has no signature to check.
 */
import { sniff, contradicts, describeMismatch } from "../src/lib/file-signature.ts";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(
      `  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`  ok    ${label}`);
  }
}

console.log("\nuploads · is it what it says\n");

const bytes = (...b) => new Uint8Array([...b, 0, 0, 0, 0]);

const PDF = bytes(0x25, 0x50, 0x44, 0x46);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47);
const JPEG = bytes(0xff, 0xd8, 0xff);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0);
const TEXT = new Uint8Array([0x73, 0x68, 0x61, 0x6c, 0x6f, 0x6d]);

check("a PDF is recognised", sniff(PDF), "pdf");
check("a PNG is recognised", sniff(PNG), "png");
check("a JPEG is recognised", sniff(JPEG), "jpeg");
check("plain text has no signature to recognise", sniff(TEXT), "unknown");

// The case this exists for: something renamed to get past a limit.
check("a PDF called a Word file is caught", contradicts("application/msword", PDF), true);
check("an image called a PDF is caught", contradicts("application/pdf", PNG), true);

check("a PDF called a PDF passes", contradicts("application/pdf", PDF), false);
check("a JPEG called a JPEG passes", contradicts("image/jpeg", JPEG), false);

// Every modern Office file is a zip underneath, so the container is all this
// can prove — and that is enough to catch a renamed executable.
check(
  "a .docx is allowed to be a zip",
  contradicts("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ZIP),
  false,
);
check("and an old .doc is allowed to be OLE", contradicts("application/msword", OLE), false);

// Refusing what cannot be checked would block ordinary work for nothing. Both
// directions of not-knowing have to pass.
check("a type with no known signature passes", contradicts("text/plain", PDF), false);
check("and bytes with no known signature pass", contradicts("application/pdf", TEXT), false);

// The refusal has to tell someone what to do, and naming what the file turned
// out to be is the part that does that.
check(
  "the refusal names what the file really is",
  describeMismatch("חוזה.docx", PDF).includes("PDF"),
  true,
);
check("and names the file", describeMismatch("חוזה.docx", PDF).includes("חוזה.docx"), true);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
