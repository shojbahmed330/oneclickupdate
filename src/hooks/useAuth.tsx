import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { clearLastProjectId } from "@/lib/lastProject";
import { setSentryUser } from "@/lib/sentry";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Auto-signout guard: when Supabase reports a broken session
    // (token refresh failure, deleted user, signed-out elsewhere) we
    // wipe local state + redirect to /auth so the next API call doesn't
    // explode with 401/403 against has_role() etc.
    const handleBrokenSession = async () => {
      clearLastProjectId();
      setSession(null);
      setUser(null);
      setSentryUser(null);
      try { await supabase.auth.signOut(); } catch { /* already gone */ }
      if (typeof window !== "undefined" && window.location.pathname !== "/auth") {
        window.location.replace("/auth?reason=session_expired");
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === "TOKEN_REFRESHED" && !s) {
        void handleBrokenSession();
        return;
      }
      if (evt === "SIGNED_OUT" || (evt === "USER_UPDATED" && !s)) {
        setSession(null);
        setUser(null);
        setSentryUser(null);
        return;
      }
      setSession(s);
      setUser(s?.user ?? null);
      setSentryUser(s?.user ? { id: s.user.id, email: s.user.email } : null);
    });

    supabase.auth.getSession().then(async ({ data: { session: s }, error }) => {
      if (error || (s && !s.user)) {
        await handleBrokenSession();
        setLoading(false);
        return;
      }
      if (s) {
        // Validate the session is still good server-side. If the JWT
        // references a deleted/rotated session, getUser() returns 401
        // and we force a clean signout so RLS calls don't fail later.
        const { error: getUserErr } = await supabase.auth.getUser();
        if (getUserErr) {
          await handleBrokenSession();
          setLoading(false);
          return;
        }
      }
      setSession(s);
      setUser(s?.user ?? null);
      setSentryUser(s?.user ? { id: s.user.id, email: s.user.email } : null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    clearLastProjectId();
    await supabase.auth.signOut();
  };

  return <Ctx.Provider value={{ user, session, loading, signOut }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
