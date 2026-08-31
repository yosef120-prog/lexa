import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthScreen } from "@/screens/AuthScreen";
import { CreateFirmScreen } from "@/screens/CreateFirmScreen";
import { AppShell } from "@/screens/AppShell";
import { AcceptInviteScreen } from "@/screens/AcceptInviteScreen";
import "@/styles.css";

/** The one address worth having: the link that brings someone into a firm. */
function inviteTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("invite");
}

/**
 * Three states, decided by the session and the membership rather than by a URL,
 * plus an invitation that arrives as one. A router arrives when there are more
 * pages worth addressing than this.
 */
function App() {
  const { session, membership, loading } = useAuth();
  const [invite, setInvite] = useState(inviteTokenFromUrl);

  // Dropping the token from the address bar once it is spent keeps a spent
  // link out of the browser history and out of a reload.
  function clearInvite() {
    window.history.replaceState({}, "", window.location.pathname);
    setInvite(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">
        טוען...
      </div>
    );
  }
  if (invite) return <AcceptInviteScreen token={invite} onDone={clearInvite} />;
  if (!session) return <AuthScreen />;
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
