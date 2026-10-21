import { NextRequest, NextResponse } from 'next/server';
import { db, Prisma } from '@kpi/db';
import { HttpError, scope, roleAccess, departmentAccess, csvCell, roles } from '@kpi/shared';
import { z } from 'zod';
import cron from 'node-cron';
import { requireUser } from '../../../lib/auth';
import {
  getKpi,
  listKpis,
  saveKpi,
  saveSubmission,
  transition,
  validateCsv,
  importCsv,
  saveUser,
  audit,
} from '../../../lib/services';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function readJson(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'กรุณาระบุข้อมูล');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 300000) {
      await reader.cancel();
      throw new HttpError(413, 'ข้อมูลใหญ่เกินกำหนด');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handler(req: NextRequest, ctx: Context) {
  try {
    const { path } = await ctx.params;
    const [resource, id, action] = path;
    const method = req.method;
    if (resource === 'health' && method === 'GET') {
      await db.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: 'ok', version: '1.0.0' });
    }
    const a = await requireUser();
    if (method !== 'GET') {
      const origin = req.headers.get('origin');
      const expected = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
      if (origin !== expected) throw new HttpError(403, 'คำขอไม่ถูกต้อง');
      if (Number(req.headers.get('content-length') ?? 0) > 300000)
        throw new HttpError(413, 'ข้อมูลใหญ่เกินกำหนด');
    }
    const q = req.nextUrl.searchParams;
    if (resource === 'source-options') {
      roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN']);
      return NextResponse.json(
        await db.dataSource.findMany({ select: { id: true, name: true, type: true }, take: 100 }),
      );
    }
    if (resource === 'me') return NextResponse.json(a);
    if (resource === 'departments') {
      if (method === 'GET') {
        if (id) departmentAccess(a, id);
        return NextResponse.json(
          await db.department.findMany({
            where: id ? { id } : scope(a).departmentId ? { id: a.departmentId! } : {},
            orderBy: { sortOrder: 'asc' },
          }),
        );
      }
      roleAccess(a, ['SUPER_ADMIN']);
      const body = z
        .object({
          code: z.string().regex(/^[A-Z0-9_-]+$/),
          nameTh: z.string().min(2).max(200),
          nameEn: z.string().max(200).nullable().optional(),
          active: z.boolean(),
          sortOrder: z.number().int(),
        })
        .parse(await readJson(req));
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const d = id
            ? await tx.department.update({
                where: { id },
                data: {
                  nameTh: body.nameTh,
                  nameEn: body.nameEn,
                  active: body.active,
                  sortOrder: body.sortOrder,
                },
              })
            : await tx.department.create({ data: body });
          await audit(tx, a, 'DEPARTMENT_UPDATED', 'Department', d.id, d.id);
          return d;
        }),
      );
    }
    if (resource === 'kpis') {
      if (method === 'GET') {
        if (!id) return NextResponse.json(await listKpis(a, q));
        const k = await getKpi(a, id);
        return NextResponse.json({
          ...k,
          results: await db.kpiResult.findMany({
            where: { kpiId: id },
            orderBy: { periodStart: 'desc' },
            take: 24,
          }),
        });
      }
      return NextResponse.json(await saveKpi(a, await readJson(req), id));
    }
    if (resource === 'submissions') {
      if (method === 'GET') {
        roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY']);
        return NextResponse.json(
          await db.kpiSubmission.findMany({
            where: {
              kpi: scope(a),
              ...(a.role === 'DATA_ENTRY' ? { authorId: a.id } : {}),
              ...(id ? { id } : {}),
            },
            include: {
              kpi: { select: { code: true, nameTh: true, departmentId: true } },
              author: { select: { displayName: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
        );
      }
      if (action) {
        if (!['submit', 'approve', 'reject'].includes(action))
          throw new HttpError(404, 'ไม่พบคำสั่ง');
        const body = z
          .object({ reason: z.string().max(2000).optional() })
          .parse(await readJson(req));
        return NextResponse.json(
          await transition(a, id, action as 'submit' | 'approve' | 'reject', body.reason),
        );
      }
      return NextResponse.json(await saveSubmission(a, await readJson(req), id));
    }
    if (resource === 'dashboard' || resource === 'export') {
      const departmentId = q.get('departmentId');
      if (departmentId) departmentAccess(a, departmentId);
      const period = q.get('period') ?? new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new HttpError(400, 'รอบข้อมูลไม่ถูกต้อง');
      const start = new Date(period + '-01T00:00:00Z');
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const sync = await db.dataSource.findMany({
        where: { kpis: { some: { ...scope(a) } } },
        select: {
          id: true,
          name: true,
          type: true,
          enabled: true,
          lastSyncAt: true,
          staleAfterMinutes: true,
        },
      });
      const definitions = await db.kpiDefinition.findMany({
        where: { ...scope(a), ...(departmentId ? { departmentId } : {}), active: true },
        include: {
          department: true,
          results: {
            where: {
              periodStart: {
                lt: end,
                gte: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 11, 1)),
              },
            },
            orderBy: { periodStart: 'desc' },
            take: 12,
          },
        },
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
        take: 1000,
      });
      const items = definitions.map((k) => {
        const current = k.results.find((r) => r.periodStart >= start && r.periodStart < end);
        const previous = k.results.find((r) => r.periodStart < start);
        return {
          ...k,
          current: current ?? null,
          previous: previous ?? null,
          status: current?.status ?? 'NO_DATA',
        };
      });
      const filtered = items.filter(
        (k) =>
          (!q.get('search') ||
            `${k.code} ${k.nameTh}`.toLowerCase().includes(q.get('search')!.toLowerCase())) &&
          (!q.get('status') || k.status === q.get('status')),
      );
      filtered.sort((a, b) =>
        q.get('sort') === 'desc' ? b.code.localeCompare(a.code) : a.code.localeCompare(b.code),
      );
      if (resource === 'export') {
        const rows = [
          ['code', 'name', 'department', 'period', 'value', 'status'],
          ...filtered.map((k) => [
            k.code,
            k.nameTh,
            k.department.nameTh,
            period,
            k.current?.value ?? '',
            k.status,
          ]),
        ];
        return new NextResponse(
          '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
          {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename=kpi-report.csv',
            },
          },
        );
      }
      const counts = { GREEN: 0, YELLOW: 0, RED: 0, NO_DATA: 0 };
      items.forEach((k) => counts[k.status as keyof typeof counts]++);
      const page = Math.max(1, Math.min(10000, Math.floor(Number(q.get('page'))) || 1));
      return NextResponse.json({
        sync,
        items: filtered.slice((page - 1) * 25, page * 25),
        total: filtered.length,
        page,
        counts,
        achievement: items.length ? Math.round((counts.GREEN / items.length) * 100) : 0,
        departments: Array.from(new Set(items.map((i) => i.departmentId))).map((id) => {
          const rows = items.filter((k) => k.departmentId === id);
          return {
            id,
            name: rows[0].department.nameTh,
            total: rows.length,
            green: rows.filter((k) => k.status === 'GREEN').length,
          };
        }),
        trend: Array.from({ length: 12 }, (_, i) => {
          const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 11 + i, 1));
          const key = date.toISOString().slice(0, 7);
          const values = items.flatMap((k) =>
            k.results.filter((r) => r.periodStart.toISOString().startsWith(key)),
          );
          return {
            period: key,
            achievement: values.length
              ? Math.round(
                  (values.filter((r) => r.status === 'GREEN').length / values.length) * 100,
                )
              : null,
          };
        }),
        lastUpdated: items.reduce<string | null>(
          (v, k) =>
            k.current && (!v || k.current.updatedAt.toISOString() > v)
              ? k.current.updatedAt.toISOString()
              : v,
          null,
        ),
        synthetic: items.some((k) => k.current?.synthetic),
      });
    }
    if (resource === 'csv') {
      roleAccess(a, ['SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY']);
      if (method === 'GET')
        return new NextResponse(
          'kpi_code,period_start,period_end,numerator,denominator,value,note\n',
          {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename=kpi-template.csv',
            },
          },
        );
      const { text, confirm } = z
        .object({ text: z.string().max(250000), confirm: z.boolean().default(false) })
        .parse(await readJson(req));
      return NextResponse.json(confirm ? await importCsv(a, text) : await validateCsv(a, text));
    }
    if (resource === 'users') {
      roleAccess(a, ['SUPER_ADMIN']);
      if (method === 'GET')
        return NextResponse.json(
          await db.user.findMany({
            where: {
              ...(q.get('role') ? { role: z.enum(roles).parse(q.get('role')) } : {}),
              ...(q.get('search')
                ? {
                    OR: ['displayName', 'email', 'username'].map((field) => ({
                      [field]: {
                        contains: q.get('search')!.slice(0, 100),
                        mode: 'insensitive' as const,
                      },
                    })),
                  }
                : {}),
            },
            select: {
              id: true,
              email: true,
              username: true,
              displayName: true,
              role: true,
              departmentId: true,
              isActive: true,
            },
            take: 100,
            orderBy: { username: 'asc' },
          }),
        );
      return NextResponse.json(await saveUser(a, await readJson(req), id));
    }
    if (resource === 'sources') {
      roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN']);
      if (method === 'GET')
        return NextResponse.json(
          await db.dataSource.findMany({
            include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
          }),
        );
      roleAccess(a, ['SUPER_ADMIN']);
      const data = z
        .object({
          name: z.string().min(2).max(100),
          type: z.enum(['MANUAL', 'CSV', 'MOCK', 'HIMPRO', 'OTHER_DATABASE']),
          enabled: z.boolean(),
          schedule: z.string().min(1).max(60),
          staleAfterMinutes: z.number().int().min(5).max(43200),
        })
        .parse(await readJson(req));
      if (!cron.validate(data.schedule) || data.schedule.trim().split(/\s+/).length !== 5)
        throw new HttpError(400, 'ตาราง cron ไม่ถูกต้อง');
      if (data.type === 'HIMPRO' && data.enabled)
        throw new HttpError(400, 'ยังไม่ได้กำหนด schema HIMPRO');
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const source = id
            ? await tx.dataSource.update({ where: { id }, data })
            : await tx.dataSource.create({ data });
          await audit(tx, a, 'SETTINGS_CHANGED', 'DataSource', source.id, null);
          return source;
        }),
      );
    }
    if (resource === 'alerts') {
      if (method === 'GET')
        return NextResponse.json(
          await db.alert.findMany({
            where: { ...scope(a), resolvedAt: null },
            take: 100,
            orderBy: { createdAt: 'desc' },
          }),
        );
      roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN']);
      const alert = await db.alert.findUniqueOrThrow({ where: { id } });
      if (alert.departmentId) departmentAccess(a, alert.departmentId);
      else roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN']);
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const r = await tx.alert.update({
            where: { id },
            data: { resolvedAt: new Date(), resolvedBy: a.id },
          });
          await audit(tx, a, 'ALERT_RESOLVED', 'Alert', id, alert.departmentId);
          return r;
        }),
      );
    }
    if (resource === 'audit') {
      roleAccess(a, ['SUPER_ADMIN']);
      return NextResponse.json(
        await db.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          skip: Math.max(0, Math.min(10000, Math.floor(Number(q.get('page'))) || 1) - 1) * 100,
        }),
      );
    }
    if (resource === 'settings') {
      roleAccess(a, ['SUPER_ADMIN']);
      if (method === 'GET')
        return NextResponse.json(
          await db.organizationSettings.findUnique({ where: { id: 'organization' } }),
        );
      const data = z
        .object({
          name: z.string().min(2).max(200),
          timezone: z.string().refine((v) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }),
        })
        .parse(await readJson(req));
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const r = await tx.organizationSettings.upsert({
            where: { id: 'organization' },
            create: data,
            update: data,
          });
          await audit(
            tx,
            a,
            'SETTINGS_CHANGED',
            'OrganizationSettings',
            'organization',
            null,
            data,
          );
          return r;
        }),
      );
    }
    if (resource === 'system') {
      roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN']);
      await db.$queryRaw`SELECT 1`;
      return NextResponse.json({
        web: 'ok',
        database: 'ok',
        version: '1.0.0',
        heartbeat: await db.workerHeartbeat.findUnique({ where: { id: 'worker' } }),
        sources: await db.dataSource.findMany({
          include: { runs: { take: 5, orderBy: { startedAt: 'desc' } } },
        }),
      });
    }
    throw new HttpError(404, 'ไม่พบข้อมูล');
  } catch (e) {
    if (e instanceof SyntaxError)
      return NextResponse.json({ error: 'รูปแบบ JSON/CSV ไม่ถูกต้อง' }, { status: 400 });
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: 'ข้อมูลไม่ถูกต้อง',
          details: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2034'].includes(e.code))
        return NextResponse.json(
          { error: 'ข้อมูลซ้ำหรือถูกแก้ไขพร้อมกัน กรุณาตรวจสอบและลองใหม่' },
          { status: 409 },
        );
      if (e.code === 'P2025') return NextResponse.json({ error: 'ไม่พบข้อมูล' }, { status: 404 });
    }
    console.error('Request failed', { type: e instanceof Error ? e.name : 'Unknown' });
    return NextResponse.json({ error: 'ไม่สามารถดำเนินการได้' }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PATCH };
