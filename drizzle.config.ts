import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle/lumix",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/lumix.db",
  },
});
