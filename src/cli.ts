#!/usr/bin/env node
/**
 * usage-control — calm Claude Code spend notifications.
 *
 *   usage-control status          Show current session in one friendly line
 *   usage-control watch           Run the background watcher (polls logs)
 *   usage-control check           One-shot check (for cron/systemd timers)
 *   usage-control config          Show config
 *   usage-control config set <key> <value>   step | tone | poll
 */

import { loadUsageEvents } from "./parser.js";
import { currentBlock, groupIntoBlocks } from "./session.js";
import { buildNotice, checkpointIndex, dominantTier } from "./checkpoints.js";
import { loadConfig, saveConfig, configDir } from "./config.js";
import { watch, checkOnce } from "./watcher.js";

function status(): void {
  const config = loadConfig();
  const events = loadUsageEvents();
  const block = currentBlock(events);

  if (!block) {
    console.log("No active session right now. All quiet.");
    const blocks = groupIntoBlocks(events);
    const last = blocks[blocks.length - 1];
    if (last) {
      console.log(
        `Last session (${last.start.toLocaleString()}) came to about $${last.costUSD.toFixed(2)}.`,
      );
    }
    return;
  }

  const index = checkpointIndex(block.costUSD, config.stepUSD);
  const notice = buildNotice(block, Math.max(index, 1), config);
  if (config.tone === "numbers") {
    console.log(`${notice.title}\n${notice.message}`);
  } else {
    console.log(notice.message);
    const minsLeft = Math.round((block.end.getTime() - Date.now()) / 60000);
    console.log(`This 5-hour window resets in about ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m.`);
  }
}

function showConfig(): void {
  const config = loadConfig();
  console.log(`Config (${configDir()}/config.json):`);
  console.log(`  checkpoint step: $${config.stepUSD}`);
  console.log(`  tone:            ${config.tone} (chill = calm context, numbers = raw breakdown)`);
  console.log(`  poll interval:   ${config.pollMinutes} min`);
}

function setConfig(key: string, value: string): void {
  const config = loadConfig();
  switch (key) {
    case "step": {
      const n = Number(value);
      if (!(n > 0)) {
        console.error("step must be a positive dollar amount, e.g. 0.5 or 2");
        process.exit(1);
      }
      config.stepUSD = n;
      break;
    }
    case "tone": {
      if (value !== "chill" && value !== "numbers") {
        console.error('tone must be "chill" or "numbers"');
        process.exit(1);
      }
      config.tone = value;
      break;
    }
    case "poll": {
      const n = Number(value);
      if (!(n >= 0.5)) {
        console.error("poll must be at least 0.5 (minutes)");
        process.exit(1);
      }
      config.pollMinutes = n;
      break;
    }
    default:
      console.error(`Unknown key "${key}". Valid keys: step, tone, poll`);
      process.exit(1);
  }
  saveConfig(config);
  console.log("Saved.");
  showConfig();
}

const [, , command, ...rest] = process.argv;

switch (command) {
  case undefined:
  case "status":
    status();
    break;
  case "watch":
    watch();
    break;
  case "check":
    checkOnce();
    break;
  case "config":
    if (rest[0] === "set" && rest[1] && rest[2]) {
      setConfig(rest[1], rest[2]);
    } else if (rest.length === 0) {
      showConfig();
    } else {
      console.error("Usage: usage-control config [set <step|tone|poll> <value>]");
      process.exit(1);
    }
    break;
  case "--help":
  case "-h":
  case "help":
    console.log(`usage-control — calm Claude Code spend notifications

Commands:
  status              Current session, in one friendly line (default)
  watch               Poll logs and notify at each checkpoint crossed
  check               One-shot check (for cron / systemd timers)
  config              Show configuration
  config set step 2   Notify every $2 instead of every $1
  config set tone numbers   Raw breakdown instead of calm context
  config set poll 5   Poll every 5 minutes`);
    break;
  default:
    console.error(`Unknown command "${command}". Try: usage-control help`);
    process.exit(1);
}
