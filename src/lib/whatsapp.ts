/**
 * Opening WhatsApp with the message already written.
 *
 * The brief's biggest named pain is clients who never send their documents,
 * and the gap between "here is a link" and "the client has it" is a person
 * copying a URL, switching apps, finding the contact and pasting. Every one of
 * those is somewhere it does not happen.
 *
 * Free of any Supabase or React import so the number handling can be tested on
 * its own — a phone number quietly mangled is a message sent to a stranger.
 */

/**
 * An Israeli number in the form wa.me wants: country code, no plus, no
 * separators.
 *
 * Returns null rather than guessing when the number is not one it recognises.
 * A wrong number here does not fail, it delivers a client's questionnaire link
 * to whoever does own it.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // People write 052-123-4567, 052 1234567, +972-52-1234567, (052)1234567.
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  // Already international.
  if (digits.startsWith("+972")) return normaliseIl(digits.slice(4));
  if (digits.startsWith("972")) return normaliseIl(digits.slice(3));

  // A local number: 0 then the rest.
  if (digits.startsWith("0")) return normaliseIl(digits.slice(1));

  // Some other country, written in full. Passed through rather than assumed
  // to be Israeli — a firm can have a client abroad.
  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    return rest.length >= 8 && rest.length <= 15 ? rest : null;
  }

  return null;
}

/**
 * The national part, after the country code and the leading zero are gone.
 *
 * Israeli mobile and landline national numbers are eight or nine digits. Both
 * are accepted; anything else is refused rather than padded into something
 * that looks plausible.
 */
function normaliseIl(national: string): string | null {
  const digits = national.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 9) return null;
  return `972${digits}`;
}

/**
 * The message a firm sends with an intake link.
 *
 * Written to be sent as it is. It says who it is from, what it costs the
 * reader, and that nothing needs installing — which is the objection a client
 * raises before they have read the rest.
 */
export function intakeMessage(input: {
  clientName: string;
  firmName: string;
  formName: string;
  link: string;
}): string {
  const first = input.clientName.trim().split(/\s+/)[0] || input.clientName;
  return (
    `שלום ${first},\n\n` +
    `מ${input.firmName}. כדי שנוכל להתקדם, מלא/י בבקשה את הטופס הקצר הזה וצרף/י את המסמכים. ` +
    `לוקח כמה דקות מהטלפון, בלי הרשמה ובלי סיסמה:\n\n` +
    `${input.link}\n\n` +
    `${input.formName}`
  );
}

/**
 * A wa.me link.
 *
 * Without a number it still opens WhatsApp with the text ready and asks who to
 * send to, which is better than nothing when the client card has no phone.
 */
export function whatsAppLink(number: string | null, message: string): string {
  const text = encodeURIComponent(message);
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}
