import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "../../data/gpt-image-canvas.sqlite"
  }
});
