import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Coins, Clock, Cpu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";

type RangeKey = "7d" | "30d" | "90d" | "all";

type Row = {
  user_id: string;
  display_name: string | null;
  runs: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  sandbox_minutes: number;
  last_activity: number;
};

const rangeToFromIso = (r: RangeKey): string | null => {
  if (r === "all") return null;
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtMin = (m: number) => {
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  return h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

export const UsageTracking = () => {
  const [range, setRange] = useState<RangeKey>("30d");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data: rows = [], isLoading: loading, refetch } = useQuery({
    queryKey: ["admin", "usage", range],
    queryFn: async (): Promise<Row[]> => {
      const fromIso = rangeToFromIso(range);
      const runsQ = supabase
        .from("agent_runs")
        .select("user_id,prompt_tokens,completion_tokens,total_tokens,started_at,created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (fromIso) runsQ.gte("created_at", fromIso);
      const wsQ = supabase
        .from("daytona_workspaces")
        .select("user_id,created_at,last_used_at")
        .limit(2000);

      const [runsRes, wsRes, profRes] = await Promise.all([
        runsQ,
        wsQ,
        supabase.from("profiles").select("user_id,display_name").limit(2000),
      ]);
      if (runsRes.error) throw runsRes.error;
      if (wsRes.error) throw wsRes.error;

      const nameByUser = new Map<string, string>();
      (profRes.data || []).forEach((p: { user_id?: string; display_name?: string }) => p.user_id && nameByUser.set(p.user_id, p.display_name || ""));

      const agg = new Map<string, Row>();
      const ensure = (uid: string): Row => {
        let r = agg.get(uid);
        if (!r) {
          r = {
            user_id: uid,
            display_name: nameByUser.get(uid) || null,
            runs: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            sandbox_minutes: 0,
            last_activity: 0,
          };
          agg.set(uid, r);
        }
        return r;
      };

      for (const run of runsRes.data || []) {
        const r = ensure(run.user_id);
        r.runs += 1;
        r.prompt_tokens += run.prompt_tokens || 0;
        r.completion_tokens += run.completion_tokens || 0;
        r.total_tokens += run.total_tokens || 0;
        const t = new Date(run.created_at).getTime();
        if (t > r.last_activity) r.last_activity = t;
      }

      for (const ws of wsRes.data || []) {
        const r = ensure(ws.user_id);
        const start = new Date(ws.created_at).getTime();
        const end = ws.last_used_at ? new Date(ws.last_used_at).getTime() : start;
        const minutes = Math.max(0, (end - start) / 60_000);
        r.sandbox_minutes += minutes;
        if (end > r.last_activity) r.last_activity = end;
      }

      return [...agg.values()].sort((a, b) => b.total_tokens - a.total_tokens);
    },
    staleTime: 60_000,
    meta: { onError: (e: Error) => toast.error(e?.message || "Failed to load usage") },
  });

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.user_id.toLowerCase().includes(q) || (r.display_name || "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.runs += r.runs;
          acc.tokens += r.total_tokens;
          acc.minutes += r.sandbox_minutes;
          return acc;
        },
        { runs: 0, tokens: 0, minutes: 0 },
      ),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Activity size={14} />} label="Active users" value={fmtNum(rows.length)} />
        <StatCard icon={<Cpu size={14} />} label="Agent runs" value={fmtNum(totals.runs)} />
        <StatCard icon={<Coins size={14} />} label="Total tokens" value={fmtNum(totals.tokens)} />
        <StatCard icon={<Clock size={14} />} label="Sandbox time" value={fmtMin(totals.minutes)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search user id or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-[280px]"
        />
        <Button variant="ghost" size="sm" onClick={() => void refetch()} leftIcon={<RefreshCw size={14} />}>
          Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">User</th>
                <th className="text-right px-3 py-2">Runs</th>
                <th className="text-right px-3 py-2">In tokens</th>
                <th className="text-right px-3 py-2">Out tokens</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Sandbox</th>
                <th className="text-right px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    <td colSpan={7} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No usage data.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.user_id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.display_name || "—"}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{r.user_id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.runs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.prompt_tokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.completion_tokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtNum(r.total_tokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMin(r.sandbox_minutes)}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {r.last_activity ? new Date(r.last_activity).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
    <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
  </div>
);
