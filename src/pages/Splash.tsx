import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";

/**
 * Splash — first-paint screen.
 * Routes after auth resolves:
 *   - signed-in → /projects
 *   - first-time visitor (no flag) → /onboarding
 *   - returning (flag set) → /auth
 */
export default function Splash() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    const seen = localStorage.getItem("onboarded");
    const t = setTimeout(() => {
      if (user) navigate("/projects", { replace: true });
      else if (seen) navigate("/auth", { replace: true });
      else navigate("/onboarding", { replace: true });
    }, 600);
    return () => clearTimeout(t);
  }, [user, loading, navigate]);

  return (
    <div className="min-h-[100dvh] grid place-items-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-editorial pointer-events-none" aria-hidden />
      <div className="absolute inset-0 grid-bg opacity-[0.08] pointer-events-none" aria-hidden />
      <div className="relative flex flex-col items-center gap-6 animate-editorial-rise">
        <Logo size="lg" />
        <div className="font-display text-[28px] tracking-[-0.04em] leading-none text-editorial italic">
          one prompt, one app.
        </div>
        <div className="h-[3px] w-32 rounded-full bg-muted/60 overflow-hidden">
          <div className="h-full w-1/2 bg-gradient-to-r from-primary to-accent-cyan animate-[shimmer_1.2s_linear_infinite]" />
        </div>
      </div>
    </div>
  );
}
