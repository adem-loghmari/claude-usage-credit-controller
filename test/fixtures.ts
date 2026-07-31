/** Sample log lines shaped like real ~/.claude/projects JSONL entries. */

export function assistantLine(opts: {
  msgId: string;
  requestId: string;
  model?: string;
  timestamp?: string;
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
  cache1h?: number;
  cache5m?: number;
}): string {
  const cacheCreation =
    opts.cache1h !== undefined || opts.cache5m !== undefined
      ? {
          ephemeral_5m_input_tokens: opts.cache5m ?? 0,
          ephemeral_1h_input_tokens: opts.cache1h ?? 0,
        }
      : undefined;
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp ?? "2026-07-22T10:15:00.000Z",
    sessionId: "sess-1",
    requestId: opts.requestId,
    uuid: `uuid-${Math.random()}`,
    message: {
      id: opts.msgId,
      model: opts.model ?? "claude-opus-4-8",
      usage: {
        input_tokens: opts.input ?? 100,
        output_tokens: opts.output ?? 50,
        cache_creation_input_tokens: opts.cacheCreate ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
      },
    },
  });
}

export const userLine = JSON.stringify({
  type: "user",
  timestamp: "2026-07-22T10:14:00.000Z",
  message: { role: "user", content: "hello" },
});
