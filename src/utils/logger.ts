/**
 * src/utils/logger.ts
 *
 * Structured logger for Bobtention.
 * All output goes to stderr — stdout is reserved for Bob context injection.
 */

import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveLogFile(): string | null {
  try {
    const dir = path.join(process.cwd(), '.bobtention', 'logs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'bobtention.log');
  } catch {
    return null;
  }
}

function formatEntry(level: LogLevel, message: string, extra?: string): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  return extra ? `${base}\n${extra}` : base;
}

class Logger {
  private minLevel: LogLevel = 'info';
  private logFile: string | null = null;
  private fileInitialized = false;

  private getLogFile(): string | null {
    if (!this.fileInitialized) {
      this.logFile = resolveLogFile();
      this.fileInitialized = true;
    }
    return this.logFile;
  }

  private write(level: LogLevel, message: string, extra?: string): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const entry = formatEntry(level, message, extra);
    process.stderr.write(entry + '\n');
    const logFile = this.getLogFile();
    if (logFile) {
      try {
        fs.appendFileSync(logFile, entry + '\n');
      } catch {
        // Ignore file write errors — stderr is authoritative
      }
    }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(message: string, extra?: string): void {
    this.write('debug', message, extra);
  }

  info(message: string, extra?: string): void {
    this.write('info', message, extra);
  }

  warn(message: string, extra?: string): void {
    this.write('warn', message, extra);
  }

  error(message: string, extra?: string): void {
    this.write('error', message, extra);
  }
}

export const logger = new Logger();
