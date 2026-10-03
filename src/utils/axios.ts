import axios, {
  AxiosError,
  AxiosProxyConfig,
  AxiosRequestConfig,
  HttpStatusCode,
} from "axios";
import EventEmitter from "events";
import https from "https";
import { cache } from "./cache.js";
import { USER_AGENT } from "./constant.js";
import { ENV } from "./env.js";
import { RateLimitError } from "./error.js";
import { isKisskhHost } from "./format.js";
import { Logger } from "./logger.js";
import { getWebshareProxyConfig } from "./proxy/webshare.js";

// process.setMaxListeners(20);
EventEmitter.defaultMaxListeners = 23;
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
});

// Bound response sizes so one huge upstream body can't balloon the cache
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function createClient(
  headers: Record<string, string> = {},
  proxy?: AxiosProxyConfig,
  extraConfig: AxiosRequestConfig = {},
) {
  const axiosConfig: AxiosRequestConfig = {
    httpsAgent,
    headers,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_RESPONSE_BYTES,
    ...extraConfig,
  };
  if (proxy) axiosConfig.proxy = proxy;
  const instance = axios.create(axiosConfig);
  return instance;
}

const defaultClient = createClient({
  "User-Agent": USER_AGENT,
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
});

// Mirrors are user-supplied: never follow redirects, or a 302 could escape
// the kisskh host check toward internal addresses.
const kisskhClient = createClient(
  {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  },
  getWebshareProxyConfig(),
  { maxRedirects: 0 },
);

function isKisskhUrl(url: string) {
  try {
    // Any mirror on a kisskh domain uses the kisskh client (proxy, headers)
    return isKisskhHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function getClient(url: string) {
  if (isKisskhUrl(url)) return kisskhClient;
  return defaultClient;
}

const logger = new Logger("AXIOS");

// Concurrent cold requests for the same URL share one upstream fetch
// (a cold catalog page fans out to ~21 URLs; without this, every request
// in a burst repeats the whole chain)
const inFlight = new Map<string, Promise<unknown>>();

// Marker cached for FAILURE_TTL_MS after a fetch fails: callers get null
// without another upstream attempt until it expires, so an upstream outage
// costs one attempt per URL per minute instead of one per request
const NEGATIVE_SENTINEL = { negative: true } as const;
const FAILURE_TTL_MS = 60 * 1000;

// Retry-After as delay in ms: delta-seconds or an HTTP-date; undefined when
// absent or unparseable
function retryAfterMs(header: unknown): number | undefined {
  if (typeof header !== "string") return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export async function axiosGet<T>(
  url: string,
  config?: AxiosRequestConfig,
  cacheMs: number = 2 * 60 * 60 * 1000,
): Promise<T | null> {
  const urlKey = `url:${url}`;
  const cacheData = cache.get(urlKey);
  if (cacheData === NEGATIVE_SENTINEL) return null;
  if (cacheData) return cacheData;
  const pending = inFlight.get(urlKey);
  if (pending) return pending as Promise<T | null>;
  const request = getRequest<T>(url, config, cacheMs, urlKey).finally(() => {
    inFlight.delete(urlKey);
  });
  inFlight.set(urlKey, request);
  return request;
}

async function getRequest<T>(
  url: string,
  config: AxiosRequestConfig | undefined,
  cacheMs: number,
  urlKey: string,
): Promise<T | null> {
  let lastError: AxiosError | unknown;
  const http = getClient(url);
  let attempt = 0;
  let timeout = 0;
  let isRateLimit = false;

  // The abort budget is the retry-loop deadline. RETRY_TIMEOUT_MS stays the
  // default, but a caller asking for a longer attempt timeout (slow stream
  // or subtitle downloads) raises the ceiling for this call.
  const attemptTimeout = config?.timeout ?? 10000;
  const budgetMs = Math.max(ENV.RETRY_TIMEOUT_MS, attemptTimeout);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), budgetMs);

  try {
    while (true) {
      attempt++;
      try {
        const axiosConfig: AxiosRequestConfig = {
          timeout: attemptTimeout,
          ...config,
          signal: controller.signal,
        };
        const response = await http.get(url, axiosConfig);
        clearTimeout(timeoutId);
        const data = response.data;
        cache.set(
          urlKey,
          data,
          cacheMs,
          typeof data === "string" ? data.length * 2 : undefined,
        );
        return data as T;
      } catch (error: AxiosError | unknown) {
        lastError = error;
        const errorStatus =
          error instanceof AxiosError && error.response?.status;
        isRateLimit =
          errorStatus === HttpStatusCode.TooManyRequests ||
          errorStatus === HttpStatusCode.UnavailableForLegalReasons ||
          errorStatus === HttpStatusCode.Forbidden;
        if (!isRateLimit) break;
        // Honor the server's Retry-After exactly when present; otherwise
        // fall back to linear backoff with jitter
        const serverWait =
          error instanceof AxiosError
            ? retryAfterMs(error.response?.headers?.["retry-after"])
            : undefined;
        const delay =
          serverWait ??
          ENV.RETRY_DELAY_MS * attempt +
            Math.random() * ENV.RETRY_JITTER_MS;
        timeout += delay;
        if (timeout >= budgetMs) {
          logger.log(`Max timeout ${budgetMs}ms reached | ${url}`);
          break;
        }
        logger.log(`Retry ${attempt} in ${Math.ceil(delay / 1000)}s | ${url}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  // kisskh mirrors keep their own failover memory; everything else gets a
  // short-lived failure marker so the next request skips the dead upstream
  if (!isKisskhUrl(url)) {
    cache.set(urlKey, NEGATIVE_SENTINEL, FAILURE_TTL_MS);
  }
  if (isRateLimit) {
    throw new RateLimitError(url);
  }
  logger.error(`Fail GET | ${url} ${lastError}`);
  return null;
}
