import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getAssurance, needsCode, type Assurance } from "@/lib/mfa";

export type Membership = {
  org_id: string;
  role: "owner" | "lawyer" | "intern" | "secretary";
  org_name: string;
};

type AuthState = {
  session: Session | null;
  membership: Membership | null;
  /** True until both the session and the membership lookup have settled. */
  loading: boolean;
  /**
   * True when the account expects a code this session has not given. Held here
   * rather than checked per screen: it gates the whole app, so one answer.
   */
  awaitingSecondStep: boolean;
  /**
   * True from the moment a reset link is opened until a new password is saved.
   * A recovery link produces a real session, so without this the app would let
   * someone straight in and never ask for the password they came to change.
   */
  recovering: boolean;
  refreshMembership: () => Promise<void>;
  refreshAssurance: () => Promise<void>;
  recoveryDone: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Reads the caller's own membership. RLS means this returns the firms the user
 * belongs to and nothing else, so no filter by user id is needed here — the
 * database applies it.
 */
async function loadMembership(): Promise<Membership | null> {
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, role, organizations(name)")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("membership lookup failed", error);
    return null;
  }
  if (!data) return null;

  const org = data.organizations as unknown as { name: string } | null;
  return { org_id: data.org_id, role: data.role, org_name: org?.name ?? "" };
}

/**
 * A failure here must not lock anybody out.
 *
 * If the assurance level cannot be read, the safe answer is the one that lets
 * a lawyer into their own files: an account with no second factor is not
 * expecting a code, and one that is will still be refused by the database.
 */
async function readAssurance(): Promise<Assurance> {
  try {
    return await getAssurance();
  } catch (e) {
    console.warn("assurance level unavailable", e);
    return { current: null, next: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [assurance, setAssurance] = useState<Assurance | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let active = true;

    // onAuthStateChange fires immediately with the restored session, so it
    // covers the initial load as well as later sign-in and sign-out.
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(next);

      // Assurance first. The membership query is harmless, but ordering the
      // gate ahead of the data is the habit worth keeping.
      setAssurance(next ? await readAssurance() : null);
      setMembership(next ? await loadMembership() : null);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,
    membership,
    loading,
    awaitingSecondStep: assurance !== null && needsCode(assurance),
    recovering,
    recoveryDone: () => setRecovering(false),
    refreshMembership: async () => setMembership(await loadMembership()),
    refreshAssurance: async () => setAssurance(await readAssurance()),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
