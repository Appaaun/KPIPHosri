import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { db } from '@kpi/db';
import { HttpError, type Actor } from '@kpi/shared';
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === 'production',
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Local',
      credentials: { username: { type: 'text' }, password: { type: 'password' } },
      async authorize(credentials) {
        const username = credentials?.username?.trim().toLowerCase();
        const password = credentials?.password;
        if (!username || !password || username.length > 200 || password.length > 256) return null;
        const key = createHash('sha256').update(username).digest('hex');
        const allowed = await db.$transaction(async (tx) => {
          const a = await tx.loginAttempt.upsert({
            where: { key },
            create: { key, attempts: 1 },
            update: { attempts: { increment: 1 } },
          });
          if (Date.now() - a.windowStart.getTime() > 900000) {
            await tx.loginAttempt.update({
              where: { key },
              data: { attempts: 1, windowStart: new Date() },
            });
            return true;
          }
          return a.attempts <= 10;
        });
        if (!allowed) return null;
        const user = await db.user.findFirst({
          where: { OR: [{ email: username }, { username }] },
        });
        // Constant-cost verification for unknown accounts.
        const hash = user?.passwordHash ?? (await argon2.hash('unusable-account-password'));
        const valid = await argon2.verify(hash, password).catch(() => false);
        if (!user || !valid || !user.isActive) return null;
        await db.$transaction([
          db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
          db.auditLog.create({
            data: {
              actorUserId: user.id,
              actorRole: user.role,
              departmentId: user.departmentId,
              action: 'LOGIN',
              entityType: 'User',
              entityId: user.id,
            },
          }),
        ]);
        return {
          id: user.id,
          name: user.displayName,
          email: user.email,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.version = (user as unknown as { sessionVersion: number }).sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        Object.assign(session.user, { id: token.id, version: token.version });
      }
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (typeof token?.id === 'string')
        await db.auditLog.create({
          data: {
            actorUserId: token.id,
            actorRole: 'SESSION',
            action: 'LOGOUT',
            entityType: 'User',
            entityId: token.id,
          },
        });
    },
  },
};
export async function requireUser(): Promise<Actor & { displayName: string }> {
  const session = await getServerSession(authOptions);
  const identity = session?.user as unknown as { id?: string; version?: number } | undefined;
  if (!identity?.id) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  const user = await db.user.findUnique({
    where: { id: identity.id },
    select: {
      id: true,
      role: true,
      departmentId: true,
      isActive: true,
      sessionVersion: true,
      displayName: true,
      department: { select: { active: true } },
    },
  });
  if (
    !user?.isActive ||
    user.sessionVersion !== identity.version ||
    (user.departmentId && !user.department?.active)
  )
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  return user;
}
