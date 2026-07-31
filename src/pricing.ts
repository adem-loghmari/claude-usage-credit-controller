/**
 * Per-model pricing in USD per million tokens.
 * Cache multipliers follow the API's published economics: 5-minute cache
 * writes bill at 1.25x input, 1-hour writes at 2x input, reads at 0.1x input.
 */

export type ModelTier = "fable" | "opus" | "sonnet" | "haiku" | "unknown";

export interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
  tier: ModelTier;
}

const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;
const CACHE_READ_MULT = 0.1;

// Matched by substring so dated snapshot IDs (claude-haiku-4-5-20251001) and
// provider-prefixed IDs (anthropic.claude-opus-4-8) resolve too. Order matters:
// first match wins, so more specific patterns come first.
const RATE_TABLE: Array<[pattern: string, rates: ModelRates]> = [
  ["fable-5", { inputPerMTok: 10, outputPerMTok: 50, tier: "fable" }],
  ["mythos-5", { inputPerMTok: 10, outputPerMTok: 50, tier: "fable" }],
  ["opus-4-8", { inputPerMTok: 5, outputPerMTok: 25, tier: "opus" }],
  ["opus-4-7", { inputPerMTok: 5, outputPerMTok: 25, tier: "opus" }],
  ["opus-4-6", { inputPerMTok: 5, outputPerMTok: 25, tier: "opus" }],
  ["opus-4-5", { inputPerMTok: 5, outputPerMTok: 25, tier: "opus" }],
  ["opus", { inputPerMTok: 15, outputPerMTok: 75, tier: "opus" }],
  ["sonnet-5", { inputPerMTok: 3, outputPerMTok: 15, tier: "sonnet" }],
  ["sonnet", { inputPerMTok: 3, outputPerMTok: 15, tier: "sonnet" }],
  ["haiku-4-5", { inputPerMTok: 1, outputPerMTok: 5, tier: "haiku" }],
  ["haiku", { inputPerMTok: 0.8, outputPerMTok: 4, tier: "haiku" }],
];

export function ratesForModel(model: string): ModelRates | null {
  for (const [pattern, rates] of RATE_TABLE) {
    if (model.includes(pattern)) return rates;
  }
  return null;
}

export function tierForModel(model: string): ModelTier {
  return ratesForModel(model)?.tier ?? "unknown";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Breakdown of cacheCreationTokens by TTL, when the log provides it. */
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
}

/** Cost in USD for one usage record on the given model. Unknown models cost 0. */
export function costForUsage(model: string, usage: TokenUsage): number {
  const rates = ratesForModel(model);
  if (!rates) return 0;
  const perTokIn = rates.inputPerMTok / 1_000_000;
  const perTokOut = rates.outputPerMTok / 1_000_000;

  let cacheWriteCost: number;
  if (
    usage.cacheCreation5mTokens !== undefined ||
    usage.cacheCreation1hTokens !== undefined
  ) {
    cacheWriteCost =
      (usage.cacheCreation5mTokens ?? 0) * perTokIn * CACHE_WRITE_5M_MULT +
      (usage.cacheCreation1hTokens ?? 0) * perTokIn * CACHE_WRITE_1H_MULT;
  } else {
    cacheWriteCost = usage.cacheCreationTokens * perTokIn * CACHE_WRITE_5M_MULT;
  }

  return (
    usage.inputTokens * perTokIn +
    usage.outputTokens * perTokOut +
    cacheWriteCost +
    usage.cacheReadTokens * perTokIn * CACHE_READ_MULT
  );
}
