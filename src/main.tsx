import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthScreen } from "@/screens/AuthScreen";
import { CreateFirmScreen } from "@/screens/CreateFirmScreen";
import { AppShell } from "@/screens/AppShell";
import "@/styles.css";

/**
 * Three states, decided by the session and the membership rather than by a URL.
 * A router arrives with stage 2, when there are pages worth addressing.
 */
function App() {
  const { session, membership, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">
        טוען...
      </div>
    );
  }
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
