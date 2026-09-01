/**
 * Sending a WhatsApp message through the firm's own gateway.
 *
 * This runs here rather than in the browser for one reason: the gateway's api
 * token is full control of that WhatsApp account — read the conversations,
 * write as the firm. The database refuses to hand it to the application at
 * all; only the service role can read that column, and only this service holds
 * the service role.
 *
 * So the browser asks "send this to that client", and the token never leaves
 * the server.
 */

/** Green API's shape. A second provider would add a branch, not a rewrite. */
const GREEN_API_HOST = "https://api.green-api.com";

/**
 * Israeli numbers arrive in every shape a person can type.
 *
 * Kept in step with the browser's copy deliberately rather than shared: this
 * is the last check before a message leaves, and it should not depend on the
 * caller having done the same work correctly.
 */
export function toChatId(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (!digits) return null;

  let national = null;
  if (digits.startsWith("+972")) national = digits.slice(4);
  else if (digits.startsWith("972")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    return rest.length >= 8 && rest.length <= 15 ? `${rest}@c.us` : null;
  } else return null;

  const clean = national.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 9) return null;
  return `972${clean}@c.us`;
}

/**
 * Posts one message.
 *
 * Green API answers 200 with a body describing the failure as often as it
 * answers an error status, so the body is what decides — a send reported as
 * successful because the status line was 200 is worse than one that failed
 * loudly.
 */
export async function sendMessage({ instanceId, apiToken, chatId, message }) {
  const url = `${GREEN_API_HOST}/waInstance${instanceId}/sendMessage/${apiToken}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
  } catch (error) {
    // The token is in the URL, so the cause is logged rather than the request.
    throw new Error(`לא ניתן להגיע לשירות הוואטסאפ: ${error.cause?.code ?? error.message}`);
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(describeStatus(response.status, body, text));
  }
  if (!body?.idMessage) {
    throw new Error(`השירות לא אישר את השליחה: ${text.slice(0, 200)}`);
  }

  return body.idMessage;
}

function describeStatus(status, body, text) {
  if (status === 401 || status === 403) {
    return "פרטי החיבור לוואטסאפ נדחו. בדוק את מזהה המופע והטוקן בהגדרות.";
  }
  if (status === 466) {
    // Green API's own code for a quota that has run out.
    return "חרגת ממכסת ההודעות של החשבון בשירות הוואטסאפ.";
  }
  const detail = body?.message ?? text.slice(0, 200);
  return `שירות הוואטסאפ החזיר ${status}: ${detail}`;
}
