import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  link: string;
  read: boolean;
  created_at: string;
};

const KEY = (uid: string | null) => ["notifications", uid] as const;

export const useNotifications = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY(user?.id ?? null),
    queryFn: async (): Promise<Notification[]> => {
      if (!user) return [];
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as Notification[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  // Realtime → invalidate
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: KEY(user.id) }),
      )
      .subscribe();
    return () => {
      ch.unsubscribe();
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const items = query.data ?? [];

  const markAllReadMut = useMutation({
    mutationFn: async () => {
      await supabase.rpc("mark_all_notifications_read");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(user?.id ?? null) }),
  });

  const markReadMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(user?.id ?? null) }),
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").delete().eq("id", id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY(user?.id ?? null) });
      const prev = qc.getQueryData<Notification[]>(KEY(user?.id ?? null));
      qc.setQueryData<Notification[]>(KEY(user?.id ?? null), (p) => (p ?? []).filter((n) => n.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY(user?.id ?? null), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY(user?.id ?? null) }),
  });

  return {
    items,
    unreadCount: items.filter((n) => !n.read).length,
    loading: query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: KEY(user?.id ?? null) }),
    markAllRead: () => markAllReadMut.mutate(),
    markRead: (id: string) => markReadMut.mutate(id),
    remove: (id: string) => removeMut.mutate(id),
  };
};
