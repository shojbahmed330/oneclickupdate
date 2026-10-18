// Admin panel scaffold.
//
// Why this exists: every non-trivial app (e-commerce, social, marketplace,
// dashboards) needs a /admin route gated by a role-based check. Before this
// tool the agent had to hand-write 6+ files every time (roles enum, user_roles
// table, has_role function, AdminRoute guard, AdminLayout, sample page).
//
// One call → writes:
//   - supabase/migrations/<ts>_admin_roles.sql  (enum + user_roles + has_role)
//   - src/hooks/useUserRole.ts                  (live role lookup)
//   - src/components/admin/AdminRoute.tsx       (route guard)
//   - src/components/admin/AdminShell.tsx       (sidebar + outlet)
//   - src/pages/admin/AdminDashboard.tsx        (welcome page with stats)
//   - src/pages/admin/AdminUsers.tsx            (user list + promote/demote)
//
// Security: roles live in a SEPARATE table (never on profiles) and are checked
// via SECURITY DEFINER has_role() — the canonical Supabase pattern that
// prevents the recursive-RLS and privilege-escalation footguns.

import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeAdminScaffoldTools(sandbox: DaytonaSandbox, _ctx: ToolCtx, cwd: string) {
  return {
    scaffold_admin_panel: tool({
      description:
        "Scaffold a complete role-based admin panel: user_roles table + has_role() SECURITY DEFINER function + RLS, " +
        "useUserRole hook, AdminRoute guard, AdminShell layout with sidebar, sample AdminDashboard and AdminUsers pages. " +
        "Call this whenever the app needs an /admin section (e-commerce, social media, CRM, marketplace, SaaS dashboards). " +
        "After running: apply the migration, wire /admin/* routes in router, and seed the first admin via SQL " +
        "(INSERT INTO user_roles (user_id, role) VALUES ('<your-uid>', 'admin')).",
      inputSchema: z.object({
        roles: z.array(z.string().regex(/^[a-z_]+$/)).default(["admin", "moderator", "user"])
          .describe("Roles enum values. Default ['admin','moderator','user']."),
        sections: z.array(z.string()).default(["dashboard", "users"])
          .describe("Admin sections to scaffold pages for. dashboard + users are always created."),
        base_dir: z.string().default("src"),
      }),
      execute: async ({ roles, sections, base_dir }) => {
        const written: string[] = [];
        const w = async (rel: string, content: string) => {
          await sandbox.writeFile(`${cwd}/${rel}`, content);
          written.push(rel);
        };

        const rolesUnion = roles.map((r) => `'${r}'`).join(", ");
        const rolesTs = roles.map((r) => `"${r}"`).join(" | ");

        // 1. Migration -----------------------------------------------------
        const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        await w(
          `supabase/migrations/${ts}_admin_roles.sql`,
          `-- Role-based admin panel: enum + user_roles table + SECURITY DEFINER check.
-- Pattern follows Supabase's canonical recursive-RLS-safe design.

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (${rolesUnion});
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$fn$;

DROP POLICY IF EXISTS "users view own roles" ON public.user_roles;
CREATE POLICY "users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage all roles" ON public.user_roles;
CREATE POLICY "admins manage all roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed first admin:
-- INSERT INTO public.user_roles (user_id, role) VALUES ('<your-auth-uid>', 'admin');
`,
        );

        // 2. useUserRole hook ----------------------------------------------
        await w(
          `${base_dir}/hooks/useUserRole.ts`,
          `import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = ${rolesTs};

export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setRoles([]); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id);
      if (cancelled) return;
      if (error) console.error("[useUserRole]", error);
      setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return {
    roles,
    loading: loading || authLoading,
    isAdmin: roles.includes("admin" as AppRole),
    hasRole: (r: AppRole) => roles.includes(r),
  };
}
`,
        );

        // 3. AdminRoute guard ----------------------------------------------
        await w(
          `${base_dir}/components/admin/AdminRoute.tsx`,
          `import { Navigate, useLocation } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { isAdmin, loading } = useUserRole();
  const loc = useLocation();

  if (authLoading || loading) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground">Checking access…</div>;
  }
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (!isAdmin) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Access denied</h1>
        <p className="text-muted-foreground">You don't have admin permissions for this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
`,
        );

        // 4. AdminShell layout ---------------------------------------------
        const navItems = ["dashboard", ...sections.filter((s) => s !== "dashboard")]
          .map((s) => ({ key: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));
        const navTs = JSON.stringify(navItems);

        await w(
          `${base_dir}/components/admin/AdminShell.tsx`,
          `import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Users, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const NAV = ${navTs} as const;
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, users: Users, settings: Settings,
};

export function AdminShell() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-[100dvh] flex bg-background">
      <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-5 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Admin</h2>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const Icon = ICONS[item.key] ?? Settings;
            return (
              <NavLink
                key={item.key}
                to={item.key === "dashboard" ? "/admin" : \`/admin/\${item.key}\`}
                end={item.key === "dashboard"}
                className={({ isActive }) =>
                  \`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors active:scale-[0.98] \${
                    isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                  }\`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6 md:p-8 max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
`,
        );

        // 5. AdminDashboard page -------------------------------------------
        await w(
          `${base_dir}/pages/admin/AdminDashboard.tsx`,
          `import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Shield } from "lucide-react";

export default function AdminDashboard() {
  const [stats, setStats] = useState({ users: 0, admins: 0 });

  useEffect(() => {
    (async () => {
      const { count: admins } = await supabase
        .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
      setStats((s) => ({ ...s, admins: admins ?? 0 }));
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your platform.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Users" value={stats.users} hint="Total registered" />
        <StatCard icon={Shield} label="Admins" value={stats.admins} hint="With admin role" />
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-foreground">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}
`,
        );

        // 6. AdminUsers page -----------------------------------------------
        await w(
          `${base_dir}/pages/admin/AdminUsers.tsx`,
          `import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { AppRole } from "@/hooks/useUserRole";

interface RoleRow { user_id: string; role: AppRole; }

export default function AdminUsers() {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles").select("user_id, role").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as RoleRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (user_id: string, role: AppRole) => {
    const { error } = await supabase.from("user_roles").delete().match({ user_id, role });
    if (error) return toast.error(error.message);
    toast.success("Role removed");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Users & Roles</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage who has elevated permissions.</p>
      </div>
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground text-sm">No role assignments yet.</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr><th className="text-left px-4 py-2">User ID</th><th className="text-left px-4 py-2">Role</th><th className="px-4 py-2 w-20"></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{r.user_id}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{r.role}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove(r.user_id, r.role)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
`,
        );

        return {
          ok: true,
          written,
          next_steps: [
            "1. Apply the new migration via supabase_ddl.",
            "2. In your router, add:  <Route path='/admin' element={<AdminRoute><AdminShell/></AdminRoute>}><Route index element={<AdminDashboard/>}/><Route path='users' element={<AdminUsers/>}/></Route>",
            "3. Seed the first admin manually:  INSERT INTO user_roles (user_id, role) VALUES ('<your-uid>', 'admin');",
            "4. Add more admin pages under src/pages/admin/ and register them in AdminShell NAV.",
          ],
          notes:
            "Roles live in a SEPARATE table (user_roles), checked via SECURITY DEFINER has_role(). " +
            "Never store role on profiles — privilege escalation risk. " +
            "useUserRole hook does live lookup; pair with AdminRoute to gate routes.",
        };
      },
    }),
  };
}
