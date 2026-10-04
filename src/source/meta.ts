import { ContentType } from "@stremio-addon/sdk";

export interface ContentDetail extends ContentId {
  id: string;
  title: string;
  overview?: string;
  year: number;
  type: ContentType;
  season?: number;
  episode?: number;
  thumbnail?: string;
  background?: string;
  logo?: string;
}
export interface ContentId {
  imdbId?: string;
  tmdbId?: number;
  kisskhId?: string;
  oleId?: string;
}
