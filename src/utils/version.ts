// The one place that reads package.json — everything else takes the
// constants. The import resolves to /app/package.json in the image
// (Dockerfile copies it next to dist/) and to the repo root in dev.
import pkg from "../../package.json" with { type: "json" };

export const APP_NAME = pkg.name;
export const APP_VERSION = pkg.version;
export const APP_DESCRIPTION = pkg.description;
