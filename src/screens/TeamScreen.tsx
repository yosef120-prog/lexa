import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  createInvitation,
  inviteLink,
  listInvitations,
  listMembers,
  revokeInvitation,
  ROLE_EXPLAINS,
  ROLE_LABEL,
  type Invitation,
  type Member,
  type OrgRole,
} from "@/lib/invitations";
import { count } from "@/lib/hebrew";
import { ExportPanel } from "@/components/export-panel";
import { MfaPanel } from "@/components/mfa-panel";
import { IntakeBuilder } from "@/components/intake-builder";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

const INVITABLE: OrgRole[] = ["lawyer", "intern", "secretary"];

/**
 * Who is in the firm, and who has been asked to join.
 *
 * Nothing here sends an email: there is no sending domain on this project, and
 * a link the owner passes on themselves is a promise the system can keep.
 */
export function TeamScreen() {
  const { membership } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = membership?.role === "owner";

  const reload = useCallback(async () => {
    try {
      setMembers(await listMembers());
      setInvites(isOwner ? await listInvitations() : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">המשרד</h1>
          <p className="text-sm text-muted">
            {loading ? "טוען..." : count(members.length, "משתמש אחד", "משתמשים")}
          </p>
        </div>
        {isOwner && !inviting && <Button onClick={() => setInviting(true)}>הזמן משתמש</Button>}
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {inviting && (
        <Card className="mb-5">
          <InviteForm
            orgId={membership?.org_id ?? ""}
            onSaved={() => {
              setInviting(false);
              void reload();
            }}
            onCancel={() => setInviting(false)}
          />
        </Card>
      )}

      <Card className="mb-5 p-0">
        <ul className="flex flex-col divide-y divide-rule">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">
                  {m.profile?.full_name || m.profile?.email || "—"}
                </span>
                {m.profile?.full_name && m.profile?.email && (
                  <span className="truncate text-xs text-muted" dir="ltr">
                    {m.profile.email}
                  </span>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-ground px-2.5 py-1 text-xs font-semibold text-ink-soft">
                {ROLE_LABEL[m.role]}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && invites.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-1.5 text-xs font-bold tracking-wide text-muted">הזמנות פתוחות</h2>
          <Card className="p-0">
            <ul className="flex flex-col divide-y divide-rule">
              {invites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} onChanged={reload} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      <IntakeBuilder />

      <MfaPanel />

      {isOwner && <div className="mt-5"><ExportPanel /></div>}
    </div>
  );
}

function InviteForm({
  orgId,
  onSaved,
  onCancel,
}: {
  orgId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("lawyer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createInvitation(orgId, email, role);
      setLink(inviteLink(created.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // The link is the product of this form, so it is shown rather than promised.
  if (link) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">ההזמנה מוכנה</h2>
          <p className="text-sm text-ink-soft">
            שלח את הקישור ל־<span dir="ltr">{email}</span>. הוא תקף שבוע, ורק אותה כתובת יכולה
            להשתמש בו.
          </p>
        </div>
        <CopyLink link={link} />
        <Button onClick={onSaved}>סיימתי</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">הזמנת משתמש</h2>

      <Field
        label="כתובת אימייל"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        dir="ltr"
        autoFocus
        required
        hint="ההזמנה תעבוד רק מהכתובת הזו."
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">תפקיד</legend>
        {INVITABLE.map((r) => (
          <label
            key={r}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${
              role === r ? "border-brand bg-brand/5" : "border-rule"
            }`}
          >
            <input
              type="radio"
              name="role"
              checked={role === r}
              onChange={() => setRole(r)}
              className="mt-1 accent-[var(--color-brand,#1f4e79)]"
            />
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{ROLE_LABEL[r]}</span>
              <span className="text-xs text-muted">{ROLE_EXPLAINS[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? "יוצר..." : "צור קישור הזמנה"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

function InviteRow({ invite, onChanged }: { invite: Invitation; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const daysLeft = Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / 86_400_000);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeInvitation(invite.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold" dir="ltr">
            {invite.email}
          </span>
          <span className="text-xs text-muted">
            {ROLE_LABEL[invite.role]} · {daysLeft > 0 ? `תקף עוד ${daysLeft} ימים` : "פג"}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setShown((s) => !s)}
            className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
          >
            {shown ? "הסתר" : "קישור"}
          </button>
          <button
            onClick={revoke}
            disabled={busy}
            className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            בטל
          </button>
        </div>
      </div>
      {shown && <CopyLink link={inviteLink(invite.token)} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is on screen and selectable
      // either way, so there is nothing to recover from.
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-ground p-2">
      <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">
        {link}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
      >
        {copied ? "הועתק" : "העתק"}
      </button>
    </div>
  );
}
