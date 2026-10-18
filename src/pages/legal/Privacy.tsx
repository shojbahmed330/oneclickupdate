import { LegalLayout } from "./LegalLayout";

const Privacy = () => (
  <LegalLayout title="Privacy Policy" updated="May 14, 2026">
    <p>
      This policy explains what data OneClick Studio collects, why, how we use it, and the rights
      you have over it. We aim to collect the minimum needed to run the service.
    </p>

    <h2>1. What we collect</h2>
    <h3>Account data</h3>
    <ul>
      <li>Email address and (optional) display name, avatar, bio.</li>
      <li>OAuth identifiers when you sign in with Google or GitHub.</li>
      <li>Hashed passwords (we never store them in plain text).</li>
    </ul>
    <h3>Usage data</h3>
    <ul>
      <li>Projects you create, files you generate, chat messages with the AI agent.</li>
      <li>Build history (APK/AAB metadata, GitHub Actions run IDs, logs).</li>
      <li>Credit transactions and order history.</li>
    </ul>
    <h3>Technical data</h3>
    <ul>
      <li>IP address, user-agent, and a device fingerprint — used only for fraud detection.</li>
      <li>Error logs and performance metrics.</li>
    </ul>

    <h2>2. Why we collect it</h2>
    <ul>
      <li><strong>To run the service</strong> — store your projects, deliver builds, process payments.</li>
      <li><strong>To prevent fraud</strong> — flag duplicate transactions, banned-user signups, payment abuse.</li>
      <li><strong>To improve the product</strong> — aggregate, anonymized analytics.</li>
      <li><strong>To contact you</strong> — order receipts, security alerts, occasional product updates.</li>
    </ul>

    <h2>3. Who we share with</h2>
    <p>We do <strong>not</strong> sell your personal data. We share with sub-processors only as needed:</p>
    <ul>
      <li><strong>Lovable Cloud / Supabase</strong> — database, auth, storage hosting.</li>
      <li><strong>GitHub Actions</strong> — to compile your APK/AAB builds.</li>
      <li><strong>Daytona</strong> — sandboxed preview environments.</li>
      <li><strong>AI providers</strong> (Anthropic, Google, OpenAI) — to generate code from your prompts.</li>
      <li><strong>Payment processors</strong> — only when you make a purchase.</li>
    </ul>
    <p>We never share AI prompts containing your business logic with third parties for training.</p>

    <h2>4. Your rights</h2>
    <p>You can, at any time:</p>
    <ul>
      <li><strong>Access &amp; export</strong> your data — Profile → Privacy → "Download my data".</li>
      <li><strong>Delete your account</strong> — Profile → Privacy → "Delete my account". This permanently removes your projects, files, chat history, and account record.</li>
      <li><strong>Correct</strong> profile information — Profile → Settings.</li>
      <li><strong>Opt out</strong> of marketing emails — Profile → Notifications.</li>
    </ul>

    <h2>5. Data retention</h2>
    <ul>
      <li>Account data — kept until you delete your account.</li>
      <li>Build artifacts (APK/AAB files) — auto-deleted 30 days after build.</li>
      <li>Order &amp; invoice records — kept for 7 years for tax compliance.</li>
      <li>Anonymized logs — kept up to 90 days.</li>
    </ul>

    <h2>6. Security</h2>
    <p>
      Data is encrypted at rest and in transit. Row-level access control ensures users can
      only read their own data. Production secrets are stored in encrypted vaults, never in
      source code.
    </p>

    <h2>7. International transfers</h2>
    <p>
      Our infrastructure is hosted in multiple regions. By using OneClick Studio, you consent to
      your data being processed in those regions, subject to standard contractual clauses.
    </p>

    <h2>8. Children</h2>
    <p>
      OneClick Studio is not directed at children under 13. We do not knowingly collect data from
      them. If we learn that we have, we will delete it.
    </p>

    <h2>9. Changes</h2>
    <p>
      We may update this policy. Material changes will be announced 14 days in advance.
    </p>

    <h2>10. Contact</h2>
    <p>
      Privacy questions: reach out through <a href="/support">Support</a>.
    </p>
  </LegalLayout>
);

export default Privacy;
