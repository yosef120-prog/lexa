import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

/**
 * Two-step sign-in.
 *
 * The brief asks for it on the owner's account, and the reason is specific to
 * this product rather than general good practice: one password is the only
 * thing between a stolen laptop and every client file in the firm, including
 * the ones the firm is under a duty to keep.
 *
 * The codes are TOTP, so any authenticator app works and nothing here depends
 * on SMS — which costs money per message and is the weakest second factor
 * anyway.
 */

export type Factor = {
  id: string;
  friendly_name: string | null;
  status: "verified" | "unverified";
  created_at: string;
};

/**
 * Whether this session has already answered a code.
 *
 * `next` is what the account requires; `current` is what the session has done.
 * They differ for exactly as long as it takes to type six digits, and that gap
 * is the thing every screen has to respect.
 */
export type Assurance = { current: string | null; next: string | null };

export async function getAssurance(): Promise<Assurance> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(describeMfaError(error));
  return { current: data.currentLevel, next: data.nextLevel };
}

/** True while the account expects a code that this session has not given. */
export function needsCode(a: Assurance): boolean {
  return a.next === "aal2" && a.current === "aal1";
}

export async function listFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(describeMfaError(error));
  return (data?.totp ?? []) as Factor[];
}

export type Enrolment = { factorId: string; qrSvg: string; secret: string };

/**
 * Starts enrolment and hands back what the phone needs.
 *
 * The secret comes back alongside the QR code on purpose: a lawyer setting
 * this up on the same phone they are reading it on cannot photograph their own
 * screen, and typing the secret is the way out of that.
 */
export async function beginEnrolment(): Promise<Enrolment> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `LEXA ${new Date().toLocaleDateString("he-IL")}`,
  });
  if (error) throw new Error(describeMfaError(error));
  return {
    factorId: data.id,
    qrSvg: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/**
 * Finishes enrolment, or answers the challenge at sign-in.
 *
 * The same two calls either way — Supabase does not distinguish, and neither
 * should this, because a wrong code means the same thing in both places.
 */
export async function submitCode(factorId: string, code: string): Promise<void> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw new Error(describeMfaError(challengeError));

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.replace(/\s/g, ""),
  });
  if (error) throw new Error(describeMfaError(error));
}

/**
 * Turning it off.
 *
 * Deliberately requires a current code first — otherwise anyone who sat down
 * at an unlocked screen could remove the protection in one click, which would
 * make it decoration.
 */
export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(describeMfaError(error));
}

/** Cleans up a half-finished enrolment, so a second attempt can start fresh. */
export async function abandonEnrolment(factorId: string): Promise<void> {
  try {
    await supabase.auth.mfa.unenroll({ factorId });
  } catch {
    // Nothing to recover: an unverified factor cannot be used to sign in, and
    // the next enrolment replaces it.
  }
}

function describeMfaError(error: { message?: string; code?: string }): string {
  const message = error.message ?? "";

  // The one people actually hit, and almost always for the same reason.
  if (message.includes("Invalid TOTP code") || message.includes("invalid_code")) {
    return "הקוד שגוי או פג. ודא שהשעון בטלפון מסונכרן ונסה את הקוד הנוכחי.";
  }
  if (message.includes("already exists") || message.includes("friendly name")) {
    return "כבר קיים אימות בהגדרה. רענן את הדף ונסה שוב.";
  }
  if (message.includes("mfa_verification_rejected") || message.includes("too many")) {
    return "יותר מדי ניסיונות. המתן דקה ונסה שוב.";
  }

  return describeDbError(error as Error);
}
