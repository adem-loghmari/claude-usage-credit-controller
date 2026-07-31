/** User config + watcher state, stored under ~/.config/usage-control/. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_CHECKPOINT_CONFIG, type CheckpointConfig, type Tone } from "./checkpoints.js";

export interface Config extends CheckpointConfig {
  /** Poll interval for the watcher, in minutes. */
  pollMinutes: number;
}

export const DEFAULT_CONFIG: Config = {
  ...DEFAULT_CHECKPOINT_CONFIG,
  pollMinutes: 2,
};

export function configDir(): string {
  return join(homedir(), ".config", "usage-control");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function statePath(): string {
  return join(configDir(), "state.json");
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    const config = { ...DEFAULT_CONFIG };
    if (typeof raw.stepUSD === "number" && raw.stepUSD > 0) config.stepUSD = raw.stepUSD;
    if (raw.tone === "chill" || raw.tone === "numbers") config.tone = raw.tone as Tone;
    if (typeof raw.pollMinutes === "number" && raw.pollMinutes >= 0.5) {
      config.pollMinutes = raw.pollMinutes;
    }
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/** Watcher state: which checkpoint we last notified for which window. */
export interface WatchState {
  blockStartISO: string;
  lastNotifiedIndex: number;
}

export function loadState(): WatchState | null {
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf8"));
    if (typeof raw.blockStartISO === "string" && typeof raw.lastNotifiedIndex === "number") {
      return raw as WatchState;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function saveState(state: WatchState): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
}
