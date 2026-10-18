import { LegalLayout } from "./LegalLayout";

const Terms = () => (
  <LegalLayout title="Terms of Service" updated="May 14, 2026">
    <p>
      Welcome to OneClick Studio. By creating an account or using our platform, you agree to these
      Terms of Service. Please read them carefully — they form a binding agreement between
      you and OneClick Studio.
    </p>

    <h2>1. The service</h2>
    <p>
      OneClick Studio is an AI-assisted application builder. You describe an app in plain language;
      we generate the source code, host a live preview sandbox, and (optionally) compile it
      into an Android APK or AAB file you can distribute.
    </p>

    <h2>2. Your account</h2>
    <ul>
      <li>You must be at least 13 years old to create an account.</li>
      <li>You are responsible for keeping your password and OAuth credentials secure.</li>
      <li>One person, one account. Multiple accounts created to abuse promo codes or free credits will be terminated.</li>
    </ul>

    <h2>3. Credits and billing</h2>
    <p>
      The platform runs on a pre-paid credit system. Credits are purchased in packages and
      consumed by AI generation, builds, and storage. Credits do not expire while your
      account is active.
    </p>
    <p>
      Refunds are governed by our <a href="/refund-policy">Refund Policy</a>.
    </p>

    <h2>4. Apps you generate</h2>
    <p>
      You own the source code, designs, and APKs you generate. OneClick Studio claims no ownership
      over your output. However, you remain responsible for ensuring that:
    </p>
    <ul>
      <li>You have the right to use any logos, images, brand names, or text you upload.</li>
      <li>Your generated apps comply with Google Play / app-store policies if you publish them.</li>
      <li>Your apps do not contain malware, scams, or illegal content.</li>
    </ul>
    <p>
      See our <a href="/copyright">Copyright &amp; IP Disclaimer</a> for details.
    </p>

    <h2>5. Acceptable use</h2>
    <p>You agree not to use OneClick Studio to:</p>
    <ul>
      <li>Generate apps that facilitate fraud, harassment, CSAM, or illegal activity.</li>
      <li>Reverse-engineer, scrape, or overload our infrastructure.</li>
      <li>Resell platform access without a written partnership agreement.</li>
      <li>Bypass credit, fraud, or rate-limit systems.</li>
    </ul>

    <h2>6. Termination</h2>
    <p>
      We may suspend or terminate your account immediately for breaches of these Terms,
      fraudulent payment activity, or repeated abuse reports. Unused credits are forfeit on
      termination for cause.
    </p>

    <h2>7. Disclaimers</h2>
    <p>
      The platform is provided "as is". AI output may contain bugs, security flaws, or
      copyright issues — you are responsible for reviewing what you ship. We do not
      guarantee uptime, build success, or that generated apps will be approved by app stores.
    </p>

    <h2>8. Limitation of liability</h2>
    <p>
      To the maximum extent permitted by law, OneClick Studio's total liability to you for any
      claim arising out of the service is limited to the amount you paid us in the 3 months
      preceding the claim.
    </p>

    <h2>9. Changes</h2>
    <p>
      We may update these Terms. Material changes will be announced via email or in-app
      notification at least 14 days before they take effect.
    </p>

    <h2>10. Contact</h2>
    <p>
      Questions? Reach us through the in-app <a href="/support">Support</a> page.
    </p>
  </LegalLayout>
);

export default Terms;
