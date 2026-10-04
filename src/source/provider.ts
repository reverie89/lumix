import {
  CatalogHandlerArgs,
  ContentType,
  MetaDetail,
  MetaPreview,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import { MirrorFailover } from "../service/mirror-failover.js";
import { Prefix, UserConfig } from "../lib/manifest.js";
import { PROVIDER_LABELS, SHORT_NAME } from "../utils/constant.js";
import { Logger } from "../utils/logger.js";
import { ContentDetail } from "./meta.js";

export enum Provider {
  KISSKH = "kisskh",
  OLE = "ole",
}

export abstract class BaseProvider {
  protected headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };
  protected logger: Logger;
  readonly displayName: string;
  name: Provider;
  abstract supportedPrefix: Prefix[];
  // Every provider fronts a configurable mirror list; its failover instance
  // owns the origin-keyed success/fail memory
  abstract readonly defaultMirrors: string[];
  abstract readonly failover: MirrorFailover;

  constructor(name: Provider) {
    this.name = name;
    this.logger = new Logger(name);
    this.displayName = `${SHORT_NAME}/${PROVIDER_LABELS[this.name] ?? this.name}`;
  }

  /**
   * Mirror candidates for a request: the user's picked mirrors when set,
   * otherwise the built-in defaults.
   */
  mirrors(config?: UserConfig): string[] {
    const mirrors = config?.providers?.[this.name]?.mirrors;
    return mirrors && mirrors.length > 0 ? mirrors : this.defaultMirrors;
  }

  abstract searchCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]>;

  abstract getCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]>;

  abstract getMeta(
    content: ContentDetail,
    type: ContentType,
    config?: UserConfig,
  ): Promise<MetaDetail | null>;

  abstract getStreams(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]>;

  abstract getSubtitles(
    content: ContentDetail,
    config?: UserConfig,
  ): Promise<Subtitle[]>;

  /**
   * @param pageSize total items per page
   * @param skip how much to skip
   * @returns page from 1
   */
  getPage(pageSize: number, skip?: number) {
    return skip ? Math.ceil(skip / pageSize) + 1 : 1;
  }
}
