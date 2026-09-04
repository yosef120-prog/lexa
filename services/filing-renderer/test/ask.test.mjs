/**
 * What gets sent to the model, and what does not.
 *
 * Every document in this request costs the firm money and carries a client's
 * private papers to a third party. Both facts make the bounds worth testing:
 * a limit that quietly does not apply is a bill nobody agreed to.
 */
import { buildContent, LIMITS, SYSTEM } from "../src/ask.js";

let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    f++;
    console.error(`  FAIL  ${l}\n    expected ${JSON.stringify(e)}\n    actual   ${JSON.stringify(a)}`);
  } else console.log(`  ok    ${l}`);
};

const image = (n, size = 1000) => ({
  filename: n, mime: "image/jpeg", text_content: null,
  bytes: new Uint8Array(size), size_bytes: size,
});
const withText = (n, text) => ({ filename: n, mime: "application/pdf", text_content: text, bytes: null });

console.log("\nask · what the model is shown\n");

const one = buildContent({ question: "מתי התשלום הראשון?", documents: [withText("הסכם.pdf", "התשלום הראשון ב־1.1")] });
check("a document with text is sent as text", one.content[0].type, "text");
check("named, so the answer can cite it", one.content[0].text.includes("הסכם.pdf"), true);
check("and the question comes last", one.content.at(-1).text.includes("מתי התשלום הראשון?"), true);
check("the caller is told what was read", one.used, ["הסכם.pdf"]);

// The whole reason this search exists beside the plain one: a photographed
// identity card has no text to match, so the picture itself goes.
const pic = buildContent({ question: "מה מספר הזהות?", documents: [image("ת.ז.jpg")] });
check("a photograph is sent as a picture", pic.content[1].type, "image");
check("base64 encoded", typeof pic.content[1].source.data, "string");
check("with its own type declared", pic.content[1].source.media_type, "image/jpeg");

// Text is cheaper and more reliable than re-reading the picture.
const both = buildContent({
  question: "?",
  documents: [{ filename: "סרוק.pdf", mime: "image/jpeg", text_content: "כבר נקרא", bytes: new Uint8Array(10) }],
});
check("text wins when a file has both", both.content[0].type, "text");
check("so the picture is not sent twice", both.content.filter((p) => p.type === "image").length, 0);

console.log("\nask · the bounds\n");

const many = buildContent({
  question: "?",
  documents: Array.from({ length: 40 }, (_, i) => withText(`f${i}.pdf`, "x")),
});
check("never more documents than the limit", many.used.length, LIMITS.documents);

// A card with forty photographs should produce an answer and a bill, not a
// surprise.
const heavy = buildContent({
  question: "?",
  documents: [image("a.jpg", LIMITS.imageBytes), image("b.jpg", LIMITS.imageBytes)],
});
check("pictures stop at the byte budget", heavy.used, ["a.jpg"]);

const long = buildContent({
  question: "?",
  documents: [withText("a.pdf", "x".repeat(LIMITS.textChars + 5000)), withText("b.pdf", "y")],
});
check("text stops at the character budget", long.used, ["a.pdf"]);

// A file type the model cannot open is skipped rather than sent as noise.
const odd = buildContent({
  question: "?",
  documents: [{ filename: "x.tiff", mime: "image/tiff", text_content: null, bytes: new Uint8Array(10) }],
});
check("an image type the model cannot read is left out", odd.used, []);

console.log("\nask · what it is told to do\n");

// A lawyer acting on an invented clause is worse off than one told to go and
// look, so "I did not find it" has to be an available answer.
check("it is told to cite the document", SYSTEM.includes("ציין את שם המסמך"), true);
check("and told to say when it did not find the answer", SYSTEM.includes("אמור זאת במפורש"), true);
check("and told not to guess", SYSTEM.includes("אל תנחש"), true);

console.log(`\n${c - f}/${c} checks passed\n`);
process.exit(f === 0 ? 0 : 1);
