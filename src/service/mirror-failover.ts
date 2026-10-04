import { AxiosRequestConfig } from "axios";
import { axiosGet } from "../utils/axios.js";
import { parseOrigin } from "../utils/format.js";

export interface UrlMetrics {
  success: number;
  fail: number;
  lastFail: number;
}

/**
 * Origin-keyed success/fail memory for providers fronting several mirrors.
 * Mirror picks follow the user's config order: the first mirror without a
 * recent failure serves; when every mirror failed within the TTL window,
 * the best success/fail ratio serves so traffic lands somewhere healthy.
 * After the TTL a failure is forgotten and the mirror reclaims its
 * user-chosen fallback position once it recovers.
 */
export class MirrorFailover {
  private readonly metrics = new Map<string, UrlMetrics>();

  constructor(
    private readonly failTtlMs: number,
    private readonly fallbackUrl: string,
  ) {}

  select(urls: string[]): string {
    const now = Date.now();
    const isFailed = (url: string) => {
      const metrics = this.metrics.get(parseOrigin(url));
      return (
        !!metrics &&
        metrics.fail > 0 &&
        now - metrics.lastFail < this.failTtlMs
      );
    };
    const healthy = urls.find((url) => !isFailed(url));
    if (healthy) {
      return healthy;
    }
    const sorted = urls
      .map((url) => ({
        url,
        metrics: this.metrics.get(parseOrigin(url)),
      }))
      .sort((a, b) => {
        const aScore =
          ((a.metrics?.success ?? 0) + 1) / ((a.metrics?.fail ?? 0) + 1);
        const bScore =
          ((b.metrics?.success ?? 0) + 1) / ((b.metrics?.fail ?? 0) + 1);
        return bScore - aScore;
      });
    return sorted[0]?.url || this.fallbackUrl;
  }

  markSuccess(url: string): void {
    const origin = parseOrigin(url);
    const metrics = this.metrics.get(origin) ?? {
      success: 0,
      fail: 0,
      lastFail: 0,
    };
    metrics.success++;
    this.metrics.set(origin, metrics);
  }

  markFail(url: string): void {
    const origin = parseOrigin(url);
    const metrics = this.metrics.get(origin) ?? {
      success: 0,
      fail: 0,
      lastFail: 0,
    };
    metrics.fail++;
    metrics.lastFail = Date.now();
    this.metrics.set(origin, metrics);
  }

  getMetrics(): Map<string, UrlMetrics> {
    return this.metrics;
  }

  /**
   * axiosGet wrapped with per-mirror success/fail accounting so mirror
   * failover learns from every request, not only stream fetches.
   */
  async get<T>(
    url: string,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<T | null> {
    try {
      const data = await axiosGet<T>(url, axiosConfig);
      if (data === null || data === undefined) {
        this.markFail(url);
      } else {
        this.markSuccess(url);
      }
      return data;
    } catch (error) {
      this.markFail(url);
      throw error;
    }
  }
}
