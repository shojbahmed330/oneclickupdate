// scaffold_notifications — drops a complete in-app notification system into the
// generated project: `notifications` table with RLS, realtime publication, a
// `notify_user()` SECURITY DEFINER helper, a `useNotifications` hook, and a
// `<NotificationBell />` UI component. Agent calls this once; afterward any
// edge function or trigger can call `notify_user(uid, title, body, type, link)`.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { SUPABASE_URL } from "../shared.ts";

const SQL = `
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'info',
  link text DEFAULT '',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users view own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "users update own notifications" ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "users delete own notifications" ON public.notifications
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper anyone (or any trigger) can call to push a notification.
CREATE OR REPLACE FUNCTION public.notify_user(
  _user_id uuid, _title text, _body text DEFAULT '',
  _type text DEFAULT 'info', _link text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_user_id, _title, COALESCE(_body,''), COALESCE(_type,'info'), COALESCE(_link,''))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.notifications SET read = true WHERE user_id = auth.uid() AND read = false;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
`.trim();

const HOOK = `import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Notification = {
  id: string; user_id: string; title: string; body: string;
  type: string; link: string; read: boolean; created_at: string;
};

const KEY = (uid: string | null) => ["notifications", uid] as const;

export function useNotifications() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications-self"],
    queryFn: async (): Promise<Notification[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase.from("notifications").select("*")
        .eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as Notification[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    let ch: any;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      ch = supabase.channel(\`notif-\${u.user.id}\`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: \`user_id=eq.\${u.user.id}\` },
        () => qc.invalidateQueries({ queryKey: ["notifications-self"] }),
      ).subscribe();
    })();
    return () => { if (ch) supabase.removeChannel(ch); };
  }, [qc]);

  const items = query.data ?? [];
  const markAllRead = useMutation({
    mutationFn: async () => { await supabase.rpc("mark_all_notifications_read"); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-self"] }),
  });
  const markRead = useMutation({
    mutationFn: async (id: string) => { await supabase.from("notifications").update({ read: true }).eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-self"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await supabase.from("notifications").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-self"] }),
  });

  return {
    items,
    unreadCount: items.filter((n) => !n.read).length,
    loading: query.isLoading,
    markAllRead: () => markAllRead.mutate(),
    markRead: (id: string) => markRead.mutate(id),
    remove: (id: string) => remove.mutate(id),
  };
}
`;

const BELL = `import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";

export function NotificationBell() {
  const { items, unreadCount, markAllRead, markRead, remove } = useNotifications();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative active:scale-95 transition-transform">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No notifications yet</div>
          ) : items.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              className={\`p-3 border-b last:border-0 cursor-pointer hover:bg-accent active:scale-[0.99] transition \${!n.read ? "bg-accent/40" : ""}\`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >×</button>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
`;

export function makeScaffoldNotificationsTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    scaffold_notifications: tool({
      description:
        "One-shot scaffold for the in-app notification system: notifications table " +
        "+ RLS + realtime + notify_user() SQL helper + useNotifications hook + " +
        "<NotificationBell/> component. Idempotent. Call once early in build, " +
        "then any edge function can do `await supabase.rpc('notify_user', {...})`.",
      inputSchema: z.object({}).default({}),
      execute: async () => {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, sql: SQL }),
        });
        const ddlText = await r.text();
        let ddlBody: any; try { ddlBody = JSON.parse(ddlText); } catch { ddlBody = { ok: false, error: ddlText.slice(0, 400) }; }
        if (!ddlBody?.ok) return { ok: false, stage: "ddl", error: ddlBody?.error ?? ddlText.slice(0, 400) };

        const hookPath = "src/hooks/useNotifications.ts";
        const bellPath = "src/components/NotificationBell.tsx";
        const esc = (s: string) => s.replace(/'/g, `'\\''`);
        await sandbox.exec(
          `mkdir -p "${cwd}/src/hooks" "${cwd}/src/components" && ` +
          `cat > "${cwd}/${hookPath}" <<'EOF'\n${HOOK}\nEOF\n` +
          `cat > "${cwd}/${bellPath}" <<'EOF'\n${BELL}\nEOF`,
          cwd,
          30,
        );

        return {
          ok: true,
          files: [hookPath, bellPath],
          rpc: "notify_user(uid, title, body, type, link)",
          next_steps: [
            `Import <NotificationBell /> in your top app header.`,
            `From any edge function: await admin.rpc('notify_user', { _user_id, _title, _body, _type, _link })`,
            `From SQL trigger: PERFORM public.notify_user(NEW.user_id, 'Order shipped', ...);`,
          ],
        };
      },
    }),
  };
}
