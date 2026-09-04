/**
 * Asking a model about a client's documents.
 *
 * The other half of the search. The plain one matches the letters a lawyer
 * typed against text already pulled out of the files; this one reads the files
 * and answers a question about them — which is what a photographed identity
 * card or a scanned contract needs, because neither has any text to match.
 *
 * It runs here for two reasons. The firm's key must not be in a browser
 * bundle, and the documents must not be handed to anybody who has not first
 * been shown to be a member of the firm that owns them.
 *
 * It costs money per question, which is why it is off until a firm supplies
 * its own key, and why the bounds below are real rather than decorative.
 */

const API = "https://api.anthropic.com/v1/messages";

/** What one question is allowed to read. Somebody with forty documents on a
 *  card should get an answer and a bill, not a surprise. */
export const LIMITS = {
  documents: 12,
  imageBytes: 4 * 1024 * 1024,
  textChars: 120_000,
};

/** Only what the model can actually be shown. */
const VISIBLE_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Builds the message content from the documents.
 *
 * Text where there is text and the picture itself where there is not, which is
 * exactly the split that makes this search worth its cost: the plain one
 * cannot see a photograph at all.
 */
export function buildContent({ question, documents }) {
  const content = [];
  let textBudget = LIMITS.textChars;
  let imageBudget = LIMITS.imageBytes;
  const used = [];

  for (const doc of documents.slice(0, LIMITS.documents)) {
    if (doc.text_content && textBudget > 0) {
      const slice = doc.text_content.slice(0, textBudget);
      textBudget -= slice.length;
      content.push({ type: "text", text: `<מסמך שם="${doc.filename}">\n${slice}\n</מסמך>` });
      used.push(doc.filename);
      continue;
    }

    if (doc.bytes && VISIBLE_IMAGE.has(doc.mime) && doc.bytes.byteLength <= imageBudget) {
      imageBudget -= doc.bytes.byteLength;
      content.push({ type: "text", text: `המסמך הבא נקרא "${doc.filename}":` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: doc.mime,
          data: Buffer.from(doc.bytes).toString("base64"),
        },
      });
      used.push(doc.filename);
    }
  }

  content.push({ type: "text", text: `\nהשאלה: ${question}` });
  return { content, used };
}

/**
 * What the model is told to do.
 *
 * The instruction that matters is the last one. A lawyer acting on an invented
 * clause is worse off than one who was told to go and look, so not finding
 * something has to be an available answer rather than a failure to avoid.
 */
export const SYSTEM = [
  "אתה עוזר במשרד עורכי דין ישראלי. לפניך מסמכים של לקוח אחד.",
  "ענה בעברית, בקצרה, ותמיד ציין את שם המסמך שממנו לקוחה כל עובדה.",
  "אם התשובה אינה נמצאת במסמכים — אמור זאת במפורש ואל תשלים מהידע הכללי שלך.",
  "אל תנחש סכומים, תאריכים או שמות. עדיף לומר שלא מצאת.",
].join(" ");

/** Posts the question. Returns the answer text. */
export async function ask({ apiKey, model, content }) {
  let response;
  try {
    response = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (error) {
    throw new Error(`לא ניתן להגיע לשירות ה‑AI: ${error.cause?.code ?? error.message}`);
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) throw new Error(describe(response.status, body, text));

  const answer = (body?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

  if (!answer) throw new Error("השירות לא החזיר תשובה.");
  return answer;
}

function describe(status, body, text) {
  if (status === 401 || status === 403) {
    return "מפתח ה‑AI נדחה. בדוק אותו בהגדרות המשרד.";
  }
  if (status === 429) {
    return "חרגת ממכסת השימוש של חשבון ה‑AI שלך. נסה שוב בעוד כמה דקות.";
  }
  if (status === 400 && body?.error?.message?.includes("credit")) {
    return "אין יתרה בחשבון ה‑AI שלך.";
  }
  const detail = body?.error?.message ?? text.slice(0, 200);
  return `שירות ה‑AI החזיר ${status}: ${detail}`;
}
