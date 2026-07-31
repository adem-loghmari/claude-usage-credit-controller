/**
 * Background watcher: poll the log directory every N minutes, and when the
 * current 5-hour window crosses a new checkpoint, send one desktop
 * notification. State persists to disk so restarts (or separate terminal
 * sessions) never re-notify for a checkpoint already announced.
 */

import notifier from "node-notifier";
import { loadUsageEvents } from "./parser.js";
import { currentBlock } from "./session.js";
import { nextNotice } from "./checkpoints.js";
import { loadConfig, loadState, saveState } from "./config.js";

export function checkOnce(logRoot?: string, notify: boolean = true): void {
  const config = loadConfig();
  const block = currentBlock(loadUsageEvents(logRoot));
  if (!block) return;

  const state = loadState();
  const blockStartISO = block.start.toISOString();
  const lastIndex = state && state.blockStartISO === blockStartISO ? state.lastNotifiedIndex : 0;

  const notice = nextNotice(block, lastIndex, config);
  if (!notice) return;

  saveState({ blockStartISO, lastNotifiedIndex: notice.index });
  if (notify) {
    notifier.notify({ title: notice.title, message: notice.message });
  }
  console.log(`[${new Date().toLocaleTimeString()}] ${notice.title}: ${notice.message}`);
}

export function watch(logRoot?: string): void {
  const config = loadConfig();
  const intervalMs = config.pollMinutes * 60 * 1000;
  console.log(
    `usage-control: watching Claude Code usage (every ${config.pollMinutes} min, ` +
      `$${config.stepUSD} checkpoints, ${config.tone} tone). Ctrl-C to stop.`,
  );
  checkOnce(logRoot);
  setInterval(() => {
    try {
      checkOnce(logRoot);
    } catch (err) {
      console.error("usage-control: check failed:", err);
    }
  }, intervalMs);
}
