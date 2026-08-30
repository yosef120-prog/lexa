import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

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
  refreshMembership: () => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // onAuthStateChange fires immediately with the restored session, so it
    // covers the initial load as well as later sign-in and sign-out.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
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
    refreshMembership: async () => setMembership(await loadMembership()),
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
