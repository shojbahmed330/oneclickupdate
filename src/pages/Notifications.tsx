import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, CheckCheck, Inbox, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { SwipeToDelete } from "@/components/mobile/SwipeToDelete";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const FILTERS = ["all", "unread", "order", "credit", "system"] as const;
type Filter = (typeof FILTERS)[number];

const typeColor: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  error: "bg-red-500/15 text-red-300 border-red-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  order: "bg-primary/15 text-primary border-primary/30",
  credit: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  system: "bg-muted text-muted-foreground border-border",
};

const NotificationsPage = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { items, unreadCount, markAllRead, markRead, remove, loading } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => !n.read);
    return items.filter((n) => n.type === filter);
  }, [items, filter]);

  const renderRow = (n: Notification) => {
    const row = (
      <li
        key={n.id}
        className={cn(
          "group relative px-4 py-3 hover:bg-[hsl(0_0%_100%/0.03)] cursor-pointer transition-colors border-b border-[hsl(0_0%_100%/0.05)]",
          !n.read && "bg-primary/[0.04]",
        )}
        onClick={() => {
          if (!n.read) markRead(n.id);
          if (n.link) navigate(n.link);
        }}
      >
        {!n.read && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-primary" />}
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wide shrink-0",
              typeColor[n.type] ?? typeColor.info,
            )}
          >
            {n.type}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug">{n.title}</div>
            {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
            <div className="text-[10px] text-muted-foreground mt-1">
              {new Date(n.created_at).toLocaleString()}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!n.read && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  markRead(n.id);
                }}
                className="p-1.5 rounded hover:text-emerald-400 hover:bg-emerald-500/10"
                aria-label="Mark read"
              >
                <Check size={14} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                remove(n.id);
              }}
              className="p-1.5 rounded hover:text-destructive hover:bg-destructive/10"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </li>
    );
    return isMobile ? (
      <SwipeToDelete key={n.id} onDelete={() => remove(n.id)}>
        {row}
      </SwipeToDelete>
    ) : (
      row
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-[calc(64px+env(safe-area-inset-bottom)+16px)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-[hsl(0_0%_100%/0.06)]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label="Back"><ArrowLeft size={18} /></Link>
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Bell size={18} className="text-primary" />
            <h1 className="text-lg font-semibold truncate">Notifications</h1>
            {unreadCount > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/30">{unreadCount} new</Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" onClick={markAllRead} leftIcon={<CheckCheck size={14} />}>
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
          )}
        </div>
        {/* Filters */}
        <div className="max-w-2xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "primary" : "secondary"}
              onClick={() => setFilter(f)}
              className="capitalize shrink-0"
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-20 text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Inbox className="mx-auto mb-3 text-muted-foreground/40" size={48} />
            <div className="text-sm text-muted-foreground">No notifications</div>
            <div className="text-xs text-muted-foreground/70 mt-1">
              {filter === "all" ? "We'll let you know when something happens" : `No ${filter} notifications`}
            </div>
          </div>
        ) : (
          <ul>{filtered.map(renderRow)}</ul>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
