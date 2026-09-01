/**
 * Turning a phone number into one WhatsApp will accept.
 *
 * A number quietly mangled here does not fail loudly — it delivers a client's
 * questionnaire link, with their name on it, to whoever does own that number.
 * So the refusals matter as much as the conversions.
 */
import { toWhatsAppNumber, intakeMessage, whatsAppLink } from "../src/lib/whatsapp.ts";

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

console.log("\nwhatsapp · the number\n");

// The shapes people actually type into a client card.
check("a plain mobile", toWhatsAppNumber("0521234567"), "972521234567");
check("with hyphens", toWhatsAppNumber("052-123-4567"), "972521234567");
check("with spaces", toWhatsAppNumber("052 123 4567"), "972521234567");
check("in brackets", toWhatsAppNumber("(052)1234567"), "972521234567");
check("already international", toWhatsAppNumber("+972521234567"), "972521234567");
check("international without the plus", toWhatsAppNumber("972521234567"), "972521234567");
check("international with separators", toWhatsAppNumber("+972-52-123-4567"), "972521234567");

// An eight-digit national number is a landline, and just as valid.
check("a landline", toWhatsAppNumber("03-1234567"), "97231234567");

// A firm can have a client abroad; that number is passed through rather than
// assumed to be Israeli and prefixed into somebody else's line.
check("a foreign number in full", toWhatsAppNumber("+442071234567"), "442071234567");

// Everything it cannot place is refused. Guessing is what sends the link to a
// stranger.
check("nothing at all", toWhatsAppNumber(""), null);
check("null", toWhatsAppNumber(null), null);
check("too short to be a number", toWhatsAppNumber("0521234"), null);
check("too long", toWhatsAppNumber("05212345678901"), null);
check("letters", toWhatsAppNumber("לא ידוע"), null);

console.log("\nwhatsapp · the message\n");

const message = intakeMessage({
  clientName: "יוסף חיים כהן",
  firmName: "משרד דניאל",
  formName: "שאלון פתיחת תיק",
  link: "https://example.test/?intake=abc",
});

// First name only: "שלום יוסף חיים כהן" reads like a summons.
check("greets by first name", message.startsWith("שלום יוסף,"), true);
check("says which firm it is from", message.includes("משרד דניאל"), true);
check("carries the link", message.includes("https://example.test/?intake=abc"), true);
// The objection a client raises before reading the rest.
check("answers the objection up front", message.includes("בלי הרשמה ובלי סיסמה"), true);

check(
  "the link addresses the number when there is one",
  whatsAppLink("972521234567", "hi").startsWith("https://wa.me/972521234567?text="),
  true,
);
// Better than nothing: WhatsApp opens with the text ready and asks who to.
check(
  "and asks who to send to when there is not",
  whatsAppLink(null, "hi").startsWith("https://wa.me/?text="),
  true,
);
check("the text is encoded", whatsAppLink(null, "a b").includes("a%20b"), true);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
