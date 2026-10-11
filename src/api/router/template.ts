import crypto from "crypto";
import fs from "fs";
import path from "path";

const publicDir = path.join(process.cwd(), "public");

// Asset URLs are fingerprinted with a content hash: Cloudflare's edge
// caches /js and /css past the origin TTL, so a redeploy can pair fresh
// HTML with yesterday's landing.js and break the config page. Changing the
// URL on every content change orphans the stale edge entry.
export const assetHash = (relativePath: string): string => {
  try {
    return crypto
      .createHash("sha1")
      .update(fs.readFileSync(path.join(publicDir, relativePath)))
      .digest("hex")
      .slice(0, 10);
  } catch {
    return "0";
  }
};

// Read a page template from public/ and substitute its {{KEY}} placeholders
export function renderTemplate(
  fileName: string,
  replacements: Record<string, string>,
): string | null {
  const filePath = path.join(publicDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  let html = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  return html;
}
