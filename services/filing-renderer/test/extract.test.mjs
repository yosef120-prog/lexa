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

console.log(`\n${c-f}/${c} checks passed\n`);
process.exit(f===0?0:1);
