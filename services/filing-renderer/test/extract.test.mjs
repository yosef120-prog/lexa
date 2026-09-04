import { extractText, classify } from "../src/extract.js";
import { deflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

let f=0,c=0;
const check=(l,a,e)=>{c++;if(JSON.stringify(a)!==JSON.stringify(e)){f++;console.error(`  FAIL  ${l}\n    expected ${JSON.stringify(e)}\n    actual   ${JSON.stringify(a)}`)}else console.log(`  ok    ${l}`)};

console.log("\nextract · what kind of file is this\n");
check("a pdf", classify("application/pdf","a.pdf"), "pdf");
check("a word document", classify("","כתב תביעה.docx"), "docx");
check("a photograph", classify("image/jpeg","x.jpg"), "image");
check("plain text", classify("text/plain","x.txt"), "text");
check("something else", classify("application/zip","x.zip"), "other");

console.log("\nextract · reading it\n");
const txt = await extractText(new TextEncoder().encode("הנכס רשום על שם המוכר"), "text/plain", "a.txt");
check("text comes back", txt.state, "done");
check("with the words in it", txt.text, "הנכס רשום על שם המוכר");

// A photograph is not a failure. Saying so is what tells the firm to reach for
// the AI search rather than think something is broken.
const img = await extractText(new Uint8Array([1,2,3]), "image/jpeg", "x.jpg");
check("a photograph has no text, and that is not an error", img.state, "no_text");
check("and carries no error message", img.error, null);

const zip = await extractText(new Uint8Array([1,2,3]), "application/zip", "x.zip");
check("an unopenable type says so", zip.state, "unsupported");

// A real .docx, built here: local header + deflated word/document.xml.
function docx(xml){
  const data = deflateRawSync(Buffer.from(xml,"utf8"));
  const name = Buffer.from("word/document.xml","latin1");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50,0); h.writeUInt16LE(8,8);
  h.writeUInt32LE(data.length,18); h.writeUInt32LE(Buffer.byteLength(xml),22);
  h.writeUInt16LE(name.length,26); h.writeUInt16LE(0,28);
  return Buffer.concat([h,name,data]);
}
const d = await extractText(docx("<w:p><w:r><w:t>סעיף ראשון</w:t></w:r></w:p><w:p><w:r><w:t>סעיף שני</w:t></w:r></w:p>"),"","x.docx");
check("a word document is read", d.state, "done");
// Without a space at the paragraph break the last word of one line runs into
// the first of the next, and neither is findable.
check("with its paragraphs kept apart", d.text, "סעיף ראשון סעיף שני");

const empty = await extractText(docx("<w:p></w:p>"),"","x.docx");
check("an empty document reads as no text", empty.state, "no_text");

// Round trip through this very service's own output. A hand-rolled reader
// passed every test above and still returned two metadata timestamps instead
// of the words on the page, because it only handled compressed streams and
// pdf-lib writes uncompressed ones. Silently returning the wrong text is the
// worst behaviour available here: a lawyer who searches for a clause and finds
// nothing concludes the clause is not there.
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
doc.addPage([400,300]).drawText("Payment schedule clause seventeen", { x:40, y:200, size:14, font });
const pdf = await extractText(await doc.save(), "application/pdf", "x.pdf");
check("a pdf is read", pdf.state, "done");
check("and it is the words on the page, not the metadata", pdf.text, "Payment schedule clause seventeen");

// Per page, because the page number is the whole point of asking. "It is in
// the contract" is not an answer when the contract runs to forty pages.
const two = await PDFDocument.create();
const f2 = await two.embedFont(StandardFonts.Helvetica);
two.addPage([400,300]).drawText("First page recitals", { x:40, y:200, size:14, font:f2 });
two.addPage([400,300]).drawText("Second page payment terms", { x:40, y:200, size:14, font:f2 });
const multi = await extractText(await two.save(), "application/pdf", "x.pdf");
check("a two page pdf comes back as two pages", multi.pages.length, 2);
check("in order", multi.pages[0], "First page recitals");
check("each holding its own words", multi.pages[1], "Second page payment terms");
// The joined blob is kept as well: the AI search wants one document, not a list.
check("and joined for whatever wants one blob", multi.text.includes("First page recitals"), true);

// A word document has no pages until something lays it out. Saying "page 1 of
// 1" is honest; inventing page numbers by counting characters would not be.
check("a word document is one page", d.pages.length, 1);
check("a photograph has no pages at all", img.pages, null);

console.log(`\n${c-f}/${c} checks passed\n`);
process.exit(f===0?0:1);
