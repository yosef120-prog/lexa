/**
 * Laying Hebrew out for pdf-lib.
 *
 * pdf-lib draws glyphs in the order it is given them, left to right. Hebrew
 * therefore has to arrive already reversed, or every word comes out backwards.
 *
 * This is a single-line visual reordering, not a full bidi implementation. It
 * covers what a cover page and an index contain — Hebrew with embedded numbers,
 * file names and parentheses — and nothing more. Paragraphs of mixed prose need
 * a real bidi library, and if this file ever has to handle those, that is the
 * moment to reach for one rather than extend this.
 */

/** Runs that stay in their own order once the line is flipped. */
const LTR_RUN = /[A-Za-z0-9@._+\-/\\]+/g;

/** Mirrored when a line is flipped, or they point the wrong way. */
const MIRRORED = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };

const HEBREW = /[֐-׿]/;

export function hasHebrew(text) {
  return HEBREW.test(text);
}

/**
 * Returns the visual order of a right-to-left line.
 *
 * Latin words, numbers and file names are reversed twice — once with the line,
 * once back — so they read forwards inside a Hebrew sentence.
 */
export function shapeRtl(text) {
  if (!hasHebrew(text)) return text;

  const flipped = [...text]
    .reverse()
    .map((ch) => MIRRORED[ch] ?? ch)
    .join("");

  return flipped.replace(LTR_RUN, (run) => [...run].reverse().join(""));
}

/**
 * Breaks a line to fit a width, measuring with the font that will draw it.
 * Words are kept whole; a single word too long for the line is left to overflow
 * rather than cut in a place that changes its meaning.
 */
export function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
