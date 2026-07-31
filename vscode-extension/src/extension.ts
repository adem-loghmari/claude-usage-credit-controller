/**
 * VS Code status-bar surface for usage-control. Reuses the core parsing,
 * pricing, session-window, and checkpoint logic from ../src (bundled in by
 * esbuild). The status bar stays quiet and small; a toast only appears when a
 * spend checkpoint is crossed, phrased by the same calm messaging the CLI uses.
 */

import * as vscode from "vscode";
import { loadUsageEvents } from "../../src/parser.js";
import { currentBlock, type SessionBlock } from "../../src/session.js";
import {
  buildNotice,
  checkpointIndex,
  dominantTier,
  nextNotice,
  type CheckpointConfig,
} from "../../src/checkpoints.js";

interface NotifyState {
  blockStartISO: string;
  lastNotifiedIndex: number;
}

const STATE_KEY = "usageControl.notifyState";

function readConfig(): CheckpointConfig & { pollMinutes: number; showNotifications: boolean } {
  const cfg = vscode.workspace.getConfiguration("usageControl");
  return {
    stepUSD: cfg.get<number>("checkpointStepUSD", 1),
    tone: cfg.get<"chill" | "numbers">("tone", "chill"),
    pollMinutes: cfg.get<number>("pollMinutes", 2),
    showNotifications: cfg.get<boolean>("showNotifications", true),
  };
}

function statusText(block: SessionBlock | null): string {
  if (!block) return "$(check) Claude: quiet";
  const cost = block.costUSD;
  const label = cost < 10 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(0)}`;
  return `$(pulse) Claude: ~${label}`;
}

function tooltip(block: SessionBlock | null): string {
  if (!block) return "No active Claude Code session in the current 5-hour window.";
  const minsLeft = Math.max(0, Math.round((block.end.getTime() - Date.now()) / 60000));
  return (
    `Claude Code session spend: $${block.costUSD.toFixed(2)}\n` +
    `Mostly ${dominantTier(block)} · window resets in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.command = "usageControl.showDetails";
  context.subscriptions.push(item);
  item.show();

  let timer: NodeJS.Timeout | undefined;
  let latestBlock: SessionBlock | null = null;

  function refresh(): void {
    const config = readConfig();
    let events;
    try {
      events = loadUsageEvents();
    } catch {
      return; // logs unreadable this tick; keep last status
    }
    latestBlock = currentBlock(events);
    item.text = statusText(latestBlock);
    item.tooltip = tooltip(latestBlock);

    if (!latestBlock) return;

    const blockStartISO = latestBlock.start.toISOString();
    const state = context.globalState.get<NotifyState>(STATE_KEY);
    const lastIndex =
      state && state.blockStartISO === blockStartISO ? state.lastNotifiedIndex : 0;
    const notice = nextNotice(latestBlock, lastIndex, config);
    if (notice) {
      void context.globalState.update(STATE_KEY, {
        blockStartISO,
        lastNotifiedIndex: notice.index,
      } satisfies NotifyState);
      if (config.showNotifications) {
        void vscode.window.showInformationMessage(notice.message);
      }
    }
  }

  function schedule(): void {
    if (timer) clearInterval(timer);
    const config = readConfig();
    timer = setInterval(refresh, config.pollMinutes * 60 * 1000);
    context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("usageControl.showDetails", () => {
      const config = readConfig();
      if (!latestBlock) {
        void vscode.window.showInformationMessage(
          "No active Claude Code session right now. All quiet.",
        );
        return;
      }
      const index = Math.max(checkpointIndex(latestBlock.costUSD, config.stepUSD), 1);
      const notice = buildNotice(latestBlock, index, { ...config, tone: "numbers" });
      void vscode.window.showInformationMessage(`${notice.title} — ${notice.message}`);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("usageControl")) {
        schedule();
        refresh();
      }
    }),
  );

  refresh();
  schedule();
}

export function deactivate(): void {}
