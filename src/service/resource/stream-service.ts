import { Stream } from "@stremio-addon/sdk";
import {
  getCountStream,
  getStreamsJoinProvider,
} from "../../db/queries.js";
import {
  extractSeason,
  formatStreamFilename,
  formatStreamTitle,
} from "../../utils/format.js";

class StreamService {
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
        const isExpired =
          stream.stream.updatedAt.getTime() + (stream.stream.ttl ?? 0) <
          Date.now();
        if (isExpired) {
          return;
        }
        season = extractSeason(stream.provider_content.title).season ?? 1;
        const { title, year } = stream.provider_content;
        const description = formatStreamTitle(title, year, season, episode);
        const filename = `${formatStreamFilename(title, year, season, episode)}-${provider}`;
        // Same key as the live path in kisskh.ts so auto-play grouping
        // survives a cache miss
        const bingeGroup = `${displayName}`;
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
