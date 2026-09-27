"use strict";
/**
 * src/utils/logger.ts
 *
 * Structured logger for Bobtention.
 * All output goes to stderr — stdout is reserved for Bob context injection.
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
exports.logger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function resolveLogFile() {
    try {
        const dir = path.join(process.cwd(), '.bobtention', 'logs');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, 'bobtention.log');
    }
    catch {
        return null;
    }
}
function formatEntry(level, message, extra) {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
    return extra ? `${base}\n${extra}` : base;
}
class Logger {
    constructor() {
        this.minLevel = 'info';
        this.logFile = null;
        this.fileInitialized = false;
    }
    getLogFile() {
        if (!this.fileInitialized) {
            this.logFile = resolveLogFile();
            this.fileInitialized = true;
        }
        return this.logFile;
    }
    write(level, message, extra) {
        if (LEVELS[level] < LEVELS[this.minLevel])
            return;
        const entry = formatEntry(level, message, extra);
        process.stderr.write(entry + '\n');
        const logFile = this.getLogFile();
        if (logFile) {
            try {
                fs.appendFileSync(logFile, entry + '\n');
            }
            catch {
                // Ignore file write errors — stderr is authoritative
            }
        }
    }
    setLevel(level) {
        this.minLevel = level;
    }
    debug(message, extra) {
        this.write('debug', message, extra);
    }
    info(message, extra) {
        this.write('info', message, extra);
    }
    warn(message, extra) {
        this.write('warn', message, extra);
    }
    error(message, extra) {
        this.write('error', message, extra);
    }
}
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map