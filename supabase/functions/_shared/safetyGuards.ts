// Safety & Security guards: secret detection, prompt-injection filter,
// RLS reminders. Keep token-light — return short signals, not essays.

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "Stripe restricted key", re: /\brk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub PAT", re: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Supabase service role JWT", re: /eyJ[A-Za-z0-9_-]+\.eyJ[^"'\s]*service_role[^"'\s]*\.[A-Za-z0-9_-]+/ },
  { name: "Generic private key", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Anthropic-style key", re: /\bsk-ant-api03-[A-Za-z0-9_-]{40,}\b/ },
  { name: "Mistral key", re: /\b[A-Za-z0-9]{32}\b(?=\s*['"]?\s*(mistral|MISTRAL))/ },
  { name: "Cohere key", re: /\bco_[A-Za-z0-9]{40,}\b/ },
  { name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: "Replicate token", re: /\br8_[A-Za-z0-9]{30,}\b/ },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Slack webhook", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { name: "Discord webhook", re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
  { name: "Twilio key", re: /\bSK[a-f0-9]{32}\b/ },
  { name: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,}\b/ },
  { name: "Mailgun key", re: /\bkey-[a-f0-9]{32}\b/ },
  { name: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{30,}\b/ },
  { name: "Stripe publishable live", re: /\bpk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "JWT (generic)", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { name: "Hardcoded password assignment", re: /\b(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i },
];

// Treat .env, edge functions and config files as exempt — these legitimately
// hold env wiring. Keys IN COMMITTED CLIENT CODE are the real risk.
const SECRET_EXEMPT = /(^|\/)(\.env(\..*)?|supabase\/functions\/|supabase\/config\.toml$|src\/integrations\/supabase\/(client|types)\.ts$)/i;

export interface SecretFinding {
  type: string;
  preview: string;   // redacted excerpt around the match
  line: number;
}

export function scanForSecrets(path: string, content: string): SecretFinding[] {
  if (SECRET_EXEMPT.test(path)) return [];
  const out: SecretFinding[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(content);
    if (!m) continue;
    const idx = m.index;
    const lineNo = content.slice(0, idx).split("\n").length;
    const around = content.slice(Math.max(0, idx - 20), idx + m[0].length + 20);
    const redacted = around.replace(m[0], `${m[0].slice(0, 4)}…REDACTED…${m[0].slice(-2)}`);
    out.push({ type: name, preview: redacted.replace(/\s+/g, " ").slice(0, 120), line: lineNo });
  }
  return out;
}

// ── Prompt injection guard ──────────────────────────────────────────
// Strip / annotate suspicious instruction-like patterns from external user
// content (file uploads, scraped pages, tool outputs) BEFORE injecting them
// into the model context. We don't sanitize the user's own chat message —
// only payloads that came from somewhere else.
const INJECTION_PATTERNS = [
  /ignore (?:all |the )?(?:previous|above|prior|earlier) (?:instructions?|messages?|prompts?)/i,
  /disregard (?:all |the )?(?:previous|above|prior) (?:instructions?|rules?)/i,
  /you are now [^.\n]{0,80}(?:dan|jailbroken|developer mode|unrestricted)/i,
  /system\s*[:\-]\s*you (?:are|must|will|should)/i,
  /<\s*\/?\s*system\s*>/i,
  /\bBEGIN (?:NEW )?SYSTEM PROMPT\b/i,
  /reveal (?:your )?(?:system )?(?:prompt|instructions)/i,
  /print (?:your |the )?(?:system )?(?:prompt|instructions|rules)/i,
];

export interface InjectionScan {
  clean: string;
  findings: string[];
}

export function scanForInjection(text: string): InjectionScan {
  if (!text) return { clean: text, findings: [] };
  const findings: string[] = [];
  let clean = text;
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(clean);
    if (m) {
      findings.push(m[0].slice(0, 80));
      clean = clean.replace(re, "[redacted: possible prompt-injection]");
    }
  }
  return { clean, findings };
}

// ── RLS suggestion ──────────────────────────────────────────────────
// When the model writes raw `CREATE TABLE public.<x>` SQL, return a hint
// reminding it (a) to enable RLS, (b) to add owner policies, (c) to keep
// roles in a separate table.
export function rlsHintFor(sql: string): string | null {
  if (!/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\./i.test(sql)) return null;
  const hints: string[] = [];
  if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql)) {
    hints.push("Add `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;`");
  }
  if (!/CREATE\s+POLICY/i.test(sql)) {
    hints.push("Add at least one CREATE POLICY (owner_select / owner_insert / owner_update / owner_delete using auth.uid() = user_id).");
  }
  if (/\brole\s+(?:text|app_role)/i.test(sql) && /CREATE\s+TABLE\s+public\.(?:profiles|users)\b/i.test(sql)) {
    hints.push("⚠ NEVER store roles on profiles/users — privilege-escalation risk. Use a separate public.user_roles table + has_role() security-definer function.");
  }
  return hints.length ? hints.join(" • ") : null;
}
