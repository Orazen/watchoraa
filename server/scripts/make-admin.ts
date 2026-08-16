import { prisma } from '../src/lib/prisma.js';

const email = process.argv[2];

if (!email) {
  console.error('Usage: npx tsx scripts/make-admin.ts <email>');
  process.exit(1);
}

const user = await prisma.user.update({
  where: { email },
  data: { role: 'ADMIN' },
});

console.log(`${user.email} is now an ADMIN.`);
await prisma.$disconnect();
