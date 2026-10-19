import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";

const isHostedNeonDatabase = (url: string | undefined) => url?.includes("neon.tech") ?? false;

function createPrismaClient(): PrismaClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isHostedNeonDatabase(databaseUrl) ? { rejectUnauthorized: false } : false,
  });
  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log: isDevelopment ? ["error", "warn"] : ["error"],
  });
}

const devHotReloadCache = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = devHotReloadCache.prisma ?? createPrismaClient();

if (!isProduction) {
  devHotReloadCache.prisma = prisma;
}
