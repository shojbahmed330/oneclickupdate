/**
 * Estimate how much real work a credit pack buys, based on the token-based
 * cost model. Keeps numbers conservative so users don't feel cheated.
 */
const AVG = {
  fullApp: 200, // mid of 100–300+
  feature: 55, // mid of 30–80
  edit: 10, // mid of 5–15
  chat: 2, // mid of 1–3
};

export type UsageHint = {
  fullApps: number;
  features: number;
  edits: number;
  chats: number;
};

export const estimateUsage = (credits: number): UsageHint => ({
  fullApps: Math.floor(credits / AVG.fullApp),
  features: Math.floor(credits / AVG.feature),
  edits: Math.floor(credits / AVG.edit),
  chats: Math.floor(credits / AVG.chat),
});

export const formatUsageLine = (credits: number): string => {
  const u = estimateUsage(credits);
  if (u.fullApps >= 1) return `≈ ${u.fullApps} full app${u.fullApps > 1 ? "s" : ""} or ${u.edits} edits`;
  if (u.features >= 1) return `≈ ${u.features} new features or ${u.edits} edits`;
  if (u.edits >= 1) return `≈ ${u.edits} small edits`;
  return `≈ ${u.chats} quick chats`;
};
