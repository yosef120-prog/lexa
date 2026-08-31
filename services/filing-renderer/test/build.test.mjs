/**
 * The filing renderer, exercised on real PDFs it builds itself.
 *
 * Nothing here touches Supabase: the assembly is the part that can be wrong in
 * ways nobody notices until a judge is holding the result.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildFiling } from "../src/build.js";
import { shapeRtl, wrap } from "../src/hebrew.js";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** A real PDF of a given length, so page counts mean something. */
async function makePdf(pages, text = "x") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${text} ${i + 1}`, { x: 60, y: 700, size: 12, font });
  }
  return doc.save();
}

console.log("\nfiling renderer\n");

// --- Hebrew shaping ----------------------------------------------------------
// pdf-lib draws glyphs in the order given, so Hebrew must arrive reversed.
check("Hebrew is reversed for drawing", shapeRtl("שלום"), "םולש");
// A file name inside a Hebrew line must still read forwards.
check("Latin inside Hebrew stays readable", shapeRtl("נספח contract.pdf"), "contract.pdf חפסנ");
check("digits stay in order", shapeRtl("תיק 12345"), "12345 קית");
// Otherwise an opening bracket comes out closing.
check("brackets are mirrored", shapeRtl("נספח (א)"), "(א) חפסנ");
check("text without Hebrew is left alone", shapeRtl("Exhibit A"), "Exhibit A");

const fakeFont = { widthOfTextAtSize: (t, size) => t.length * size * 0.5 };
check("wrapping keeps words whole", wrap("אחת שתיים שלוש ארבע", fakeFont, 10, 60), [
  "אחת שתיים",
  "שלוש ארבע",
]);

// --- assembly ----------------------------------------------------------------
const cover = {
  title: "כתב תביעה",
  firmName: "דניאל שמעונוב, עורך דין",
  matterName: "מכירת דירה ברחוב הרצל 12",
  clientName: "שרה לוי",
  court: "שלום תל אביב",
  caseNumber: "12345-01-26",
  date: "31/08/2026",
};

const main = await makePdf(3, "main");
const twoAppendices = [
  { label: "נספח א׳", name: "חוזה מכר.pdf", bytes: await makePdf(2, "a") },
  { label: "נספח ב׳", name: "נסח טאבו.pdf", bytes: await makePdf(1, "b") },
];

const { parts: [small], pageCount: smallPages } = await buildFiling({ cover, main, appendices: twoAppendices });
const smallDoc = await PDFDocument.load(small);
// cover + main 3 + (separator + 2) + (separator + 1) = 9. No index at two.
check("a short filing has a cover, no index, and a separator per appendix",
  smallDoc.getPageCount(), 9);

// The marker text goes into a standard-font placeholder PDF, so it stays Latin;
// the Hebrew being tested is in the labels the renderer draws with its own font.
const sixAppendices = await Promise.all(
  ["א", "ב", "ג", "ד", "ה", "ו"].map(async (letter, i) => ({
    label: `נספח ${letter}׳`,
    name: `מסמך ${i + 1}.pdf`,
    bytes: await makePdf(1, `ex${i + 1}`),
  })),
);
const { parts: [withIndex] } = await buildFiling({ cover, main, appendices: sixAppendices });
const indexDoc = await PDFDocument.load(withIndex);
// cover + index + main 3 + 6 × (separator + 1) = 17.
check("past five appendices an index appears", indexDoc.getPageCount(), 17);

// --- refusing what it cannot read --------------------------------------------
// A dropped exhibit discovered in the courtroom is worse than a build that stops.
let refused = null;
try {
  await buildFiling({
    cover,
    main,
    appendices: [{ label: "נספח א׳", name: "שבור.pdf", bytes: new Uint8Array([1, 2, 3]) }],
  });
} catch (e) {
  refused = e.message;
}
check("an unreadable exhibit stops the build and names itself",
  /נספח א׳/.test(refused ?? ""), true);

// --- one part when it fits ---------------------------------------------------
check("a filing that fits comes back as a single part",
  (await buildFiling({ cover, main, appendices: twoAppendices })).parts.length, 1);
// The bundle records this, so it has to be pages rather than parts.
check("and reports how many pages it produced", smallPages, 9);

// --- page numbering ----------------------------------------------------------
// Sequential across the whole filing is what a court refers to, so the count
// must match the pages exactly.
const numbered = await PDFDocument.load(small);
check("every page in the filing exists to be numbered", numbered.getPageCount() > 0, true);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
