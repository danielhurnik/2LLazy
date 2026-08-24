import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

async function main() {
  const p = new PrismaClient();
  const email = "demo@2llazy.local";
  const hash = bcrypt.hashSync("testpass123", 10);
  await p.user.upsert({ where: { email }, update: { password: hash }, create: { email, name: "Demo", password: hash } });
  const u = await p.user.findUniqueOrThrow({ where: { email } });
  await p.userProfile.upsert({ where: { userId: u.id }, update: { country: "CZ" }, create: { userId: u.id, name: "Demo", email, country: "CZ" } });
  console.log("seeded user", u.id);
  await p.$disconnect();
}
main();
