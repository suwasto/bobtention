"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.resetConfigCache = resetConfigCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const logger_1 = require("../utils/logger");
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
function defaultConfig() {
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
function deepMerge(base, overlay) {
    const result = { ...base };
    for (const key of Object.keys(overlay)) {
        const overlayVal = overlay[key];
        const baseVal = base[key];
        if (overlayVal !== undefined &&
            overlayVal !== null &&
            typeof overlayVal === 'object' &&
            !Array.isArray(overlayVal) &&
            typeof baseVal === 'object' &&
            baseVal !== null &&
            !Array.isArray(baseVal)) {
            result[key] = deepMerge(baseVal, overlayVal);
        }
        else if (overlayVal !== undefined) {
            result[key] = overlayVal;
        }
    }
    return result;
}
// ---------------------------------------------------------------------------
// File loader (fail-soft)
// ---------------------------------------------------------------------------
function loadJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.warn(`[bobtention] Could not load config from ${filePath}: ${msg}`);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
let _cachedConfig = null;
/**
 * Load and cache the merged Bobtention config.
 * Call with `force = true` in tests to reload from disk.
 */
function loadConfig(force = false) {
    if (_cachedConfig && !force)
        return _cachedConfig;
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
function resetConfigCache() {
    _cachedConfig = null;
}
//# sourceMappingURL=config.js.map