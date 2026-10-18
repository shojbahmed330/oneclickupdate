import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { LazyMotion, domAnimation } from "framer-motion";
import { lazy, Suspense, useEffect } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
// Auth is lazy-split too — keeps initial bundle minimal even on /auth.
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { PageTransition } from "./components/motion/PageTransition";
import { useViewportHeight } from "./hooks/useViewportHeight";
import { BuilderSkeleton } from "./components/builder/Skeletons";
import { MaintenanceGate } from "./components/MaintenanceGate";
import { Logo } from "./components/Logo";
import { CommandPalette } from "./components/CommandPalette";
import { ThemeProvider } from "./components/ThemeProvider";
import { InstallBanner } from "./components/InstallBanner";
import { routeImporters, prefetchLikelyRoutes } from "./lib/prefetch";
import { MobileShell } from "./components/mobile/MobileShell";
import { getLastProjectId } from "./lib/lastProject";

const GithubOAuthCallback = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const message = params.get("message") || "GitHub connection complete";
    try {
      window.opener?.postMessage({ type: status === "success" ? "ghoauth_success" : "ghoauth_error", message }, window.location.origin);
    } catch {
      // Popup may have no opener if opened directly.
    }
    window.setTimeout(() => window.close(), 500);
  }, []);

  return (
    <div className="min-h-[100dvh] grid place-items-center bg-background text-foreground p-6 text-center">
      <div className="space-y-2">
        <Logo size="sm" />
        <p className="text-sm text-muted-foreground">Finishing GitHub connection…</p>
      </div>
    </div>
  );
};

// Heavy pages get lazy-loaded — Builder ships Monaco, framer animations, etc.
// We share importers with src/lib/prefetch.ts so a hover-prefetched chunk and
// the actual navigation hit the same in-flight promise (no double download).
const Index = lazy(() => import("./pages/Index.tsx"));
const Projects = lazy(routeImporters.projects); // formerly /dashboard, now /projects
const Builder = lazy(() => import("./pages/BuilderV2.tsx")); // new Daytona-backed agent workspace
const Profile = lazy(routeImporters.profile);
const Shop = lazy(routeImporters.shop);
const Admin = lazy(routeImporters.admin); // mounted at /admin
const AdminActivity = lazy(routeImporters.adminActivity);
const Support = lazy(routeImporters.support);
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));
const Splash = lazy(() => import("./pages/Splash.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const Notifications = lazy(() => import("./pages/Notifications.tsx"));
const Terms = lazy(() => import("./pages/legal/Terms.tsx"));
const Privacy = lazy(() => import("./pages/legal/Privacy.tsx"));
const Refund = lazy(() => import("./pages/legal/Refund.tsx"));
const Copyright = lazy(() => import("./pages/legal/Copyright.tsx"));
const Help = lazy(() => import("./pages/Help.tsx"));

/**
 * Once auth resolves, idle-prefetch the heavy signed-in pages so subsequent
 * navigation feels instant. Runs once per session.
 */
const RoutePrefetcher = () => {
  const { loading, user } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    prefetchLikelyRoutes();
  }, [loading, user]);
  return null;
};

// Global query defaults — keeps Dashboard/Builder snappy across tab switches.
// staleTime: 5 min → cached results served instantly, no refetch on remount.
// refetchOnWindowFocus: false → switching browser tabs doesn't fire a request storm.
// retry: 1 → fail fast on flaky network instead of stalling 3× exponential backoff.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

const ViewportSetup = ({ children }: { children: React.ReactNode }) => {
  useViewportHeight();
  return <>{children}</>;
};

// Lightweight fallback for most routes — instant, no heavy gradients/animations.
const RouteLoading = () => (
  <div className="min-h-[100dvh] grid place-items-center bg-background">
    <div className="flex flex-col items-center gap-3 opacity-80">
      <Logo size="sm" />
      <div className="h-1 w-24 rounded-full bg-muted overflow-hidden">
        <div className="h-full w-1/2 bg-primary animate-[shimmer_1.2s_linear_infinite]" />
      </div>
    </div>
  </div>
);

// Heavy branded fallback — only for the Builder route (Monaco etc.)
const BuilderLoading = () => <BuilderSkeleton />;

// Legacy redirect: /builder/:id → /dashboard/:id (and /builder → projects list).
const BuilderRedirect = () => {
  const { id } = useParams();
  return <Navigate to={id ? `/dashboard/${id}` : "/projects"} replace />;
};

// /dashboard (no id) → resume last active project if we have one,
// otherwise fall through to the project list. This prevents accidental
// `/` or `/dashboard` navigations from yanking the user out of their
// builder workspace when they reload or auth refreshes.
const DashboardEntry = () => {
  const last = getLastProjectId();
  return <Navigate to={last ? `/dashboard/${last}` : "/projects"} replace />;
};

// Wraps a lazy element in its own Suspense boundary so siblings don't share a heavy fallback.
const Lazy = ({ children, heavy = false }: { children: React.ReactNode; heavy?: boolean }) => (
  <Suspense fallback={heavy ? <BuilderLoading /> : <RouteLoading />}>{children}</Suspense>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LazyMotion features={domAnimation} strict={false}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
        <AuthProvider>
          <RoutePrefetcher />
          <ViewportSetup>
          <PageTransition>
            <MaintenanceGate>
              <CommandPalette />
              <InstallBanner />
              <MobileShell>
              <Routes>
                <Route path="/" element={<Lazy><Index /></Lazy>} />
                <Route path="/splash" element={<Lazy><Splash /></Lazy>} />
                <Route path="/onboarding" element={<Lazy><Onboarding /></Lazy>} />
                <Route path="/auth" element={<Lazy><Auth /></Lazy>} />
                <Route path="/github-oauth-callback" element={<GithubOAuthCallback />} />

                {/* /dashboard without an id should be the project list, not auto-create a workspace */}
                <Route path="/dashboard" element={<DashboardEntry />} />
                {/* /dashboard/:id = the AI chat workspace (formerly /builder) — heavy */}
                <Route path="/dashboard/:id" element={<Lazy heavy><Builder /></Lazy>} />

                {/* Projects = the project list (formerly /dashboard) */}
                <Route path="/projects" element={<Lazy><Projects /></Lazy>} />

                <Route path="/profile" element={<Lazy><Profile /></Lazy>} />
                <Route path="/shop" element={<Lazy><Shop /></Lazy>} />

                {/* Admin = main admin control center (formerly /admin/shop) */}
                <Route path="/admin" element={<Lazy><Admin /></Lazy>} />
                <Route path="/admin/activity" element={<Lazy><AdminActivity /></Lazy>} />

                <Route path="/support" element={<Lazy><Support /></Lazy>} />
                <Route path="/notifications" element={<Lazy><Notifications /></Lazy>} />

                {/* ── Legal pages (publicly accessible) ── */}
                <Route path="/terms" element={<Lazy><Terms /></Lazy>} />
                <Route path="/privacy" element={<Lazy><Privacy /></Lazy>} />
                <Route path="/refund-policy" element={<Lazy><Refund /></Lazy>} />
                <Route path="/copyright" element={<Lazy><Copyright /></Lazy>} />
                <Route path="/help" element={<Lazy><Help /></Lazy>} />
                <Route path="/docs" element={<Navigate to="/help" replace />} />
                <Route path="/faq" element={<Navigate to="/help" replace />} />

                {/* ── Legacy redirects (keep old links/bookmarks/notifications working) ── */}
                <Route path="/builder" element={<BuilderRedirect />} />
                <Route path="/builder/:id" element={<BuilderRedirect />} />
                <Route path="/admin/shop" element={<Navigate to="/admin" replace />} />

                <Route path="*" element={<Lazy><NotFound /></Lazy>} />
              </Routes>
              </MobileShell>
            </MaintenanceGate>
          </PageTransition>
          </ViewportSetup>
        </AuthProvider>
      </BrowserRouter>
      </TooltipProvider>
      </LazyMotion>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
