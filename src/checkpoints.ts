/**
 * Checkpoint detection and message framing.
 *
 * The point of this tool is calm, calibrated context, not more data. When a
 * session crosses a spend checkpoint, we produce one short reassuring message
 * that anchors the number to what a typical session costs, instead of a
 * dashboard of raw counters.
 */

import type { SessionBlock } from "./session.js";
import type { ModelTier } from "./pricing.js";

export type Tone = "chill" | "numbers";

export interface CheckpointConfig {
  /** Dollar size of each checkpoint step. Default 1. */
  stepUSD: number;
  tone: Tone;
}

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  stepUSD: 1,
  tone: "chill",
};

/** Rough "typical 5-hour session" cost anchors per dominant tier, USD. */
const TYPICAL_SESSION_COST: Record<ModelTier, number> = {
  fable: 15,
  opus: 8,
  sonnet: 4,
  haiku: 1.5,
  unknown: 5,
};

export function dominantTier(block: SessionBlock): ModelTier {
  let best: ModelTier = "unknown";
  let bestCost = -1;
  for (const [tier, cost] of Object.entries(block.costByTier)) {
    if (cost !== undefined && cost > bestCost) {
      best = tier as ModelTier;
      bestCost = cost;
    }
  }
  return best;
}

/** Highest checkpoint index at or below `cost` (0 = none crossed). */
export function checkpointIndex(costUSD: number, stepUSD: number): number {
  if (stepUSD <= 0) return 0;
  return Math.floor(costUSD / stepUSD);
}

export interface CheckpointNotice {
  index: number;
  costUSD: number;
  title: string;
  message: string;
}

function tierLabel(tier: ModelTier): string {
  switch (tier) {
    case "fable":
      return "Fable";
    case "opus":
      return "Opus";
    case "sonnet":
      return "Sonnet";
    case "haiku":
      return "Haiku";
    default:
      return "mixed models";
  }
}

function money(n: number): string {
  return n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`;
}

/**
 * Build the notification for crossing checkpoint `index` in `block`.
 * Returns a calm, contextual message rather than raw numbers (unless the
 * user asked for the numbers tone).
 */
export function buildNotice(
  block: SessionBlock,
  index: number,
  config: CheckpointConfig,
): CheckpointNotice {
  const cost = index * config.stepUSD;
  const tier = dominantTier(block);
  const typical = TYPICAL_SESSION_COST[tier];
  const ratio = cost / typical;

  let context: string;
  if (ratio < 0.5) {
    context = `well within a typical 5-hour ${tierLabel(tier)} session`;
  } else if (ratio < 1.1) {
    context = `roughly what a typical 5-hour ${tierLabel(tier)} session runs`;
  } else if (ratio < 2) {
    context = `a bit above a typical ${tierLabel(tier)} session, nothing alarming`;
  } else {
    context = `a heavier-than-usual session, worth a glance if that surprises you`;
  }

  if (config.tone === "numbers") {
    const parts = Object.entries(block.costByTier)
      .filter(([, c]) => c !== undefined && c > 0.005)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      .map(([t, c]) => `${tierLabel(t as ModelTier)} ${money(c ?? 0)}`);
    return {
      index,
      costUSD: block.costUSD,
      title: `Session spend: ${money(block.costUSD)}`,
      message: `${parts.join(", ")} | ${(block.totalTokens / 1_000_000).toFixed(1)}M tokens | window ends ${block.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    };
  }

  return {
    index,
    costUSD: block.costUSD,
    title: "Claude usage check-in",
    message: `You've used about ${money(cost)} this session — ${context}. Mostly ${tierLabel(tier)}.`,
  };
}

/**
 * Given the previously notified checkpoint index and the block's current
 * cost, return the notice to send now (only the highest newly-crossed
 * checkpoint — no notification storm after a burst) or null.
 */
export function nextNotice(
  block: SessionBlock,
  lastNotifiedIndex: number,
  config: CheckpointConfig,
): CheckpointNotice | null {
  const index = checkpointIndex(block.costUSD, config.stepUSD);
  if (index <= lastNotifiedIndex) return null;
  return buildNotice(block, index, config);
}
