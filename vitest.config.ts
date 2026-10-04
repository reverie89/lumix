import { defineConfig } from "vitest/config";

import * as dotenv from "dotenv";
dotenv.config();
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      // Tests open an in-memory sqlite (NODE_ENV=test in sqlite.ts), so a
      // missing .env never fails an import and no db file is touched.
      // Small retry knobs so axios tests sleep milliseconds, not seconds
      RETRY_TIMEOUT_MS: "3000",
      RETRY_DELAY_MS: "30",
      RETRY_JITTER_MS: "0",
      // Synthetic mirror defaults: mirror assertions are written against the
      // constants, so tests stay deterministic regardless of the real .env
      // a developer runs with (dotenv loads it above)
      KISSKH_MIRRORS: "https://kisskh.test",
      OLE_HOSTS: "https://ole.test",
    },
    projects: [
      {
        test: {
          name: "util",
          include: ["./src/utils/*.test.ts"],
        },
      },
      {
        test: {
          name: "source",
          include: ["./src/source/*.test.ts"],
        },
      },
      {
        test: {
          name: "lib",
          include: ["./src/lib/*.test.ts"],
        },
      },
      {
        test: {
          name: "service",
          include: ["./src/service/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "api",
          include: ["./src/api/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "db",
          include: ["./src/db/**/*.test.ts"],
          // The db project exercises real sqlite (in-memory, see sqlite.ts)
        },
      },
    ],
  },
});
