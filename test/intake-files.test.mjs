/**
 * Which files a client may attach, and what they are told when they may not.
 *
 * The message matters as much as the verdict here. A client on a phone who is
 * told only "unsupported type" has nothing to act on — they picked the file
 * from their own gallery and it looked like a document to them.
 */
import {
  ACCEPTED_TYPES,
  ACCEPT_ATTRIBUTE,
  MAX_BYTES,
  whyFileIsRefused,
} from "../src/lib/intake-files.ts";

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

const file = (name, type, size = 1000) => ({ name, type, size });

console.log("\nintake files · what gets through\n");

check("a photographed page", whyFileIsRefused(file("id.jpg", "image/jpeg")), null);
check("an iPhone photo", whyFileIsRefused(file("id.heic", "image/heic")), null);
check("a pdf", whyFileIsRefused(file("חוזה.pdf", "application/pdf")), null);
check(
  "a word document",
  whyFileIsRefused(
    file("כתב.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  ),
  null,
);

// Some Android pickers report nothing for perfectly ordinary files. Refusing
// them here would block a real document over a browser quirk; storage still
// gets the last word.
check("a file the browser cannot name", whyFileIsRefused(file("scan", "")), null);

console.log("\nintake files · what does not, and why\n");

const video = whyFileIsRefused(file("20260901_150155.mp4", "video/mp4"));
check("a video is refused", video !== null, true);
check("the message names the file", video.includes("20260901_150155.mp4"), true);
// The whole point: the client left the camera on video and does not know it.
check("and says what actually happened", video.includes("סרטון"), true);
check("and what is wanted instead", video.includes("PDF"), true);

const audio = whyFileIsRefused(file("voice.m4a", "audio/mp4"));
check("audio is refused too", audio !== null, true);
// The video hint would be a lie here.
check("without claiming it was a video", audio.includes("סרטון"), false);

const big = whyFileIsRefused(file("scan.pdf", "application/pdf", MAX_BYTES + 1));
check("an oversized file is refused", big !== null, true);
check("named as too large, not as wrong type", big.includes("גדול מדי"), true);
check("right at the limit is fine", whyFileIsRefused(file("scan.pdf", "application/pdf", MAX_BYTES)), null);

console.log("\nintake files · the picker\n");

// A type the rule accepts but the picker filters out would show the client an
// empty file browser and no explanation at all.
for (const type of ACCEPTED_TYPES) {
  check(`the picker offers ${type}`, ACCEPT_ATTRIBUTE.includes(type), true);
}
check("and offers extensions too, for pickers that ignore types", ACCEPT_ATTRIBUTE.includes(".pdf"), true);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
