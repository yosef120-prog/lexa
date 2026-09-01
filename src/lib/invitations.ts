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
  // BASE_URL rather than a bare slash: the published site sits under a path,
  // and a link to the origin root would land on a 404, not on the invitation.
  return `${window.location.origin}${import.meta.env.BASE_URL}?invite=${token}`;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from("org_members")
    // Named, because a membership now points at profiles twice — the member and
    // whoever invited them — and an unqualified embed is ambiguous.
    .select("user_id, role, status, joined_at, profile:profiles!org_members_user_id_fkey(full_name, email)")
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

const MEMBER_TROUBLE: Record<string, string> = {
  LAST_OWNER: "צריך להישאר בעלים אחד לפחות. מנה בעלים נוסף קודם.",
};

function explainMember(error: { message: string }): string {
  const named = Object.keys(MEMBER_TROUBLE).find((k) => error.message.includes(k));
  return named ? MEMBER_TROUBLE[named] : describeDbError(error as Error);
}

/** Changing what somebody may do. Owners only, enforced by the policy. */
export async function setMemberRole(userId: string, role: OrgRole): Promise<void> {
  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("user_id", userId);
  if (error) throw new Error(explainMember(error));
}

/**
 * Taking somebody out of the firm.
 *
 * A real delete, unlike everything else here: a membership is a permission,
 * not a record of what happened. What they did stays — the audit trail and
 * every row they created keep their name.
 */
export async function removeMember(userId: string): Promise<void> {
  const { error } = await supabase.from("org_members").delete().eq("user_id", userId);
  if (error) throw new Error(explainMember(error));
}

export type Firm = { id: string; name: string; logo_path: string | null };

export async function getFirm(): Promise<Firm | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, logo_path")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(describeDbError(error));
  return data;
}

export async function renameFirm(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

const LOGO_BUCKET = "firm-logos";

/** The public URL of a logo, or null. Public by design — clients see it. */
export function logoUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadLogo(orgId: string, file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("הקובץ גדול מ־2 מ״ב. נסה תמונה קטנה יותר.");
  }

  // A new object each time rather than overwriting: the old URL may still be
  // sitting in a cache, and a logo that flickers between two firms' marks is
  // worse than one that takes a moment to appear.
  const path = `${orgId}/${crypto.randomUUID()}`;

  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) {
    if (error.message.toLowerCase().includes("mime")) {
      throw new Error("אפשר PNG, JPG, WEBP או SVG.");
    }
    throw new Error("לא הצלחנו להעלות את הלוגו. נסה שוב.");
  }

  const { error: saveError } = await supabase
    .from("organizations")
    .update({ logo_path: path })
    .eq("id", orgId);
  if (saveError) throw new Error(describeDbError(saveError));

  return path;
}

export async function removeLogo(orgId: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: null })
    .eq("id", orgId);
  if (error) throw new Error(describeDbError(error));
}
