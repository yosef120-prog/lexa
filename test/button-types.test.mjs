/**
 * Every button inside a form says what kind it is.
 *
 * A <button> with no type is a submit button. Inside a form that means a
 * control meant to open a menu, toggle a panel or ask for confirmation
 * silently submits the form instead — and the handler it was given never runs
 * to completion because the component unmounts.
 *
 * This is not hypothetical. The delete control on the client card sits inside
 * the edit form, its buttons carried no type, and pressing "מחק לקוח" saved
 * the form and closed it. The confirmation never appeared. Deleting a client
 * was impossible from the only screen that offers it, and every test passed.
 *
 * There is no DOM in this test suite to catch that by clicking, so the rule is
 * checked in the source: a button that is not explicitly a submit button must
 * say type="button".
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src");

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

async function tsxFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await tsxFiles(path)));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

console.log("\nbuttons · every one says what it is\n");

const offenders = [];
for (const file of await tsxFiles(root)) {
  const source = await readFile(file, "utf8");
  // Each opening <button ...> tag, up to the closing angle bracket of the tag.
  for (const tag of source.matchAll(/<button\b[^>]*>/gs)) {
    if (!/\btype=/.test(tag[0])) {
      const line = source.slice(0, tag.index).split("\n").length;
      offenders.push(file.slice(root.length + 1).split("\\").join("/") + ":" + line);
    }
  }
}

check("no button in the app leaves its type to the browser", offenders, []);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
