import { Subtitle } from "@stremio-addon/sdk";
import {
  getCountSubtitles,
  getSubtitlesJoinProvider,
} from "../../db/queries.js";
import { isExpired } from "../../utils/cache.js";
import { languageNameFromIso639 } from "../../utils/language.js";

export type SubtitleRow = NonNullable<
  Awaited<ReturnType<typeof getSubtitlesJoinProvider>>
>[number];

/**
 * DB row → Stremio track. lang is unique per (content, season, episode) in
 * the schema; per-track ids keep clients from collapsing the list. The raw
 * upstream url is kept — buildSubtitleHandler renders the /subtitle/ proxy
 * url against the requesting client's origin so players receive text/vtt
 * instead of the CDN's application/octet-stream.
 */
export function toSubtitle(
  providerContentId: string,
  row: SubtitleRow,
): Subtitle | undefined {
  if (isExpired(row.subtitle.updatedAt, row.subtitle.ttl)) {
    return undefined;
  }
  return {
    id: `${providerContentId}:${row.subtitle.lang}`,
    label:
      languageNameFromIso639(row.subtitle.lang) ||
      row.provider_content.provider,
    lang: row.subtitle.lang,
    url: row.subtitle.url,
  };
}

class SubtitleService {
  static async getSubtitlesFromDb(
    id: string,
    season: number,
    episode: number,
  ): Promise<Subtitle[]> {
    const subtitlesAndProvider = await getSubtitlesJoinProvider(
      id,
      season ?? 1,
      episode ?? 1,
    );
    if (subtitlesAndProvider && subtitlesAndProvider.length > 0) {
      return subtitlesAndProvider
        .map((row) => toSubtitle(id, row))
        .filter((subtitle) => subtitle !== undefined);
    }
    return [];
  }

  static async getTotalSubtitles() {
    const subtitles = await getCountSubtitles();
    return Number(subtitles[0]?.count ?? 0);
  }
}
export default SubtitleService;
