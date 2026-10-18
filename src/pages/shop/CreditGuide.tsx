import { m } from "framer-motion";
import { MessageSquare, Pencil, Layers, Rocket, Info } from "lucide-react";

const ROWS = [
  {
    icon: MessageSquare,
    label: "Quick chat / question",
    range: "1–3",
    hint: "Short answers, no code changes",
  },
  {
    icon: Pencil,
    label: "Small edit",
    range: "5–15",
    hint: "Text, color, single-file tweaks",
  },
  {
    icon: Layers,
    label: "New component / feature",
    range: "30–80",
    hint: "Multi-file changes, new UI block",
  },
  {
    icon: Rocket,
    label: "Full app build",
    range: "100–300+",
    hint: "Complete app from a prompt",
  },
];

export const CreditGuide = () => (
  <section className="mt-12">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">How credits are used</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Token-based pricing — you pay for what the AI actually generates.
        </p>
      </div>
      <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info size={12} /> Approximate ranges
      </span>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {ROWS.map((r, i) => (
        <m.div
          key={r.label}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.05 }}
          className="rounded-2xl p-4 bg-[hsl(var(--bg-elevated))] border border-[hsl(0_0%_100%/0.08)] hover:border-primary/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-primary">
            <r.icon size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">{r.label}</span>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">
            {r.range}
            <span className="text-sm text-muted-foreground font-medium ml-1">credits</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p>
        </m.div>
      ))}
    </div>
  </section>
);
