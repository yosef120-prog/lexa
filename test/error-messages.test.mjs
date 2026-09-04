/**
 * Every refusal the database makes has something to say in Hebrew.
 *
 * The schema refuses things on purpose: a client with a live file, an invoice
 * already paid, an invitation meant for another account. Each refusal is
 * raised as a short code, and each code needs a sentence somewhere in the app
 * that says what happened and what to do about it.
 *
 * A code with no sentence does not fail loudly. It reaches the screen as a raw
 * database error, and a deliberate, well-reasoned decision looks to the user
 * exactly like a broken button. That is what "HAS_OPEN_MATTERS" did: deleting a
 * client with an open matter was correctly refused and unhelpfully reported,
 * and the audit that found it took twenty minutes of confusion to notice the
 * delete had never worked.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

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

async function sourceFiles(dir, exts) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path, exts)));
    else if (exts.some((e) => entry.name.endsWith(e))) found.push(path);
  }
  return found;
}

console.log("\nerrors · every refusal can be read\n");

const codes = new Set();
for (const file of await sourceFiles(join(root, "supabase", "migrations"), [".sql"])) {
  const sql = await readFile(file, "utf8");
  for (const m of sql.matchAll(/raise\s+exception\s+'([A-Z_]+)'/g)) codes.add(m[1]);
}

check("the schema raises named refusals at all", codes.size > 10, true);

const app = (
  await Promise.all(
    (await sourceFiles(join(root, "src"), [".ts", ".tsx"])).map((f) => readFile(f, "utf8")),
  )
).join("\n");

const unspoken = [...codes].filter((c) => !app.includes(c)).sort();
check("and every one of them has something to say in Hebrew", unspoken, []);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
