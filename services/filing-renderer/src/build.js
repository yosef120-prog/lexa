import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { shapeRtl, wrap } from "./hebrew.js";

const require = createRequire(import.meta.url);

/** נט המשפט refuses anything larger, which is the whole reason for splitting. */
export const PART_LIMIT_BYTES = 30 * 1024 * 1024;

const A4 = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.08, 0.13, 0.16);
const MUTED = rgb(0.45, 0.51, 0.55);

let fontCache = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all([
    readFile(require.resolve("@expo-google-fonts/noto-sans-hebrew/400Regular/NotoSansHebrew_400Regular.ttf")),
    readFile(require.resolve("@expo-google-fonts/noto-sans-hebrew/700Bold/NotoSansHebrew_700Bold.ttf")),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

/** Draws a right-aligned line, which is where Hebrew starts on the page. */
function drawRtl(page, text, { font, size, y, colour = INK }) {
  const shaped = shapeRtl(text);
  const width = font.widthOfTextAtSize(shaped, size);
  page.drawText(shaped, {
    x: page.getWidth() - MARGIN - width,
    y,
    size,
    font,
    color: colour,
  });
}

/**
 * Builds the filing.
 *
 * Order is cover, index when there are enough appendices to need one, the
 * pleading, then each appendix behind its own separator sheet — which is how a
 * filing is read in court, and why the separator is not decoration.
 *
 * Returns one or more parts. More than one means the whole exceeded what נט
 * המשפט accepts and had to be divided.
 */
export async function buildFiling({ cover, main, appendices }) {
  const fonts = await loadFonts();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  await addCover(doc, { regular, bold }, cover, appendices);

  // Below six, an index costs a page and saves nobody a search.
  if (appendices.length > 5) {
    addIndex(doc, { regular, bold }, appendices);
  }

  if (main) {
    await appendPdf(doc, main, "המסמך הראשי");
  }

  for (const appendix of appendices) {
    addSeparator(doc, { regular, bold }, appendix);
    await appendPdf(doc, appendix.bytes, appendix.label);
  }

  numberPages(doc, regular);

  const pageCount = doc.getPageCount();
  const whole = await doc.save();

  if (whole.byteLength <= PART_LIMIT_BYTES) return { parts: [whole], pageCount };
  return { parts: await splitByPages(doc, whole), pageCount };
}

async function addCover(doc, fonts, cover, appendices) {
  const page = doc.addPage(A4);
  let y = page.getHeight() - MARGIN - 40;

  if (cover.firmName) {
    drawRtl(page, cover.firmName, { font: fonts.bold, size: 13, y, colour: MUTED });
    y -= 46;
  }

  for (const line of wrap(cover.title, fonts.bold, 24, page.getWidth() - MARGIN * 2)) {
    drawRtl(page, line, { font: fonts.bold, size: 24, y });
    y -= 32;
  }

  y -= 14;
  const facts = [
    cover.matterName && `בעניין: ${cover.matterName}`,
    cover.clientName && `הלקוח: ${cover.clientName}`,
    cover.court && `בית המשפט: ${cover.court}`,
    cover.caseNumber && `מספר תיק: ${cover.caseNumber}`,
    `נספחים: ${appendices.length}`,
    `הופק: ${cover.date}`,
  ].filter(Boolean);

  for (const fact of facts) {
    drawRtl(page, fact, { font: fonts.regular, size: 11, y, colour: MUTED });
    y -= 18;
  }
}

function addIndex(doc, fonts, appendices) {
  const page = doc.addPage(A4);
  let y = page.getHeight() - MARGIN - 20;

  drawRtl(page, "תוכן הנספחים", { font: fonts.bold, size: 18, y });
  y -= 34;

  for (const appendix of appendices) {
    drawRtl(page, `${appendix.label} — ${appendix.name}`, {
      font: fonts.regular,
      size: 11,
      y,
    });
    y -= 20;

    if (y < MARGIN + 40) {
      y = doc.addPage(A4).getHeight() - MARGIN - 20;
    }
  }
}

function addSeparator(doc, fonts, appendix) {
  const page = doc.addPage(A4);
  const middle = page.getHeight() / 2;

  drawRtl(page, appendix.label, { font: fonts.bold, size: 30, y: middle });
  drawRtl(page, appendix.name, { font: fonts.regular, size: 12, y: middle - 30, colour: MUTED });
}

/**
 * A source file that cannot be parsed stops the whole filing rather than being
 * quietly dropped. A missing exhibit found in the courtroom is worse than a
 * build that refuses.
 */
async function appendPdf(target, bytes, label) {
  let source;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (cause) {
    throw new Error(`לא ניתן לקרוא את הקובץ: ${label}`, { cause });
  }

  try {
    const pages = await target.copyPages(source, source.getPageIndices());
    if (!pages.length) throw new Error("no pages");
    for (const page of pages) target.addPage(page);
  } catch (cause) {
    // A file can parse and still have no usable page tree. Before this, the
    // lawyer saw pdf-lib's own wording and no clue which file caused it.
    throw new Error(`הקובץ פגום ולא ניתן לצרף אותו: ${label}`, { cause });
  }
}

/** Sequential across the whole filing, which is what a court refers to. */
function numberPages(doc, font) {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = String(index + 1);
    const width = font.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: (page.getWidth() - width) / 2,
      y: MARGIN / 2,
      size: 9,
      font,
      color: MUTED,
    });
  });
}

/**
 * Divides an oversized filing into parts that each fit.
 *
 * Pages are added one at a time and the result measured, because compression
 * makes a page's contribution impossible to predict from the source: a scanned
 * exhibit can be larger than the twenty pages around it.
 */
async function splitByPages(doc, whole) {
  const total = doc.getPageCount();
  const parts = [];
  let start = 0;

  while (start < total) {
    let part = await PDFDocument.create();
    let saved = null;
    let end = start;

    while (end < total) {
      const candidate = await PDFDocument.create();
      const pages = await candidate.copyPages(doc, range(start, end + 1));
      for (const page of pages) candidate.addPage(page);

      const bytes = await candidate.save();
      if (bytes.byteLength > PART_LIMIT_BYTES && end > start) break;

      part = candidate;
      saved = bytes;
      end += 1;
    }

    // One page alone over the limit cannot be divided further, so it goes out
    // as its own part and the caller is told.
    if (!saved) {
      const single = await PDFDocument.create();
      const [page] = await single.copyPages(doc, [start]);
      single.addPage(page);
      saved = await single.save();
      end = start + 1;
    }

    parts.push(saved);
    start = end;
  }

  return parts.length ? parts : [whole];
}

function range(from, to) {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
