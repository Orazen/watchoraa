import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function seed() {
  console.log('Seeding users...');

  const users = [
    {
      email: 'admin@watchora.app',
      password: 'AdminPass123!',
      fullName: 'Admin User',
      role: 'ADMIN' as const,
      preferredLanguage: 'en',
    },
    {
      email: 'user@watchora.app',
      password: 'UserPass123!',
      fullName: 'Suhasita Rani',
      role: 'BLIND_USER' as const,
      preferredLanguage: 'en',
    },
    {
      email: 'caregiver@watchora.app',
      password: 'CarePass123!',
      fullName: 'Caregiver User',
      role: 'CAREGIVER' as const,
      preferredLanguage: 'en',
    },
  ];

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    const existing = await prisma.user.findUnique({ where: { email: u.email } });

    if (existing) {
      const updated = await prisma.user.update({
        where: { email: u.email },
        data: {
          passwordHash,
          fullName: u.fullName,
          role: u.role,
          isActive: true,
        },
      });
      console.log(`Updated user: ${updated.email} (${updated.role})`);
    } else {
      const created = await prisma.user.create({
        data: {
          email: u.email,
          passwordHash,
          fullName: u.fullName,
          role: u.role,
          preferredLanguage: u.preferredLanguage,
          isActive: true,
          preferences: {
            create: {
              speechRate: 1.0,
              vibrationEnabled: true,
              audioEnabled: true,
              instructionDetail: 2,
            },
          },
        },
      });
      console.log(`Created user: ${created.email} (${created.role})`);
    }
  }

  console.log('\n--- Seed Complete ---');
  console.log('Admin Account:');
  console.log('  Email:    admin@watchora.app');
  console.log('  Password: AdminPass123!');
  console.log('  Role:     ADMIN\n');
  console.log('Normal User Account:');
  console.log('  Email:    user@watchora.app');
  console.log('  Password: UserPass123!');
  console.log('  Role:     BLIND_USER\n');
  console.log('Caregiver Account:');
  console.log('  Email:    caregiver@watchora.app');
  console.log('  Password: CarePass123!');
  console.log('  Role:     CAREGIVER\n');
}

seed()
  .catch((err) => {
    console.error('Error during seeding:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
