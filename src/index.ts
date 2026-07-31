/** Library entry point — reusable core for the CLI and (later) a VS Code extension. */

export { parseJsonl, loadUsageEvents, defaultLogRoot, type UsageEvent } from "./parser.js";
export {
  costForUsage,
  ratesForModel,
  tierForModel,
  type ModelRates,
  type ModelTier,
  type TokenUsage,
} from "./pricing.js";
export { groupIntoBlocks, currentBlock, SESSION_WINDOW_MS, type SessionBlock } from "./session.js";
export {
  buildNotice,
  nextNotice,
  checkpointIndex,
  dominantTier,
  DEFAULT_CHECKPOINT_CONFIG,
  type CheckpointConfig,
  type CheckpointNotice,
  type Tone,
} from "./checkpoints.js";
export { loadConfig, saveConfig, type Config } from "./config.js";
