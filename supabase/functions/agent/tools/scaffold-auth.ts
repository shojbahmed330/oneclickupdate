// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeScaffoldAuthTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    scaffold_auth_pages: tool({
      description:
        "One-shot scaffold of complete frontend auth: writes Login.tsx, Register.tsx, ForgotPassword.tsx, ResetPassword.tsx, " +
        "useAuth hook, ProtectedRoute, and a client-side supabase setup file. Uses semantic tokens, mobile-first layout, " +
        "Zod validation, react-hook-form, and onAuthStateChange BEFORE getSession. " +
        "Call this AFTER supabase_setup_auth. The agent must still wire routes in router.tsx and run heal+build_app afterward.",
      inputSchema: z.object({
        with_google: z.boolean().default(false).describe("Add Google OAuth button on Login + Register."),
        base_dir: z.string().default("src").describe("Project root (default 'src')."),
      }),
      execute: async ({ with_google, base_dir }) => {
        const written: string[] = [];
        const w = async (rel: string, content: string) => {
          await sandbox.writeFile(`${cwd}/${base_dir}/${rel}`, content);
          written.push(`${base_dir}/${rel}`);
        };

        await w("hooks/useAuth.tsx", `import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthCtx { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void>; }
const Ctx = createContext<AuthCtx>({ session: null, user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listener FIRST, then getSession — required order.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };
  return <Ctx.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
`);

        await w("components/auth/ProtectedRoute.tsx", `import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
`);

        const googleBtn = with_google ? `
        <Button type="button" variant="outline" className="w-full active:scale-[0.97]"
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })}>
          Continue with Google
        </Button>` : "";

        await w("pages/auth/Login.tsx", `import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Schema = z.object({ email: z.string().email().max(255), password: z.string().min(6).max(128) });

export default function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Schema.safeParse({ email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    nav("/", { replace: true });
  };

  return (
    <main className="min-h-[100dvh] flex flex-col bg-background px-6 pt-[env(safe-area-inset-top)]">
      <header className="pt-12 pb-8"><h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
        <p className="text-muted-foreground mt-1">Sign in to continue</p></header>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div><Label>Email</Label><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><Label>Password</Label><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <Link to="/forgot-password" className="text-sm text-primary self-end -mt-2">Forgot password?</Link>
        <Button type="submit" disabled={loading} className="w-full active:scale-[0.97]">{loading ? "Signing in…" : "Sign in"}</Button>${googleBtn}
        <p className="text-center text-sm text-muted-foreground mt-2">No account? <Link to="/register" className="text-primary font-medium">Register</Link></p>
      </form>
    </main>
  );
}
`);

        await w("pages/auth/Register.tsx", `import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Schema = z.object({
  display_name: z.string().trim().min(2).max(60),
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
});

export default function Register() {
  const [display_name, setName] = useState(""); const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Schema.safeParse({ display_name, email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin, data: { display_name } },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Check your email to confirm your account.");
    nav("/login", { replace: true });
  };

  return (
    <main className="min-h-[100dvh] flex flex-col bg-background px-6 pt-[env(safe-area-inset-top)]">
      <header className="pt-12 pb-8"><h1 className="text-3xl font-bold text-foreground">Create account</h1>
        <p className="text-muted-foreground mt-1">Start in 30 seconds</p></header>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div><Label>Display name</Label><Input value={display_name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><Label>Email</Label><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><Label>Password</Label><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <Button type="submit" disabled={loading} className="w-full active:scale-[0.97]">{loading ? "Creating…" : "Create account"}</Button>${googleBtn}
        <p className="text-center text-sm text-muted-foreground mt-2">Have an account? <Link to="/login" className="text-primary font-medium">Sign in</Link></p>
      </form>
    </main>
  );
}
`);

        await w("pages/auth/ForgotPassword.tsx", `import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [loading, setLoading] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: \`\${window.location.origin}/reset-password\`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
  };
  return (
    <main className="min-h-[100dvh] flex flex-col bg-background px-6 pt-[env(safe-area-inset-top)]">
      <header className="pt-12 pb-8"><h1 className="text-3xl font-bold text-foreground">Reset password</h1>
        <p className="text-muted-foreground mt-1">We'll email you a reset link</p></header>
      {sent ? (
        <div className="rounded-2xl bg-card p-4 text-card-foreground">Check your inbox for the reset link.</div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <Button type="submit" disabled={loading} className="active:scale-[0.97]">{loading ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
      <Link to="/login" className="text-primary mt-4 self-center">Back to login</Link>
    </main>
  );
}
`);

        await w("pages/auth/ResetPassword.tsx", `import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ResetPassword() {
  const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    // Supabase emits PASSWORD_RECOVERY when user lands via email link.
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY") setRecovery(true);
    });
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password must be ≥6 chars"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated"); nav("/login", { replace: true });
  };

  return (
    <main className="min-h-[100dvh] flex flex-col bg-background px-6 pt-[env(safe-area-inset-top)]">
      <header className="pt-12 pb-8"><h1 className="text-3xl font-bold text-foreground">Set new password</h1></header>
      {recovery ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div><Label>New password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <Button type="submit" disabled={loading} className="active:scale-[0.97]">{loading ? "Updating…" : "Update password"}</Button>
        </form>
      ) : (
        <div className="text-muted-foreground">This page only works from a password-reset email link.</div>
      )}
    </main>
  );
}
`);

        return {
          ok: true,
          written,
          next_steps: [
            "Wrap the app in <AuthProvider> in main.tsx.",
            "Add routes in your router: /login, /register, /forgot-password, /reset-password (all PUBLIC).",
            "Wrap protected pages with <ProtectedRoute>.",
            "Run heal then build_app to verify.",
          ],
        };
      },
    }),

  };
}
