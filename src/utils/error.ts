import { Logger } from "./logger.js";

export class RateLimitError extends Error {
  constructor(message: string) {
    const name = ErrorName.RATE_LIMIT;
    super(`${name} | ${message}`);
    this.name = name;
  }
}

export class TmdbError extends Error {
  constructor(message: string) {
    const name = ErrorName.TMDB;
    super(`${name} | ${message}`);
    this.name = name;
  }
}
export class FuseError extends Error {
  constructor(message: string) {
    const name = ErrorName.FUSE;
    super(`${name} | ${message}`);
    this.name = name;
  }
}

export class MatchingError extends Error {
  constructor(message: string) {
    const name = ErrorName.MATCHING;
    super(`${name} | ${message}`);
    this.name = name;
  }
}

// KISSKH

export class KisskhDetailError extends Error {
  constructor(message: string) {
    const name = ErrorName.KISSKH_DETAIL;
    super(`${name} | ${message}`);
    this.name = name;
  }
}
export class KisskhEpisodeError extends Error {
  constructor(message: string) {
    const name = ErrorName.KISSKH_EPISODE;
    super(`${name} | ${message}`);
    this.name = name;
  }
}
export class KisskhTokenError extends Error {
  constructor(message: string) {
    const name = ErrorName.KISSKH_TOKEN;
    super(`${name} | ${message}`);
    this.name = name;
  }
}

// OLE

export class OleDetailError extends Error {
  constructor(message: string) {
    const name = ErrorName.OLE_DETAIL;
    super(`${name} | ${message}`);
    this.name = name;
  }
}

enum ErrorName {
  ERROR = "Error",
  RATE_LIMIT = "[RATELIMIT]",
  FUSE = "[FUSE] Error",
  MATCHING = "[MATCHING] Error",
  UNKNOWN = "Unknown Error",
  // DB
  DB_LOCK = "[DB] Lock Error",
  DB_FOREIGN_KEY = "[DB] Foreign Key Error",
  DB_UNIQUE = "[DB] Unique Error",
  // Meta
  TMDB = "[TMDB][E]",
  // KISSKH
  KISSKH_DETAIL = "[KISSKH] Detail Error",
  KISSKH_EPISODE = "[KISSKH] Episode Error",
  KISSKH_TOKEN = "[KISSKH] Token Error",
  // OLE
  OLE_DETAIL = "[OLE] Detail Error",
}

export function handleError(
  error: Error | any,
  logger: Logger = new Logger("ERROR"),
  message: string = "",
): Error | null {
  switch (true) {
    case error instanceof RateLimitError:
    case error instanceof FuseError:
    case error instanceof MatchingError:
    case error instanceof TmdbError:
    case error instanceof KisskhDetailError:
    case error instanceof KisskhEpisodeError:
    case error instanceof OleDetailError:
      logger.warn(`${message} | ${error.message}`);
      return error;
    case error instanceof KisskhTokenError:
      logger.error(`${message} | ${error.message}`);
      return error;
    case error instanceof Error:
      const errMsg = error.message.toLowerCase();
      if (
        errMsg.includes("database is locked") ||
        errMsg.includes("could not obtain lock") ||
        errMsg.includes("deadlock")
      ) {
        logger.error(`${message} | ${error.message}`);
        error.name = ErrorName.DB_LOCK;
        return error;
      }
      if (errMsg.includes("foreign key")) {
        logger.warn(`${message} | ${error.message}`);
        error.name = ErrorName.DB_FOREIGN_KEY;
        return error;
      }
      if (errMsg.includes("unique")) {
        logger.warn(`${message} | ${error.message}`);
        error.name = ErrorName.DB_UNIQUE;
        return error;
      }
      error.name = ErrorName.ERROR;
      logger.error(`${message} | ${JSON.stringify(error.message)}`);
      return error;
    default:
      error.name = ErrorName.UNKNOWN;
      logger.error(`${message} | ${JSON.stringify(error)}`);
      return error;
  }
}
