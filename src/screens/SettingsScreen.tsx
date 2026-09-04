import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  createInvitation,
  getFirm,
  inviteLink,
  listInvitations,
  listMembers,
  logoUrl,
  removeLogo,
  removeMember,
  renameFirm,
  renameSelf,
  revokeInvitation,
  ROLE_EXPLAINS,
  ROLE_LABEL,
  setMemberRole,
  uploadLogo,
  type Firm,
  type Invitation,
  type Member,
  type OrgRole,
} from "@/lib/invitations";
import { MfaPanel } from "@/components/mfa-panel";
import { WhatsAppPanel } from "@/components/whatsapp-panel";
import { AiPanel } from "@/components/ai-panel";
import { ExportPanel } from "@/components/export-panel";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

const INVITABLE: OrgRole[] = ["lawyer", "intern", "secretary"];

/**
 * Everything about the firm itself, in one place behind one icon.
 *
 * These are the things a firm sets up once and returns to rarely — which is
 * exactly why they should not be scattered through screens people use daily,
 * and exactly why they need one obvious door rather than being remembered.
 */
export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { membership, session, signOut, refreshMembership } = useAuth();
  const [firm, setFirm] = useState<Firm | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = membership?.role === "owner";

  const reload = useCallback(async () => {
    try {
      const [f, m] = await Promise.all([getFirm(), listMembers()]);
      setFirm(f);
      setMembers(m);
      setInvites(isOwner ? await listInvitations() : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [isOwner]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Button variant="ghost" onClick={onClose} className="mb-3 px-0">
        ← חזרה
      </Button>

      <h1 className="mb-5 text-2xl font-bold">הגדרות המשרד</h1>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      <Section title="החשבון שלי">
        <MyAccount
          fullName={(session?.user.user_metadata?.full_name as string) ?? ""}
          email={session?.user.email ?? ""}
          role={membership ? ROLE_LABEL[membership.role] : ""}
          onSignOut={signOut}
          onChanged={reload}
        />
      </Section>

      {firm && isOwner && (
        <Section title="זהות המשרד">
          <FirmIdentity
            firm={firm}
            onChanged={async () => {
              await reload();
              // The name is in the header and in every client's form.
              await refreshMembership();
            }}
          />
        </Section>
      )}

      <Section title="משתמשים והרשאות">
        <Card className="p-0">
          <ul className="flex flex-col divide-y divide-rule">
            {members.map((m) => (
              <MemberRow
                key={m.user_id}
                member={m}
                isOwner={isOwner}
                isMe={m.user_id === session?.user.id}
                onChanged={reload}
              />
            ))}
          </ul>
        </Card>

        {isOwner &&
          (inviting ? (
            <div className="mt-3">
              <Card>
                <InviteForm
                  orgId={membership?.org_id ?? ""}
                  onSaved={async () => {
                    setInviting(false);
                    await reload();
                  }}
                  onCancel={() => setInviting(false)}
                />
              </Card>
            </div>
          ) : (
            <Button onClick={() => setInviting(true)} className="mt-3">
              הזמן משתמש
            </Button>
          ))}

        {isOwner && invites.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1.5 text-xs font-bold tracking-wide text-muted">הזמנות פתוחות</h3>
            <Card className="p-0">
              <ul className="flex flex-col divide-y divide-rule">
                {invites.map((inv) => (
                  <InviteRow key={inv.id} invite={inv} onChanged={reload} />
                ))}
              </ul>
            </Card>
          </div>
        )}
      </Section>

      {isOwner && (
        <Section title="וואטסאפ">
          <WhatsAppPanel />
          <AiPanel />
        </Section>
      )}

      <Section title="אבטחה">
        <MfaPanel />
      </Section>

      {isOwner && (
        <Section title="נתונים">
          <ExportPanel />
        </Section>
      )}
    </div>
  );
}

/**
 * Who you are, as opposed to which firm you belong to.
 *
 * The two were easy to confuse when only one of them could be edited: the firm
 * had a name field and the person did not, so the person's name looked like a
 * firm setting that refused to change.
 */
function MyAccount({
  fullName,
  email,
  role,
  onSignOut,
  onChanged,
}: {
  fullName: string;
  email: string;
  role: string;
  onSignOut: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(fullName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await renameSelf(name);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-muted" dir="ltr">
            {email}
          </span>
          <span className="mt-0.5 text-xs text-muted">{role}</span>
        </div>
        <Button variant="ghost" onClick={onSignOut} className="shrink-0">
          התנתק
        </Button>
      </div>

      <form onSubmit={save} className="flex flex-col gap-2 border-t border-rule pt-3">
        <Field
          label="השם שלי"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="מופיע בציר הזמן של תיק, ובשיוך משימות. אינו שם המשרד."
          required
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === fullName}
          className="self-start"
        >
          {busy ? "שומר..." : name.trim() === fullName ? "השם נשמר" : "שמור שם"}
        </Button>
      </form>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-xs font-bold tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function FirmIdentity({ firm, onChanged }: { firm: Firm; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(firm.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = logoUrl(firm.logo_path);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadLogo(firm.id, file);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await renameFirm(firm.id, name);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {/* Shown against white, because that is the ground it will sit on in
            the client's form and in a printed filing. */}
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule bg-white">
          {url ? (
            <img src={url} alt="לוגו המשרד" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted">אין לוגו</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="cursor-pointer text-sm font-semibold text-brand underline underline-offset-2">
            {busy ? "מעלה..." : url ? "החלף לוגו" : "העלה לוגו"}
            <input type="file" accept="image/*" className="hidden" onChange={pick} disabled={busy} />
          </label>
          {url && (
            <button
              onClick={async () => {
                await removeLogo(firm.id);
                await onChanged();
              }}
              className="self-start text-xs text-danger underline underline-offset-2"
            >
              הסר
            </button>
          )}
          <span className="text-xs text-muted">PNG, JPG, WEBP או SVG. עד 2 מ״ב.</span>
        </div>
      </div>

      <form onSubmit={save} className="flex flex-col gap-2">
        <Field
          label="שם המשרד"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="מופיע בכותרת, ובשאלון שהלקוח פותח"
          required
        />
        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Always here, greyed until there is something to save. A button that
            appears only once the text changes is a button somebody types into
            the field and then goes looking for — and on a phone the keyboard
            is over the place it would have appeared. */}
        <Button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === firm.name}
          className="self-start"
        >
          {busy ? "שומר..." : name.trim() === firm.name ? "השם נשמר" : "שמור שם"}
        </Button>
      </form>
    </Card>
  );
}

function MemberRow({
  member: m,
  isOwner,
  isMe,
  onChanged,
}: {
  member: Member;
  isOwner: boolean;
  isMe: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {m.profile?.full_name || m.profile?.email || "—"}
            {isMe && <span className="mr-1.5 text-xs font-normal text-muted">(אני)</span>}
          </span>
          {m.profile?.email && (
            <span className="truncate text-xs text-muted" dir="ltr">
              {m.profile.email}
            </span>
          )}
        </div>

        {isOwner ? (
          <div className="flex shrink-0 items-center gap-1">
            <select
              value={m.role}
              disabled={busy}
              onChange={(e) => act(() => setMemberRole(m.user_id, e.target.value as OrgRole))}
              className="rounded-md border border-rule bg-surface px-2 py-1 text-xs font-semibold
                         outline-none focus:border-brand disabled:opacity-50"
            >
              {(["owner", "lawyer", "intern", "secretary"] as OrgRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {!isMe && !confirming && (
              <button
                onClick={() => setConfirming(true)}
                className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
              >
                הסר
              </button>
            )}
          </div>
        ) : (
          <span className="shrink-0 rounded-full bg-ground px-2.5 py-1 text-xs font-semibold text-ink-soft">
            {ROLE_LABEL[m.role]}
          </span>
        )}
      </div>

      <span className="text-xs text-muted">{ROLE_EXPLAINS[m.role]}</span>

      {confirming && (
        <div className="flex flex-col gap-2 rounded-md bg-danger/10 p-3">
          {/* What survives is the part worth saying: removing somebody takes
              away access, it does not unpick the work they did. */}
          <p className="text-xs text-ink-soft">
            הגישה שלו למשרד תיפסק. התיקים, הרישומים והמסמכים שיצר נשארים כפי שהם.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => act(() => removeMember(m.user_id))}
              disabled={busy}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "מסיר..." : "הסר מהמשרד"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-rule/50"
            >
              השאר
            </button>
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
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

  if (link) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg font-bold">ההזמנה מוכנה</h3>
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
      <h3 className="text-lg font-bold">הזמנת משתמש</h3>

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
              className="mt-1 accent-[var(--color-brand,#0e6e6e)]"
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
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await revokeInvitation(invite.id);
                onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
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
