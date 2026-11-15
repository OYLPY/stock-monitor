import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./poc/sqlite/schema.ts",
  out: "./poc/sqlite/migrations",
  dbCredentials: { url: "file:./poc/sqlite/poc.db" },
});
