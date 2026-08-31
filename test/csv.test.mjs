/**
 * The spreadsheet the firm takes with it when it leaves.
 *
 * A comma inside an address, a line break inside a note, a quote inside a
 * matter name — each one can split a row in two, and none of them announce
 * themselves. The file lands in somebody else's hands before anyone counts the
 * columns, so the escaping is tested rather than trusted.
 */
import { toCsv, slug, EXCEL_BOM } from "../src/lib/csv.ts";

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

console.log("\nexport · the spreadsheet\n");

const lines = (csv) => csv.split("\r\n");

check("nothing to export is an empty file, not a header alone", toCsv([]), "");

check(
  "a plain table is a header and its rows",
  lines(toCsv([{ name: "שרה לוי", phone: "0501234567" }])),
  ["name,phone", "שרה לוי,0501234567"],
);

// The three that split a row silently.
check(
  "a comma inside a value is wrapped, not obeyed",
  lines(toCsv([{ address: "הרצל 12, תל אביב" }]))[1],
  '"הרצל 12, תל אביב"',
);
check(
  "a quote is doubled inside the wrapping",
  lines(toCsv([{ name: 'חברת "אלפא" בע״מ' }]))[1],
  '"חברת ""אלפא"" בע״מ"',
);
check(
  "a line break stays inside one cell",
  toCsv([{ note: "שורה\nשנייה" }]).split("\r\n")[1],
  '"שורה\nשנייה"',
);

// A column that is empty on the first row and filled on a later one is exactly
// the column somebody will go looking for.
check(
  "every row's columns appear, not just the first row's",
  lines(toCsv([{ a: 1 }, { a: 2, b: 3 }]))[0],
  "a,b",
);
check("and a row missing one leaves it blank", lines(toCsv([{ a: 1 }, { a: 2, b: 3 }]))[1], "1,");

check(
  "null and undefined are blank rather than the word",
  lines(toCsv([{ a: null, b: undefined, c: 0 }]))[1],
  ",,0",
);

// Nested values still have to survive the trip, even if a spreadsheet will
// only ever show them as text.
check("an object is written as JSON in its cell", lines(toCsv([{ meta: { x: 1 } }]))[1], '"{""x"":1}"');

// Windows Excel is the reader here, and it is the fussy one.
check("rows end the way Excel expects", toCsv([{ a: 1 }, { a: 2 }]).includes("\r\n"), true);
check("the byte order mark is one character", EXCEL_BOM.length, 1);

check("a Hebrew firm name becomes a usable filename", slug("דניאל שמעונוב, עורך דין"), "דניאל-שמעונוב,-עורך-דין");
check("characters a filesystem refuses are dropped", slug('a/b:c*d?e"f<g>h|i'), "abcdefghi");
check("a nameless firm still gets a file", slug("   "), "export");

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
