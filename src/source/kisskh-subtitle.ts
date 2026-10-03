import { AxiosRequestConfig } from "axios";
import { Buffer } from "buffer";
import * as crypto from "crypto";
import { axiosGet } from "../utils/axios.js";
import { cache } from "../utils/cache.js";
import { ENV } from "../utils/env.js";
import { Logger } from "../utils/logger.js";
import { getProxyUrl } from "../utils/proxy/proxy.js";

const logger = new Logger("SUB");

interface DecryptionKeys {
  [key: string]: {
    key: Buffer;
    iv: Buffer;
  };
}

const DECRYPT_KEYS: DecryptionKeys = {
  txt: {
    key: Buffer.from("8056483646328763"),
    iv: Buffer.from("6852612370185273"),
  },
  txt1: {
    key: Buffer.from("AmSmZVcH93UQUezi"),
    iv: Buffer.from("ReBKWW8cqdjPEnF6"),
  },
  default: {
    key: Buffer.from("sWODXX04QRTkHdlZ"),
    iv: Buffer.from("8pwhapJeC4hrS9hO"),
  },
};
function isEncrypted(line: string) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(line.trim()) && line.length > 4;
}

function decrypt(data: string, key: Buffer, iv: Buffer): string {
  const normalizedData = data
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/^"|"$/g, "");
  const lines = normalizedData.split(/\r?\n/);
  const decryptedLines = lines
    .map((line) => {
      if (isEncrypted(line)) {
        try {
          const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
          let decryptedLine = decipher.update(line, "base64", "utf8");
          decryptedLine += decipher.final("utf8");
          return decryptedLine;
        } catch (error) {
          logger.warn(`Fail to decrypt | ${line}`);
          return line;
        }
      }
      return line;
    })
    .join("\n");
  return decryptedLines;
}

function getKeyForFormat(format: string): { key: Buffer; iv: Buffer } {
  return (DECRYPT_KEYS[format] || DECRYPT_KEYS.default) as {
    key: Buffer;
    iv: Buffer;
  };
}

function detectFormat(url: string): string {
  const lowerUrl = url.split("?")[0]?.toLowerCase() || url.toLowerCase();
  if (lowerUrl.endsWith(".txt1")) {
    return "txt1";
  } else if (lowerUrl.endsWith(".txt")) {
    return "txt";
  }
  return "default";
}

// SRT timestamps separate milliseconds with a comma; WebVTT requires a dot
const SRT_TIMESTAMP = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;

/**
 * Normalize subtitle text to WebVTT. The kisskh CDN serves .srt files as
 * application/octet-stream, which strict players (Stremio on TV) refuse to
 * render — every track is converted before it reaches a client.
 */
export function srtToVtt(source: string): string {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Already WebVTT (some decrypted .txt payloads): only normalize newlines
  if (normalized.startsWith("WEBVTT")) {
    return normalized;
  }
  return `WEBVTT\n\n${normalized.replace(SRT_TIMESTAMP, "$1.$2")}`;
}

// Subtitle text is immutable per URL — a long TTL is safe
const VTT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const vttInFlight = new Map<string, Promise<string | null>>();

/**
 * Fetch a subtitle from its source URL and return it as WebVTT, decrypted
 * first when it is one of kisskh's encrypted .txt payloads. Results are
 * cached and concurrent callers share one upstream fetch.
 */
export async function getSubtitleVtt(
  subtitleUrl: string,
): Promise<string | null> {
  const vttKey = `subtitle_vtt:${subtitleUrl}`;

  const cached = cache.get(vttKey);
  if (cached !== null) {
    return cached;
  }
  const pending = vttInFlight.get(subtitleUrl);
  if (pending) return pending;

  const request = (async (): Promise<string | null> => {
    try {
      const config: AxiosRequestConfig = {
        responseType: "text",
        timeout: 20000,
      };
      let subtitleData = await axiosGet<string>(subtitleUrl, config);
      if (!subtitleData) {
        subtitleData = await axiosGet<string>(
          getProxyUrl(subtitleUrl),
          config,
        );
      }
      if (!subtitleData) return null;
      const format = detectFormat(subtitleUrl);
      let text = subtitleData;
      if (format !== "default") {
        const { key, iv } = getKeyForFormat(format);
        text = decrypt(subtitleData, key, iv);
      }
      logger.log(`Subtitle → VTT | ${subtitleUrl}`);
      const vtt = srtToVtt(text);
      cache.set(vttKey, vtt, VTT_CACHE_TTL_MS, vtt.length * 2);
      return vtt;
    } catch (error: any) {
      logger.error(`Failed to prepare subtitle | ${error.message}`);
      return null;
    }
  })().finally(() => {
    vttInFlight.delete(subtitleUrl);
  });

  vttInFlight.set(subtitleUrl, request);
  return request;
}
