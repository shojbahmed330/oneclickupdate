import { Link } from "react-router-dom";
import { Logo } from "./Logo";

/**
 * Public-facing footer for landing / marketing pages.
 * Houses the legal links required for app-store distribution
 * and basic GDPR compliance.
 */
export const Footer = () => (
  <footer className="border-t border-border bg-background">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
        <div className="space-y-3 md:max-w-xs">
          <Logo size="sm" />
          <p className="text-[12.5px] text-[hsl(var(--foreground-muted))] leading-relaxed">
            Build, brand, and ship native Android apps with AI — no IDE required.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-[13px]">
          <FooterCol title="Product">
            <FooterLink to="/projects">Projects</FooterLink>
            <FooterLink to="/shop">Pricing</FooterLink>
            <FooterLink to="/help">Help center</FooterLink>
            <FooterLink to="/support">Contact support</FooterLink>
          </FooterCol>

          <FooterCol title="Legal">
            <FooterLink to="/terms">Terms of Service</FooterLink>
            <FooterLink to="/privacy">Privacy Policy</FooterLink>
            <FooterLink to="/refund-policy">Refund Policy</FooterLink>
            <FooterLink to="/copyright">Copyright</FooterLink>
          </FooterCol>

          <FooterCol title="Account">
            <FooterLink to="/auth">Sign in</FooterLink>
            <FooterLink to="/profile">Profile</FooterLink>
            <FooterLink to="/profile?tab=privacy">Your data</FooterLink>
          </FooterCol>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t border-border flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-[11.5px] text-[hsl(var(--foreground-subtle))]">
        <span>© {new Date().getFullYear()} OneClick Studio. All rights reserved.</span>
        <span>Made with care · Built by OneClick Studio</span>
      </div>
    </div>
  </footer>
);

const FooterCol = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--foreground-subtle))] mb-3">
      {title}
    </div>
    <ul className="space-y-2">{children}</ul>
  </div>
);

const FooterLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <li>
    <Link to={to} className="text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors">
      {children}
    </Link>
  </li>
);
