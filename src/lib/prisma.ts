import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * True when `DATABASE_URL` points at a Neon endpoint.
 *
 * Neon's serverless driver speaks a WebSocket protocol that only its own
 * endpoints understand, so it cannot be the unconditional choice: a plain
 * PostgreSQL server — which is what every contributor runs locally — simply
 * fails to connect. `DATABASE_DRIVER` overrides the sniff for the cases the
 * host name cannot settle (a proxy in front of Neon, or a local Neon proxy).
 */
function isNeonConnection(connectionString: string): boolean {
  const override = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (override === "neon") return true;
  if (override === "pg" || override === "postgres") return false;
  return /\.neon\.tech|neon\.build|\bneon\b.*\.aws/i.test(connectionString);
}

/**
 * Builds the Prisma client with the right driver adapter for this database.
 *
 * On Neon the serverless WebSocket driver avoids a TCP+TLS handshake per
 * serverless invocation and multiplexes over one connection, which is a large
 * win in production. Everywhere else the standard `pg` pool is both correct and
 * faster, since a long-lived process pays the handshake once.
 *
 * Both adapters are required lazily so the unused driver is never loaded.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  const log: Array<"error" | "warn"> =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (isNeonConnection(connectionString)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { neonConfig } = require("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaNeon } = require("@prisma/adapter-neon");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require("ws");

    // Node 18/20 have no global WebSocket, which Neon's driver needs.
    neonConfig.webSocketConstructor = ws;
    return new PrismaClient({ adapter: new PrismaNeon({ connectionString }), log });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), log });
}

/**
 * Lazily constructed, so importing this module never touches the environment.
 *
 * Building the client eagerly meant any file transitively importing it threw
 * when DATABASE_URL was unset — which broke `--help` on the CLI scripts, and
 * anything else that only wanted the types or a dry run. The proxy defers
 * construction to the first actual property access.
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient() as object, property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getClient() as object, property);
  },
});
