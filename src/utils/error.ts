import { Logger } from "./logger.js";

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

// Channel-tagged errors: each class prefixes its ErrorName to the message so
// log lines carry the tag, and handleError/catch sites branch on instanceof.
const namedError = (name: string) =>
  class extends Error {
    constructor(message: string) {
      super(`${name} | ${message}`);
      this.name = name;
    }
  };

export const RateLimitError = namedError(ErrorName.RATE_LIMIT);
export const TmdbError = namedError(ErrorName.TMDB);
export const FuseError = namedError(ErrorName.FUSE);
export const MatchingError = namedError(ErrorName.MATCHING);
export const KisskhDetailError = namedError(ErrorName.KISSKH_DETAIL);
export const KisskhEpisodeError = namedError(ErrorName.KISSKH_EPISODE);
export const KisskhTokenError = namedError(ErrorName.KISSKH_TOKEN);
export const OleDetailError = namedError(ErrorName.OLE_DETAIL);

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
