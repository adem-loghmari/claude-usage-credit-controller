# usage-control

Calm, calibrated notifications about your Claude Code spend, instead of anxiety-inducing dashboards.

It parses Claude Code's local session logs (`~/.claude/projects/*/*.jsonl`), computes cost per model from published token rates (including prompt-cache write/read multipliers), tracks the current rolling 5-hour session window, and sends one short, reassuring desktop notification each time you cross a spend checkpoint:

> You've used about $1.00 this session — well within a typical 5-hour Opus session.

## Usage

```sh
npx usage-control            # status: current session in one friendly line
npx usage-control watch      # background watcher; notifies at each checkpoint
npx usage-control check      # one-shot check, for cron or a systemd timer
npx usage-control config     # show settings
```

To keep it running across terminal sessions, either run `watch` in a service, or wire `check` into a systemd user timer:

```sh
systemd-run --user --on-calendar='*:0/2' --unit=usage-control \
  $(command -v node) $(pwd)/dist/cli.js check
```

## Configuration

Stored in `~/.config/usage-control/config.json`.

```sh
usage-control config set step 2         # notify every $2 instead of every $1
usage-control config set tone numbers   # raw breakdown instead of calm context
usage-control config set tone chill     # back to calm mode (default)
usage-control config set poll 5         # watcher polls every 5 minutes
```

`chill` tone anchors the number to what a typical 5-hour session costs for your dominant model tier (a mostly-Haiku session and a mostly-Opus session get very different framing). `numbers` tone gives the per-tier dollar breakdown, token count, and window end time.

## How it works

- Claude Code writes one JSONL line per response content block; lines for the same API response share a `message.id`/`requestId` and repeat identical usage numbers, so entries are deduplicated on that pair (the same scheme ccusage uses).
- Cost = input, output, cache-write (1.25x input for 5-minute TTL, 2x for 1-hour TTL), and cache-read (0.1x input) tokens times per-model rates in [src/pricing.ts](src/pricing.ts).
- Session windows start at the top of the hour of the first activity and span 5 hours, matching Claude Code's own session limits.
- Notified checkpoints persist to `~/.config/usage-control/state.json`, so restarts and parallel watchers never repeat a notification.

## Development

```sh
npm install
npm test        # vitest, runs against sample log fixtures
npm run build   # tsc -> dist/
npm run dev     # run the CLI from source
```

The core (parsing, pricing, sessions, checkpoints) is exported from [src/index.ts](src/index.ts) with no CLI or notifier dependencies; the VS Code extension bundles it directly.

## VS Code extension

[vscode-extension/](vscode-extension/) surfaces the same session tracking in the status bar (`Claude: ~$3.20`, tooltip with tier and window reset time). Crossing a checkpoint shows one toast with the same calm phrasing as the CLI; clicking the status bar item shows the raw breakdown. Settings under `usageControl.*`: `checkpointStepUSD`, `tone`, `pollMinutes`, `showNotifications`.

```sh
cd vscode-extension
npm install && npm run build && npm run package
code --install-extension usage-control-vscode-0.1.0.vsix
```
