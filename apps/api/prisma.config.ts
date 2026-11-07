import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't read .env by itself. Load the shared root .env if it exists.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No .env file: rely on real environment variables (CI, containers).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
