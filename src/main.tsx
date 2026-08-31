import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthScreen } from "@/screens/AuthScreen";
import { CreateFirmScreen } from "@/screens/CreateFirmScreen";
import { AppShell } from "@/screens/AppShell";
import { AcceptInviteScreen } from "@/screens/AcceptInviteScreen";
import { SecondStepScreen } from "@/screens/SecondStepScreen";
import { IntakeScreen } from "@/screens/IntakeScreen";
import { NewPasswordScreen } from "@/screens/NewPasswordScreen";
import "@/styles.css";

/** The two addresses worth having: joining a firm, and answering a firm. */
function tokenFromUrl(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Three states, decided by the session and the membership rather than by a URL,
 * plus an invitation that arrives as one. A router arrives when there are more
 * pages worth addressing than this.
 */
function App() {
  const { session, membership, loading, awaitingSecondStep, refreshAssurance, recovering, recoveryDone } =
    useAuth();
  const [invite, setInvite] = useState(() => tokenFromUrl("invite"));
  const [intake, setIntake] = useState(() => tokenFromUrl("intake"));

  // Dropping the token from the address bar once it is spent keeps a spent
  // link out of the browser history and out of a reload.
  function clearInvite() {
    window.history.replaceState({}, "", window.location.pathname);
    setInvite(null);
  }

  function clearIntake() {
    window.history.replaceState({}, "", window.location.pathname);
    setIntake(null);
  }

  // Ahead of everything, including the loading state: the person holding this
  // link has no account, so waiting for a session lookup that will find nothing
  // would show them a spinner for no reason.
  if (intake) return <IntakeScreen token={intake} onLeave={clearIntake} />;

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">
        טוען...
      </div>
    );
  }
  // Ahead of the invitation too: someone arriving on a reset link came to
  // change a password, whatever else is in the address bar.
  if (recovering) return <NewPasswordScreen onDone={recoveryDone} />;
  if (invite) return <AcceptInviteScreen token={invite} onDone={clearInvite} />;
  if (!session) return <AuthScreen />;
  // Ahead of the firm and the shell both: a session that has not answered the
  // challenge must not see a client name, not even for a moment.
  if (awaitingSecondStep) return <SecondStepScreen onPassed={refreshAssurance} />;
  if (!membership) return <CreateFirmScreen />;
  return <AppShell />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
