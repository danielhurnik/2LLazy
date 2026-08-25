/**
 * Applies the expression indexes that back lexical search.
 *
 * `prisma migrate deploy` creates them, but `prisma db push` cannot — Prisma's
 * schema language has no way to describe an expression index, so they live in
 * raw SQL. This script closes that gap for anyone who set their database up
 * with `db push` (which is also the route for a machine without pgvector
 * installed, since the older migrations still create that extension).
 *
 * Uses `pg` rather than shelling out to psql: psql rejects the `?schema=`
 * parameter Prisma puts in DATABASE_URL, and not every machine has psql at all.
 *
 *   npm run db:indexes
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const SQL_FILE = join(process.cwd(), "prisma/sql/search-indexes.sql");

/** Strips the Prisma-only parameters that libpq refuses to parse. */
function toLibpqUrl(raw: string): string {
  const url = new URL(raw);
  for (const param of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "connect_timeout", "socket_timeout"]) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const sql = readFileSync(SQL_FILE, "utf8");
  const client = new Client({ connectionString: toLibpqUrl(databaseUrl) });

  await client.connect();
  try {
    // One statement per notice is friendlier than a silent success.
    client.on("notice", (notice) => console.warn(`  ${notice.message}`));
    await client.query(sql);
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'JobPosting' AND indexname IN ('JobPosting_fulltext_idx', 'JobPosting_title_trgm_idx')
       ORDER BY indexname`,
    );
    console.log(`Search indexes present: ${rows.map((r) => r.indexname).join(", ") || "none"}`);
    if (rows.length < 2) {
      console.log("The trigram index is optional; without it, title matching uses sequential scans.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
