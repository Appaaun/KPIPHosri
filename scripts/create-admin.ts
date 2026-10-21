import { db } from '@kpi/db';
import argon2 from 'argon2';
import { z } from 'zod';
async function main() {
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const password = z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD);
  const username = z
    .string()
    .regex(/^[a-z0-9._-]{3,60}$/)
    .parse(process.env.ADMIN_USERNAME ?? 'administrator');
  await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        username,
        displayName: 'System administrator',
        passwordHash: await argon2.hash(password),
        role: 'SUPER_ADMIN',
      },
    });
    await tx.auditLog.create({
      data: {
        actorRole: 'SYSTEM_BOOTSTRAP',
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: u.id,
      },
    });
  });
  console.log('Administrator created. No password was logged.');
}
main().finally(() => db.$disconnect());
