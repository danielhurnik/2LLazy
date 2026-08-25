import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Prisma client over a plain PostgreSQL connection.
 *
 * No hosted-database driver: this project runs on a PostgreSQL server you
 * control, whether that is a container next to the app, a package on the same
 * machine, or a server across the network. `pg` speaks to all of them.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. See docs/CONFIGURATION.md, or docs/SELF_HOSTING.md to bring a database up.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Lazily constructed, so importing this module never touches the environment.
 *
 * Building the client eagerly meant any file transitively importing it threw
 * when DATABASE_URL was unset — which broke `--help` on the CLI scripts, and
 * anything else that only wanted the types or a dry run.
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
