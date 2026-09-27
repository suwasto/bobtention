/**
 * src/utils/logger.ts
 *
 * Structured logger for Bobtention.
 * All output goes to stderr — stdout is reserved for Bob context injection.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
declare class Logger {
    private minLevel;
    private logFile;
    private fileInitialized;
    private getLogFile;
    private write;
    setLevel(level: LogLevel): void;
    debug(message: string, extra?: string): void;
    info(message: string, extra?: string): void;
    warn(message: string, extra?: string): void;
    error(message: string, extra?: string): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map