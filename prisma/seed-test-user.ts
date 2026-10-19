import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const TEST_USER = { email: "test@test.com", password: "testtest", name: "Test User" };
const BCRYPT_COST = 12;

const databaseUrl = process.env.DATABASE_URL;
const requiresTls = databaseUrl?.includes("neon.tech") ?? false;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: requiresTls ? { rejectUnauthorized: false } : false,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function upsertTestUser() {
  const credentials = {
    name: TEST_USER.name,
    password: await bcrypt.hash(TEST_USER.password, BCRYPT_COST),
  };
  const user = await prisma.user.upsert({
    where: { email: TEST_USER.email },
    update: credentials,
    create: { ...credentials, email: TEST_USER.email, emailVerified: new Date() },
  });
  console.log(`✓ Test user ready: ${user.email} (id: ${user.id})`);
}

upsertTestUser()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
