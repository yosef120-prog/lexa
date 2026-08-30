import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/** Supabase returns English; lawyers using this deserve Hebrew that says what to do. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "אימייל או סיסמה שגויים.";
  if (m.includes("already registered")) return "האימייל הזה כבר רשום. נסה להתחבר.";
  if (m.includes("password should be at least")) return "הסיסמה קצרה מדי — לפחות 6 תווים.";
  if (m.includes("email address") && m.includes("invalid")) return "כתובת האימייל אינה תקינה.";
  if (m.includes("email not confirmed")) return "האימייל עוד לא אומת. בדוק את תיבת הדואר.";
  return message;
}

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        // With email confirmation on, signUp succeeds but returns no session.
        // Say so plainly instead of leaving a dead-looking form.
        if (!data.session) setConfirmSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setError(translateAuthError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (confirmSent) {
    return (
      <Centered>
        <Card className="flex flex-col gap-3 text-center">
          <h1 className="text-xl font-bold">נשלח אליך אימייל אימות</h1>
          <p className="text-sm text-ink-soft">
            שלחנו קישור ל־<span className="font-semibold">{email}</span>. לחץ עליו כדי להשלים את
            ההרשמה, ואז חזור לכאן להתחבר.
          </p>
          <Button variant="ghost" onClick={() => { setConfirmSent(false); setMode("signin"); }}>
            כבר אימתתי — למסך ההתחברות
          </Button>
        </Card>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">LEXA</h1>
          <p className="mt-1 text-sm text-muted">ניהול משרד עורכי דין</p>
        </div>

        <Card>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">
              {mode === "signup" ? "פתיחת חשבון" : "התחברות"}
            </h2>

            {mode === "signup" && (
              <Field
                label="שם מלא"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            )}

            <Field
              label="אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              dir="ltr"
              required
            />

            <Field
              label="סיסמה"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              hint={mode === "signup" ? "לפחות 6 תווים" : undefined}
              required
            />

            {error && <ErrorNote>{error}</ErrorNote>}

            <Button type="submit" disabled={busy}>
              {busy ? "רגע..." : mode === "signup" ? "פתח חשבון" : "התחבר"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-ink-soft">
          {mode === "signup" ? "כבר יש לך חשבון?" : "אין לך עדיין חשבון?"}{" "}
          <button
            className="font-semibold text-brand underline underline-offset-2"
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}
          >
            {mode === "signup" ? "התחבר" : "פתח חשבון"}
          </button>
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
