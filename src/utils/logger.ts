type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "NONE";
// Recommended default; change here if you need more verbose logging
const DEFAULT_LOG_LEVEL: LogLevel = "INFO";
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  NONE: 5,
};
export class Logger {
  private name: string;
  private currentPriority: number = LOG_LEVEL_PRIORITY[DEFAULT_LOG_LEVEL];

  constructor(name: string) {
    this.name = name.substring(0, 6).padEnd(6, " ").toUpperCase();
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= this.currentPriority;
  }
  trace(message: string) {
    if (this.shouldLog("TRACE")) console.trace(`[${this.name}][T] ${message}`);
  }

  debug(message: string) {
    if (this.shouldLog("DEBUG")) console.debug(`[${this.name}][D] ${message}`);
  }

  log(message: string) {
    if (this.shouldLog("INFO")) console.log(`[${this.name}] ${message}`);
  }

  warn(message: string) {
    if (this.shouldLog("WARN")) console.warn(`[${this.name}][W] ${message}`);
  }

  error(message: string) {
    if (this.shouldLog("ERROR")) console.error(`[${this.name}][E] ${message}`);
  }
}
