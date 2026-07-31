/**
 * Parser for Claude Code session logs (~/.claude/projects/<project>/<session>.jsonl).
 *
 * Each assistant API response is written as one JSONL line *per content block*,
 * all carrying the same message.id / requestId and identical usage numbers.
 * Counting every line would multiply cost several-fold, so entries are
 * deduplicated on message.id + requestId (the same scheme ccusage uses).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { costForUsage, tierForModel, type ModelTier, type TokenUsage } from "./pricing.js";

export interface UsageEvent {
  timestamp: Date;
  model: string;
  tier: ModelTier;
  usage: TokenUsage;
  costUSD: number;
  sessionId?: string;
}

export function defaultLogRoot(): string {
  return join(homedir(), ".claude", "projects");
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

function toTokenUsage(raw: RawUsage): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheCreationTokens: raw.cache_creation_input_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
  };
  if (raw.cache_creation) {
    usage.cacheCreation5mTokens = raw.cache_creation.ephemeral_5m_input_tokens ?? 0;
    usage.cacheCreation1hTokens = raw.cache_creation.ephemeral_1h_input_tokens ?? 0;
  }
  return usage;
}

/**
 * Parse JSONL content into usage events. `seen` carries dedup keys across
 * multiple files/calls; pass a shared Set when parsing a whole directory tree.
 */
export function parseJsonl(content: string, seen: Set<string> = new Set()): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // tolerate torn writes / partial lines
    }
    if (entry?.type !== "assistant") continue;
    const message = entry.message;
    const rawUsage: RawUsage | undefined = message?.usage;
    const model: string | undefined = message?.model;
    if (!rawUsage || !model || model === "<synthetic>") continue;
    if (!entry.timestamp) continue;

    const key = `${message.id ?? ""}:${entry.requestId ?? ""}`;
    if (key !== ":") {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    const usage = toTokenUsage(rawUsage);
    if (
      usage.inputTokens === 0 &&
      usage.outputTokens === 0 &&
      usage.cacheCreationTokens === 0 &&
      usage.cacheReadTokens === 0
    ) {
      continue;
    }

    const timestamp = new Date(entry.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;

    events.push({
      timestamp,
      model,
      tier: tierForModel(model),
      usage,
      costUSD: costForUsage(model, usage),
      sessionId: entry.sessionId,
    });
  }
  return events;
}

/**
 * Read every session log under the Claude Code projects directory and return
 * deduplicated usage events, sorted by timestamp.
 *
 * `since` skips files whose mtime predates it — cheap incremental scans for
 * the watcher (dedup still guards against re-reads of overlapping files).
 */
export function loadUsageEvents(
  logRoot: string = defaultLogRoot(),
  since?: Date,
): UsageEvent[] {
  const seen = new Set<string>();
  const events: UsageEvent[] = [];

  let projects: string[];
  try {
    projects = readdirSync(logRoot);
  } catch {
    return [];
  }

  for (const project of projects) {
    const projectDir = join(logRoot, project);
    let files: string[];
    try {
      files = readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(projectDir, file);
      try {
        if (since && statSync(path).mtime < since) continue;
        events.push(...parseJsonl(readFileSync(path, "utf8"), seen));
      } catch {
        continue;
      }
    }
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return events;
}
