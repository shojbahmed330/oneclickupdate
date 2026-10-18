import { LegalLayout } from "./LegalLayout";

const Refund = () => (
  <LegalLayout title="Refund Policy" updated="May 14, 2026">
    <p>
      We want OneClick Studio to work for you. This policy explains when refunds are available
      and how to request one.
    </p>

    <h2>1. Credit purchases</h2>
    <p>
      Credits are a digital good. Once delivered to your account, they are generally
      <strong> non-refundable</strong>. Exceptions:
    </p>
    <ul>
      <li><strong>Duplicate or accidental purchase</strong> — full refund within 7 days, provided the credits have not been used.</li>
      <li><strong>Service outage</strong> — if a major outage prevents you from using credits you just bought, we will refund or top-up at our discretion.</li>
      <li><strong>Payment processor error</strong> — full refund.</li>
    </ul>

    <h2>2. Subscription / monthly plans</h2>
    <p>
      If you are on a recurring plan, you can cancel any time from <a href="/profile?tab=billing">Profile → Billing</a>.
      Cancellation stops future billing. We do not pro-rate the current period.
    </p>

    <h2>3. Failed payments</h2>
    <p>
      If your payment was charged but credits were not added to your account, contact
      support with your transaction ID. We will either credit your account or issue a
      full refund within 5 business days.
    </p>

    <h2>4. Disputed builds</h2>
    <p>
      A failed build does <strong>not</strong> consume credits. If a build was charged but
      did not produce a working APK due to a platform error (not user-side code), we will
      refund the credits used.
    </p>

    <h2>5. Promo codes &amp; bonus credits</h2>
    <p>
      Credits granted from promo codes or admin gifts are not refundable in cash. If your
      paid order is refunded, the matching purchase credits are deducted; promo bonus
      credits may also be deducted if they were granted by the same order.
    </p>

    <h2>6. Account termination</h2>
    <p>
      If we terminate your account for breach of <a href="/terms">Terms of Service</a>
      (fraud, abuse, illegal use), unused credits are forfeit and not refundable.
    </p>

    <h2>7. How to request a refund</h2>
    <ol className="list-decimal pl-5 my-3 space-y-1">
      <li>Open <a href="/support">Support</a> in-app.</li>
      <li>Pick "Billing &amp; refund".</li>
      <li>Include your order ID, transaction ID, and reason.</li>
    </ol>
    <p>
      We respond within 2 business days. Approved refunds appear in 5–10 business days
      depending on your payment method (card, mobile wallet, crypto).
    </p>

    <h2>8. Contact</h2>
    <p>
      Questions about a specific charge? <a href="/support">Open a ticket</a> with the
      transaction details.
    </p>
  </LegalLayout>
);

export default Refund;
