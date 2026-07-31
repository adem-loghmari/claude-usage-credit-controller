/**
 * Rolling 5-hour session windows, matching how Claude Code's own session
 * limits work (and how ccusage computes "blocks"): a window opens at the top
 * of the hour of the first activity and spans 5 hours. Activity after the
 * window ends opens a new window.
 */

import type { UsageEvent } from "./parser.js";
import type { ModelTier } from "./pricing.js";

export const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;

export interface SessionBlock {
  start: Date;
  end: Date; // start + 5h
  events: UsageEvent[];
  costUSD: number;
  costByTier: Partial<Record<ModelTier, number>>;
  totalTokens: number;
}

function floorToHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

/** Group chronologically-sorted events into 5-hour session blocks. */
export function groupIntoBlocks(events: UsageEvent[]): SessionBlock[] {
  const blocks: SessionBlock[] = [];
  let current: SessionBlock | null = null;

  for (const event of events) {
    if (!current || event.timestamp.getTime() >= current.end.getTime()) {
      const start = floorToHour(event.timestamp);
      current = {
        start,
        end: new Date(start.getTime() + SESSION_WINDOW_MS),
        events: [],
        costUSD: 0,
        costByTier: {},
        totalTokens: 0,
      };
      blocks.push(current);
    }
    current.events.push(event);
    current.costUSD += event.costUSD;
    current.costByTier[event.tier] = (current.costByTier[event.tier] ?? 0) + event.costUSD;
    const u = event.usage;
    current.totalTokens +=
      u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  }

  return blocks;
}

/** The block containing `now`, or null if the latest block has expired. */
export function currentBlock(events: UsageEvent[], now: Date = new Date()): SessionBlock | null {
  const blocks = groupIntoBlocks(events);
  const last = blocks[blocks.length - 1];
  if (!last) return null;
  if (now.getTime() >= last.start.getTime() && now.getTime() < last.end.getTime()) {
    return last;
  }
  return null;
}
