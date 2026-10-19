import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

function loadEnvFilesWithLocalPrecedence() {
  loadEnv({ path: ".env.local" });
  loadEnv();
}

loadEnvFilesWithLocalPrecedence();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
