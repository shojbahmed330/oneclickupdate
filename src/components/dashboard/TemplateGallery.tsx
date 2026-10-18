import { useMemo, useState } from "react";
import { m } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { TEMPLATES, type Template } from "@/lib/templates";

type Props = {
  onPick: (tpl: Template) => void;
};

// Only templates with a real code-scaffold are currently usable. Others are
// kept in the registry for future activation but hidden from the gallery.
const ACTIVE_TEMPLATE_IDS = new Set<string>(["ecommerce"]);

export const TemplateGallery = ({ onPick }: Props) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const filtered = useMemo(
    () => TEMPLATES.filter((t) => ACTIVE_TEMPLATE_IDS.has(t.id)),
    [],
  );

  return (
    <div className="mb-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold">Start from a template</h2>
          <p className="text-xs text-muted-foreground">Tap a card to auto-build instantly.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((tpl, i) => {
          const isHover = hovered === tpl.id;
          return (
            <m.button
              key={tpl.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onMouseEnter={() => setHovered(tpl.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onPick(tpl)}
              className="group relative overflow-hidden rounded-2xl text-left bg-card/50 border border-border/60 hover:border-primary/50 hover:scale-[1.02] transition-all min-h-[150px] flex flex-col"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${tpl.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

              <div className="relative p-4 flex-1">
                <m.div
                  animate={isHover ? { scale: 1.15, rotate: -6 } : { scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 14 }}
                  className="text-3xl mb-2"
                >
                  {tpl.emoji}
                </m.div>
                <div className="font-semibold text-sm group-hover:text-white transition-colors">{tpl.name}</div>
                <div className="text-xs text-muted-foreground group-hover:text-white/80 transition-colors line-clamp-2 mt-0.5">
                  {tpl.tagline}
                </div>
              </div>

              <div className="relative px-4 pb-3">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-foreground group-hover:text-white transition-colors">
                  <span className="opacity-70 group-hover:opacity-100">Use template</span>
                  <m.span
                    animate={isHover ? { x: 4 } : { x: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  >
                    <ArrowRight size={14} />
                  </m.span>
                </div>
              </div>
            </m.button>
          );
        })}

        {/* Coming-soon placeholder card */}
        <div className="relative overflow-hidden rounded-2xl bg-card/30 border border-dashed border-border/60 min-h-[150px] flex flex-col p-4 cursor-not-allowed">
          <div className="mb-2 opacity-70">
            <Sparkles size={28} className="text-primary" />
          </div>
          <div className="font-semibold text-sm text-muted-foreground">More templates</div>
          <div className="text-xs text-muted-foreground/80 mt-0.5">Coming soon — blog, chat, fitness, booking & more.</div>
        </div>
      </div>
    </div>
  );
};
