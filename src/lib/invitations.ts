import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import type { Membership } from "@/lib/auth";

export type OrgRole = Membership["role"];

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

export const ROLE_EXPLAINS: Record<OrgRole, string> = {
  owner: "רואה הכל, כולל כספים, ומנהל את המשתמשים.",
  lawyer: "רואה תיקים וכספים, כותב ומוחק.",
  intern: "רואה תיקים וכותב, בלי כספים.",
  secretary: "יומן, מסמכים ומשימות. בלי כספים.",
};

export type Invitation = {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export type Member = {
  user_id: string;
  role: OrgRole;
  status: string;
  joined_at: string | null;
  profile: { full_name: string | null; email: string | null } | null;
};

export function inviteLink(token: string): string {
  return `${window.location.origin}/?invite=${token}`;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, role, status, joined_at, profile:profiles(full_name, email)")
    .order("joined_at", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []).map((row) => {
    const p = (row as Record<string, unknown>).profile;
    return {
      ...(row as unknown as Member),
      profile: Array.isArray(p) ? ((p[0] as Member["profile"]) ?? null) : (p as Member["profile"]),
    };
  });
}

/** Live invitations only. A revoked or spent link is noise on this screen. */
export async function listInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("org_invitations")
    .select("id, email, role, token, created_at, expires_at, accepted_at, revoked_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));
  return data ?? [];
}

export async function createInvitation(
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<Invitation> {
  const { data, error } = await supabase
    .from("org_invitations")
    .insert({ org_id: orgId, email: email.trim().toLowerCase(), role })
    .select("id, email, role, token, created_at, expires_at, accepted_at, revoked_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("כבר קיימת הזמנה פתוחה לכתובת הזו. בטל אותה קודם.");
    }
    throw new Error(describeDbError(error));
  }
  return data;
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await supabase
    .from("org_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

export type InvitePeek = {
  org_name: string | null;
  email: string | null;
  role: OrgRole | null;
  valid: boolean;
  reason: string | null;
};

/** What the link can say before anyone signs in. */
export async function peekInvitation(token: string): Promise<InvitePeek> {
  const { data, error } = await supabase.rpc("peek_invitation", { p_token: token });
  if (error) throw new Error(describeDbError(error));
  const row = (data as InvitePeek[] | null)?.[0];
  return row ?? { org_name: null, email: null, role: null, valid: false, reason: "INVITE_NOT_FOUND" };
}

const REDEEM_TROUBLE: Record<string, string> = {
  INVITE_NOT_FOUND: "הקישור הזה לא מוכר. בקש קישור חדש.",
  INVITE_REVOKED: "ההזמנה בוטלה.",
  INVITE_ALREADY_USED: "כבר השתמשו בהזמנה הזו.",
  INVITE_EXPIRED: "ההזמנה פגה. בקש קישור חדש.",
  INVITE_WRONG_ACCOUNT: "ההזמנה נשלחה לכתובת אחרת. התחבר עם הכתובת שאליה נשלחה.",
  ALREADY_A_MEMBER: "אתה כבר חבר במשרד הזה.",
  AUTH_REQUIRED: "התחבר קודם.",
};

export function describeInviteTrouble(reason: string | null): string {
  if (!reason) return "";
  return REDEEM_TROUBLE[reason] ?? "לא ניתן להשתמש בהזמנה הזו.";
}

export async function acceptInvitation(token: string): Promise<void> {
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    const named = Object.keys(REDEEM_TROUBLE).find((k) => error.message.includes(k));
    if (named) throw new Error(REDEEM_TROUBLE[named]);
    throw new Error(describeDbError(error));
  }
}
