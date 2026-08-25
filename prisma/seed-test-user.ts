/**
 * Creates / updates the test user used by Playwright E2E tests.
 * Email: test@test.com  Password: testtest
 * Run: npx tsx prisma/seed-test-user.ts
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // TLS is opt-in through the connection string (`?sslmode=require`),
  // exactly like any other PostgreSQL client.
  ssl: /sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL ?? "")
    ? { rejectUnauthorized: false }
    : false,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const hash = await bcrypt.hash("testtest", 12);
  const user = await prisma.user.upsert({
    where: { email: "test@test.com" },
    update: { password: hash, name: "Test User" },
    create: {
      email: "test@test.com",
      name: "Test User",
      password: hash,
      emailVerified: new Date(),
    },
  });
  console.log(`✓ Test user ready: ${user.email} (id: ${user.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
