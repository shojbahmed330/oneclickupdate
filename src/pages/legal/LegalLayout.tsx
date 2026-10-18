import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

interface Props {
  title: string;
  updated: string;
  children: ReactNode;
}

/**
 * Shared shell for /terms, /privacy, /refund-policy, /copyright.
 * Plain editorial typography, no marketing chrome — keeps legal pages
 * skimmable and printer-friendly.
 */
export const LegalLayout = ({ title, updated, children }: Props) => (
  <div className="min-h-[100dvh] bg-background text-foreground">
    <header className="sticky top-0 z-10 glass-strong border-b border-border pt-safe">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <Logo size="sm" />
        <div className="w-16 hidden sm:block" />
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <h1 className="font-display text-4xl sm:text-5xl font-normal tracking-[-0.035em] leading-[1.05] mb-2">
        {title}
      </h1>
      <p className="text-[12.5px] uppercase tracking-[0.18em] text-[hsl(var(--foreground-subtle))] mb-10">
        Last updated · {updated}
      </p>

      <article className="prose prose-neutral dark:prose-invert max-w-none text-[15px] leading-[1.7]
        [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-normal [&_h2]:tracking-tight [&_h2]:mt-12 [&_h2]:mb-3
        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
        [&_p]:my-3 [&_ul]:my-3 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:my-1
        [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80
        [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </article>

      <footer className="mt-16 pt-8 border-t border-border text-[12.5px] text-[hsl(var(--foreground-subtle))] flex flex-wrap gap-x-6 gap-y-2">
        <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
        <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
        <Link to="/refund-policy" className="hover:text-foreground transition-colors">Refunds</Link>
        <Link to="/copyright" className="hover:text-foreground transition-colors">Copyright</Link>
        <Link to="/help" className="hover:text-foreground transition-colors">Help</Link>
        <Link to="/support" className="hover:text-foreground transition-colors ml-auto">Contact us</Link>
      </footer>
    </main>
  </div>
);
