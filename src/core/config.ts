/**
 * src/core/config.ts
 *
 * Configuration type and loader for Bobtention.
 *
 * Resolution order (last wins):
 *   1. Built-in defaults
 *   2. Global config:    ~/.bobtention/config.json
 *   3. Workspace config: ./bobtention.config.json
 *
 * Config loader returns a complete, typed config even when files are missing or partial.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BobtentionConfig {
  enabled: boolean;
  decisionEngine: {
    provider: 'laya' | 'local';
    /** Required when provider is 'laya'. Default: http://localhost:8000/v1/systemone */
    endpoint?: string;
    /** Request timeout in ms. Default: 3000 */
    timeout: number;
  };
  autonomy: {
    default: 'autonomous';
    /** Confidence threshold above which WATCH is triggered. Default: 0.55 */
    watchThreshold: number;
    /** Confidence threshold above which BLOCK is triggered. Default: 0.85 */
    blockThreshold: number;
  };
  signals: {
    taskDrift: boolean;
    repeatedFailure: boolean;
    scopeExpansion: boolean;
    highImpactAction: boolean;
    uncertainty: boolean;
  };
  highImpactPatterns: Array<{ pattern: string; category: string }>;
  humanOverride: { enabled: boolean };
  session: {
    /** Bounded action history window. Default: 50 */
    maxActions: number;
    /** Default: .bobtention/sessions (workspace-local; override via bobtention.config.json) */
    storagePath: string;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultConfig(): BobtentionConfig {
  return {
    enabled: true,
    decisionEngine: {
      provider: 'laya',
      endpoint: 'http://localhost:8000/v1/systemone',
      timeout: 3000,
    },
    autonomy: {
      default: 'autonomous',
      watchThreshold: 0.55,
      blockThreshold: 0.85,
    },
    signals: {
      taskDrift: true,
      repeatedFailure: true,
      scopeExpansion: true,
      highImpactAction: true,
      uncertainty: true,
    },
    highImpactPatterns: [
      { pattern: 'delete|remove|drop|truncate', category: 'destructive' },
      { pattern: 'migration|schema', category: 'schema-change' },
      { pattern: '\\.env|secret|credential|password|token|key', category: 'credentials' },
      { pattern: 'deploy|release|publish|push.*prod|main', category: 'deployment' },
    ],
    humanOverride: { enabled: true },
    session: {
      maxActions: 50,
      storagePath: path.join(process.cwd(), '.bobtention', 'sessions'),
    },
  };
}

// ---------------------------------------------------------------------------
// Deep merge (partial source over full target)
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T extends object>(base: T, overlay: DeepPartial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(overlay) as Array<keyof T>) {
    const overlayVal = overlay[key];
    const baseVal = base[key];
    if (
      overlayVal !== undefined &&
      overlayVal !== null &&
      typeof overlayVal === 'object' &&
      !Array.isArray(overlayVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as object, overlayVal as DeepPartial<object>) as T[keyof T];
    } else if (overlayVal !== undefined) {
      result[key] = overlayVal as T[keyof T];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// File loader (fail-soft)
// ---------------------------------------------------------------------------

function loadJsonFile(filePath: string): DeepPartial<BobtentionConfig> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as DeepPartial<BobtentionConfig>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[bobtention] Could not load config from ${filePath}: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cachedConfig: BobtentionConfig | null = null;

/**
 * Load and cache the merged Bobtention config.
 * Call with `force = true` in tests to reload from disk.
 */
export function loadConfig(force = false): BobtentionConfig {
  if (_cachedConfig && !force) return _cachedConfig;

  let config = defaultConfig();

  const globalPath = path.join(os.homedir(), '.bobtention', 'config.json');
  const workspacePath = path.join(process.cwd(), 'bobtention.config.json');

  const globalOverride = loadJsonFile(globalPath);
  if (globalOverride) {
    config = deepMerge(config, globalOverride);
  }

  const workspaceOverride = loadJsonFile(workspacePath);
  if (workspaceOverride) {
    config = deepMerge(config, workspaceOverride);
  }

  _cachedConfig = config;
  return config;
}

/** Reset cached config (for testing only) */
export function resetConfigCache(): void {
  _cachedConfig = null;
}
