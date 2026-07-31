import { describe, it, expect } from "vitest";
import { parseJsonl } from "../src/parser.js";
import { costForUsage, ratesForModel } from "../src/pricing.js";
import { groupIntoBlocks, currentBlock } from "../src/session.js";
import { checkpointIndex, nextNotice, DEFAULT_CHECKPOINT_CONFIG, buildNotice } from "../src/checkpoints.js";
import { assistantLine, userLine } from "./fixtures.js";

describe("parseJsonl", () => {
  it("parses an assistant entry with usage", () => {
    const events = parseJsonl(
      [userLine, assistantLine({ msgId: "m1", requestId: "r1", input: 200, output: 100 })].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe("claude-opus-4-8");
    expect(events[0].usage.inputTokens).toBe(200);
    expect(events[0].usage.outputTokens).toBe(100);
  });

  it("dedupes repeated message.id + requestId (one line per content block)", () => {
    const line = assistantLine({ msgId: "m1", requestId: "r1" });
    const events = parseJsonl([line, line, line].join("\n"));
    expect(events).toHaveLength(1);
  });

  it("keeps distinct messages", () => {
    const events = parseJsonl(
      [
        assistantLine({ msgId: "m1", requestId: "r1" }),
        assistantLine({ msgId: "m2", requestId: "r2" }),
      ].join("\n"),
    );
    expect(events).toHaveLength(2);
  });

  it("shares dedup across files via the seen set", () => {
    const seen = new Set<string>();
    const line = assistantLine({ msgId: "m1", requestId: "r1" });
    expect(parseJsonl(line, seen)).toHaveLength(1);
    expect(parseJsonl(line, seen)).toHaveLength(0);
  });

  it("skips synthetic models, malformed lines, and zero-usage entries", () => {
    const events = parseJsonl(
      [
        "not json {",
        assistantLine({ msgId: "m1", requestId: "r1", model: "<synthetic>" }),
        assistantLine({ msgId: "m2", requestId: "r2", input: 0, output: 0 }),
      ].join("\n"),
    );
    expect(events).toHaveLength(0);
  });
});

describe("pricing", () => {
  it("prices opus 4.8 correctly", () => {
    // 1M input at $5 + 1M output at $25
    const cost = costForUsage("claude-opus-4-8", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(cost).toBeCloseTo(30);
  });

  it("applies cache multipliers with TTL breakdown", () => {
    // opus input rate $5/MTok; 1h write = 2x, read = 0.1x
    const cost = costForUsage("claude-opus-4-8", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreation1hTokens: 1_000_000,
      cacheCreation5mTokens: 0,
    });
    expect(cost).toBeCloseTo(10 + 0.5);
  });

  it("falls back to 1.25x when no TTL breakdown present", () => {
    const cost = costForUsage("claude-opus-4-8", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 0,
    });
    expect(cost).toBeCloseTo(6.25);
  });

  it("resolves dated and prefixed model IDs", () => {
    expect(ratesForModel("claude-haiku-4-5-20251001")?.inputPerMTok).toBe(1);
    expect(ratesForModel("anthropic.claude-opus-4-8")?.tier).toBe("opus");
    expect(ratesForModel("claude-fable-5")?.inputPerMTok).toBe(10);
    expect(ratesForModel("claude-sonnet-5")?.tier).toBe("sonnet");
    expect(ratesForModel("mystery-model")).toBeNull();
  });
});

describe("session blocks", () => {
  const at = (iso: string, msgId: string) =>
    assistantLine({ msgId, requestId: msgId, timestamp: iso, input: 1000, output: 1000 });

  it("groups events within 5 hours into one block, floored to the hour", () => {
    const events = parseJsonl(
      [at("2026-07-22T10:15:00Z", "a"), at("2026-07-22T14:59:00Z", "b")].join("\n"),
    );
    const blocks = groupIntoBlocks(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start.toISOString()).toBe("2026-07-22T10:00:00.000Z");
    expect(blocks[0].end.toISOString()).toBe("2026-07-22T15:00:00.000Z");
  });

  it("starts a new block after the window ends", () => {
    const events = parseJsonl(
      [at("2026-07-22T10:15:00Z", "a"), at("2026-07-22T15:01:00Z", "b")].join("\n"),
    );
    expect(groupIntoBlocks(events)).toHaveLength(2);
  });

  it("currentBlock returns null when the last block expired", () => {
    const events = parseJsonl(at("2026-07-22T00:15:00Z", "a"));
    expect(currentBlock(events, new Date("2026-07-22T12:00:00Z"))).toBeNull();
    expect(currentBlock(events, new Date("2026-07-22T03:00:00Z"))).not.toBeNull();
  });
});

describe("checkpoints", () => {
  const at = (iso: string, msgId: string, output: number) =>
    assistantLine({ msgId, requestId: msgId, timestamp: iso, input: 0, output });

  it("computes checkpoint index from cost and step", () => {
    expect(checkpointIndex(0.4, 1)).toBe(0);
    expect(checkpointIndex(1.7, 1)).toBe(1);
    expect(checkpointIndex(5.2, 2)).toBe(2);
  });

  it("emits a notice only when a new checkpoint is crossed", () => {
    // 100k output tokens on opus = $2.50
    const events = parseJsonl(at("2026-07-22T10:15:00Z", "a", 100_000));
    const block = groupIntoBlocks(events)[0];
    const notice = nextNotice(block, 0, DEFAULT_CHECKPOINT_CONFIG);
    expect(notice).not.toBeNull();
    expect(notice!.index).toBe(2);
    // already notified at 2 -> nothing new
    expect(nextNotice(block, 2, DEFAULT_CHECKPOINT_CONFIG)).toBeNull();
  });

  it("chill tone anchors to a typical session, numbers tone shows the breakdown", () => {
    const events = parseJsonl(at("2026-07-22T10:15:00Z", "a", 100_000));
    const block = groupIntoBlocks(events)[0];
    const chill = buildNotice(block, 2, { stepUSD: 1, tone: "chill" });
    expect(chill.message).toContain("about $2.00 this session");
    expect(chill.message).toContain("Opus");
    expect(chill.message).not.toContain("tokens");
    const numbers = buildNotice(block, 2, { stepUSD: 1, tone: "numbers" });
    expect(numbers.message).toContain("tokens");
  });
});
