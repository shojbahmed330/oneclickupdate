import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronDown, ArrowLeft, Sparkles, CreditCard, Smartphone, Shield, Wrench, MessageCircle } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HELP_SECTIONS, type HelpArticle } from "@/data/helpContent";

const ICONS = {
  "getting-started": Sparkles,
  "credits-billing": CreditCard,
  "build-publish": Smartphone,
  "account-privacy": Shield,
  "troubleshooting": Wrench,
} as const;

export default function Help() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_SECTIONS;
    return HELP_SECTIONS
      .map((s) => ({
        ...s,
        articles: s.articles.filter(
          (a) => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.articles.length > 0);
  }, [query]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-10 glass-strong border-b border-border pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">Home</span>
          </Link>
          <Logo size="sm" />
          <Link to="/support" className="text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground flex items-center gap-1.5">
            <MessageCircle size={15} /> <span className="hidden sm:inline">Contact</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="font-display text-4xl sm:text-5xl font-normal tracking-[-0.035em] leading-[1.05] mb-3">
          Help center
        </h1>
        <p className="text-[15px] text-[hsl(var(--foreground-muted))] mb-8">
          Guides, FAQs, and answers — everything you need to ship your first app.
        </p>

        <div className="relative mb-10">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground-subtle))]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="w-full h-12 pl-10 pr-4 rounded-xl border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
          />
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-[hsl(var(--foreground-muted))]">
            <p className="mb-3">No articles match "{query}".</p>
            <Link to="/support" className="text-primary underline underline-offset-2">Ask support directly →</Link>
          </div>
        )}

        <div className="space-y-10">
          {filtered.map((section) => {
            const Icon = ICONS[section.id as keyof typeof ICONS] ?? Sparkles;
            return (
              <section key={section.id}>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
                    <Icon size={16} />
                  </div>
                  <h2 className="font-display text-2xl font-normal tracking-tight">{section.title}</h2>
                </div>
                <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                  {section.articles.map((a) => (
                    <ArticleRow
                      key={a.id}
                      article={a}
                      open={openId === a.id}
                      onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-14 p-6 sm:p-8 rounded-2xl border border-border bg-card text-center">
          <h3 className="font-display text-2xl font-normal tracking-tight mb-2">Still stuck?</h3>
          <p className="text-[14px] text-[hsl(var(--foreground-muted))] mb-4">
            Our support team usually replies within a few hours.
          </p>
          <Link
            to="/support"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-95 transition"
          >
            <MessageCircle size={15} /> Contact support
          </Link>
        </div>
      </main>
    </div>
  );
}

const ArticleRow = ({ article, open, onToggle }: { article: HelpArticle; open: boolean; onToggle: () => void }) => (
  <li>
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition active:scale-[0.998]"
    >
      <span className="text-[14.5px] font-medium">{article.q}</span>
      <ChevronDown size={16} className={`shrink-0 text-[hsl(var(--foreground-subtle))] transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && (
      <div className="px-5 pb-5 text-[14px] leading-[1.65] text-[hsl(var(--foreground-muted))] whitespace-pre-line">
        {article.a}
      </div>
    )}
  </li>
);
