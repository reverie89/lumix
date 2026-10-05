import { Stream } from "@stremio-addon/sdk";
import {
  getCountStream,
  getStreamsJoinProvider,
} from "../../db/queries.js";
import { isExpired } from "../../utils/cache.js";
import { RATE_LIMIT_DESCRIPTION } from "../../utils/constant.js";
import {
  extractSeason,
  formatStreamFilename,
  formatStreamTitle,
} from "../../utils/format.js";

class StreamService {
  /**
   * Placeholder row for a rate-limited provider: no url (it can't play),
   * just a retryable entry grouped under the provider's bingeGroup.
   */
  static rateLimitPlaceholder(displayName: string, name: string): Stream {
    return {
      name: displayName,
      description: RATE_LIMIT_DESCRIPTION,
      behaviorHints: {
        notWebReady: true,
        bingeGroup: displayName,
        filename: `${RATE_LIMIT_DESCRIPTION}-${name}`,
      },
    };
  }

  static async getDbStreams(
    id: string,
    season: number,
    episode: number,
    displayName: string,
  ): Promise<Stream[]> {
    const streamsAndProvider = await getStreamsJoinProvider(
      id,
      season ?? 1,
      episode ?? 1,
    );
    if (streamsAndProvider && streamsAndProvider.length > 0) {
      const streams = streamsAndProvider.map((stream) => {
        const url = stream.stream.url;
        const provider = stream.provider_content.provider;
        if (isExpired(stream.stream.updatedAt, stream.stream.ttl)) {
          return;
        }
        season = extractSeason(stream.provider_content.title).season ?? 1;
        const { title, year } = stream.provider_content;
        const description = formatStreamTitle(title, year, season, episode);
        const filename = `${formatStreamFilename(title, year, season, episode)}-${provider}`;
        // Same key as the live path in BaseProvider.buildStream so
        // auto-play grouping survives a cache miss
        const bingeGroup = displayName;
        return {
          url,
          name: displayName,
          description,
          behaviorHints: {
            notWebReady: true,
            bingeGroup,
            filename,
          },
        };
      });
      return streams.filter((stream) => stream !== undefined);
    }
    return [];
  }

  static async getTotalStreams() {
    const streams = await getCountStream();
    return Number(streams[0]?.count ?? 0);
  }
}

export default StreamService;
