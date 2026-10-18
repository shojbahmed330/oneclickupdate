export interface HelpArticle {
  id: string;
  q: string;
  a: string;
}

export interface HelpSection {
  id: string;
  title: string;
  articles: HelpArticle[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    articles: [
      {
        id: "what-is",
        q: "What is OneClick Studio?",
        a: "It's an AI-powered platform that builds real Android apps from a plain-language description. You describe the app, our AI generates the full code and design, and you can download it as an APK or upload it to Google Play.",
      },
      {
        id: "first-app",
        q: "How do I build my first app?",
        a: "1. Sign in and tap “New project”.\n2. Describe the app you want — be specific (e.g. “EMI calculator with monthly chart”).\n3. Wait for the live preview to render.\n4. Refine by chatting with the AI.\n5. When happy, hit “Download APK” to get an installable file.",
      },
      {
        id: "no-code",
        q: "Do I need to know coding?",
        a: "No. Everything happens through chat. If you do know code, you can edit files directly in the workspace.",
      },
      {
        id: "preview",
        q: "Why does the preview look different from the APK?",
        a: "Preview runs in a browser iframe; the APK runs natively on Android. Layout, fonts, and persistence behave nearly identical, but features like push notifications and OS-level permissions only work in the APK.",
      },
    ],
  },
  {
    id: "credits-billing",
    title: "Credits & billing",
    articles: [
      {
        id: "what-credits",
        q: "What are credits and how are they used?",
        a: "Credits power AI generations and APK builds. Sending an AI message and building an APK each consume credits. The exact cost is shown in the workspace before you confirm.",
      },
      {
        id: "buy-credits",
        q: "How do I buy credits?",
        a: "Open the Shop tab, choose a credit pack, and pay using bKash, Nagad, or any supported method. Credits land in your account after payment confirmation (usually within minutes).",
      },
      {
        id: "refund",
        q: "Can I get a refund?",
        a: "Yes — see our Refund Policy. Unused credits within 7 days of purchase are eligible. Failed payments are auto-refunded; if you were charged but credits didn't arrive, contact support with your transaction ID.",
      },
      {
        id: "promo",
        q: "How do promo codes work?",
        a: "Enter the code at checkout. Each code has a per-user limit and total cap; trying to abuse it (multiple pending orders) will be blocked automatically.",
      },
      {
        id: "expiry",
        q: "Do credits expire?",
        a: "No. Purchased credits never expire. Promotional/free credits may have an expiry — check the offer terms.",
      },
    ],
  },
  {
    id: "build-publish",
    title: "Building & publishing apps",
    articles: [
      {
        id: "apk-aab",
        q: "What's the difference between APK and AAB?",
        a: "APK is for direct install / sideloading. AAB (Android App Bundle) is required by Google Play. Both files use your branded app name and icon.",
      },
      {
        id: "branding",
        q: "How do I set my app name and icon?",
        a: "Inside the Builder, open “Brand & Icon”. Set the display name, package ID, and upload a 512×512 PNG icon. These flow into both APK and AAB downloads.",
      },
      {
        id: "play-store",
        q: "How do I publish to Google Play?",
        a: "1. Create a Google Play Console account ($25 one-time fee).\n2. Download the AAB from your project.\n3. In Play Console, create a new app → upload the AAB.\n4. Fill in store listing (screenshots, description, content rating).\n5. Submit for review (usually 1–7 days).",
      },
      {
        id: "build-fail",
        q: "My build failed — what now?",
        a: "Open the build log on the project page. Common causes: invalid package ID (must be lowercase, dot-separated), oversized icon, or temporary GitHub/CI hiccups. Most transient errors auto-retry. If stuck, contact support with the build ID.",
      },
      {
        id: "qr-scan",
        q: "QR code scan মোবাইল দিয়ে কাজ করছে না — কেন?",
        a: "Preview iframe inside Lovable doesn't expose its URL to mobile cameras. Open your project, tap “Open preview in new tab”, then scan the URL there with your phone camera, OR install the APK directly via the “Download APK” button.",
      },
    ],
  },
  {
    id: "account-privacy",
    title: "Account & privacy",
    articles: [
      {
        id: "data-export",
        q: "How do I export my data?",
        a: "Profile → Privacy & Data → “Export my data”. You'll get a JSON archive with all your projects, orders, messages, and profile info. Complies with GDPR data portability.",
      },
      {
        id: "delete-account",
        q: "How do I delete my account?",
        a: "Profile → Privacy & Data → “Delete account”. We'll ask you to type your email to confirm. Your projects and personal data are permanently removed; financial records (orders/invoices) are anonymized but kept for tax compliance.",
      },
      {
        id: "data-shared",
        q: "What data do you share with third parties?",
        a: "We share only what's strictly required: payment processors (for checkout), AI providers (your chat prompts), and infrastructure (hosting). We never sell your data. Full list in our Privacy Policy.",
      },
      {
        id: "ip-rights",
        q: "Who owns the apps I build?",
        a: "You do. The code, design, and any content you generate belong to you. You're responsible for not infringing third-party copyrights — see our Copyright disclaimer.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    articles: [
      {
        id: "preview-blank",
        q: "Preview is blank or stuck loading",
        a: "1. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R).\n2. Check Network tab for blocked requests.\n3. Tap “Restart sandbox” inside the project.\nIf still broken, the issue is logged automatically — contact support with the project ID.",
      },
      {
        id: "stuck-build",
        q: "My APK build is stuck for over 10 minutes",
        a: "Builds normally finish in 3–5 min. If yours is hanging: check build status in the project header, then try “Cancel & retry”. Persistent stalls usually mean a transient CI issue — credits are refunded for failed builds.",
      },
      {
        id: "login-issues",
        q: "Can't sign in / not receiving verification email",
        a: "1. Check spam folder.\n2. Try Google sign-in instead.\n3. Make sure your email isn't blocked by your provider.\nIf nothing works, contact support — we can manually verify.",
      },
      {
        id: "credit-missing",
        q: "I paid but credits didn't arrive",
        a: "Most payments confirm within 2–5 minutes. If 30 min has passed: open Profile → Orders → find your order. If status is “pending”, send the transaction ID + sender number to support and we'll credit you manually.",
      },
    ],
  },
];
