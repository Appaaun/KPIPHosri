import { db, Prisma } from '@kpi/db';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { calculate, evaluate } from '@kpi/kpi-engine';
import {
  type Actor,
  HttpError,
  scope,
  departmentAccess,
  roleAccess,
  manageKpi,
  submitAccess,
  approveAccess,
  submissionSchema,
  kpiSchema,
  roles,
} from '@kpi/shared';
import argon2 from 'argon2';
type Tx = Prisma.TransactionClient;
export async function audit(
  tx: Tx,
  a: Actor,
  action: string,
  entityType: string,
  entityId: string,
  departmentId: string | null,
  after?: Prisma.InputJsonValue,
  before?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: a.id,
      actorRole: a.role,
      departmentId,
      action,
      entityType,
      entityId,
      after,
      before,
    },
  });
}
export async function getKpi(a: Actor, id: string) {
  const k = await db.kpiDefinition.findUnique({ where: { id }, include: { department: true } });
  if (!k) throw new HttpError(404, 'ไม่พบตัวชี้วัด');
  departmentAccess(a, k.departmentId);
  return k;
}
export async function listKpis(a: Actor, query: URLSearchParams) {
  const requested = query.get('departmentId');
  if (requested) departmentAccess(a, requested);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(query.get('page'))) || 1));
  const search = (query.get('search') ?? '').slice(0, 100);
  const where = {
    ...scope(a),
    ...(requested ? { departmentId: requested } : {}),
    OR: [
      { nameTh: { contains: search, mode: 'insensitive' as const } },
      { code: { contains: search, mode: 'insensitive' as const } },
    ],
  };
  const [items, total] = await Promise.all([
    db.kpiDefinition.findMany({
      where,
      include: { department: true },
      orderBy: { code: query.get('sort') === 'desc' ? 'desc' : 'asc' },
      skip: (page - 1) * 25,
      take: 25,
    }),
    db.kpiDefinition.count({ where }),
  ]);
  return { items, total, page };
}
export async function saveKpi(a: Actor, input: unknown, id?: string) {
  const data = kpiSchema.parse(input);
  manageKpi(a, data.departmentId);
  if (id) {
    const old = await getKpi(a, id);
    manageKpi(a, old.departmentId);
    if (old.departmentId !== data.departmentId)
      throw new HttpError(400, 'ไม่สามารถย้ายกลุ่มงานของตัวชี้วัด');
  }
  const department = await db.department.findUnique({ where: { id: data.departmentId } });
  if (!department?.active) throw new HttpError(400, 'กลุ่มงานไม่พร้อมใช้งาน');
  if (data.dataSourceId && !(await db.dataSource.findUnique({ where: { id: data.dataSourceId } })))
    throw new HttpError(400, 'ไม่พบแหล่งข้อมูล');
  return db.$transaction(async (tx) => {
    const before = id ? await tx.kpiDefinition.findUnique({ where: { id } }) : null;
    const k = id
      ? await tx.kpiDefinition.update({ where: { id }, data })
      : await tx.kpiDefinition.create({ data });
    await tx.kpiTarget
      .create({
        data: {
          kpiId: k.id,
          effectiveFrom: new Date(),
          targetType: k.targetType,
          targetValue: k.targetValue,
          targetMin: k.targetMin,
          targetMax: k.targetMax,
          warningThreshold: k.warningThreshold,
          warningMin: k.warningMin,
          warningMax: k.warningMax,
        },
      })
      .catch(async (e) => {
        throw e;
      });
    await audit(
      tx,
      a,
      id ? (k.active ? 'KPI_UPDATED' : 'KPI_DISABLED') : 'KPI_CREATED',
      'KpiDefinition',
      k.id,
      k.departmentId,
      JSON.parse(JSON.stringify(k)),
      before ? JSON.parse(JSON.stringify(before)) : undefined,
    );
    return k;
  });
}
export async function saveSubmission(a: Actor, input: unknown, id?: string) {
  const data = submissionSchema.parse(input);
  const k = await getKpi(a, data.kpiId);
  submitAccess(a, k.departmentId);
  if (!k.active) throw new HttpError(400, 'ตัวชี้วัดไม่พร้อมใช้งาน');
  if (k.calculationMode === 'CUSTOM') throw new HttpError(400, 'ยังไม่รองรับสูตรกำหนดเอง');
  if (k.calculationMode === 'DIRECT_VALUE' && data.value == null)
    throw new HttpError(400, 'กรุณาระบุค่า');
  if (k.calculationMode !== 'DIRECT_VALUE' && (data.numerator == null || data.denominator == null))
    throw new HttpError(400, 'กรุณาระบุตัวตั้งและตัวหาร');
  const value = calculate(k, data);
  return db.$transaction(async (tx) => {
    if (id) {
      const old = await tx.kpiSubmission.findUnique({ where: { id } });
      if (!old || old.authorId !== a.id || old.kpiId !== k.id)
        throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไข');
      const changed = await tx.kpiSubmission.updateMany({
        where: { id, state: 'DRAFT', version: old.version },
        data: {
          ...data,
          value,
          periodStart: new Date(data.periodStart),
          periodEnd: new Date(data.periodEnd),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new HttpError(409, 'แก้ไขได้เฉพาะฉบับร่าง');
      await audit(tx, a, 'SUBMISSION_EDITED', 'KpiSubmission', id, k.departmentId);
      return tx.kpiSubmission.findUniqueOrThrow({ where: { id } });
    }
    const s = await tx.kpiSubmission.create({
      data: {
        ...data,
        value,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        authorId: a.id,
      },
    });
    await audit(tx, a, 'SUBMISSION_CREATED', 'KpiSubmission', s.id, k.departmentId);
    return s;
  });
}
export async function transition(
  a: Actor,
  id: string,
  action: 'submit' | 'approve' | 'reject',
  reason?: string,
) {
  return db.$transaction(async (tx) => {
    const s = await tx.kpiSubmission.findUnique({ where: { id }, include: { kpi: true } });
    if (!s) throw new HttpError(404, 'ไม่พบข้อมูล');
    departmentAccess(a, s.kpi.departmentId);
    if (action === 'submit') {
      submitAccess(a, s.kpi.departmentId);
      if (a.id !== s.authorId || s.state !== 'DRAFT')
        throw new HttpError(409, 'ส่งได้เฉพาะฉบับร่างของตนเอง');
    } else {
      approveAccess(a, s.kpi.departmentId, s.authorId);
      if (s.state !== 'SUBMITTED') throw new HttpError(409, 'ข้อมูลไม่ได้รออนุมัติ');
      if (action === 'reject' && !reason?.trim())
        throw new HttpError(400, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    }
    const state =
      action === 'submit' ? 'SUBMITTED' : action === 'approve' ? 'APPROVED' : 'REJECTED';
    const updated = await tx.kpiSubmission.updateMany({
      where: { id, version: s.version, state: s.state },
      data: {
        state,
        version: { increment: 1 },
        ...(action !== 'submit'
          ? {
              reviewerId: a.id,
              reviewedAt: new Date(),
              rejectionReason: action === 'reject' ? reason?.slice(0, 2000) : null,
            }
          : {}),
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'ข้อมูลถูกเปลี่ยนแล้ว');
    if (action === 'approve') {
      const value = calculate(s.kpi, s);
      const status = evaluate(s.kpi, value);
      await tx.kpiResult.create({
        data: {
          kpiId: s.kpiId,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          numerator: s.numerator,
          denominator: s.denominator,
          value,
          status,
          submissionId: id,
          source: s.source,
          targetSnapshot: JSON.parse(JSON.stringify(s.kpi)),
        },
      });
      if (status === 'RED')
        await tx.alert.upsert({
          where: { key: `red:${s.kpiId}:${s.periodStart.toISOString()}` },
          create: {
            key: `red:${s.kpiId}:${s.periodStart.toISOString()}`,
            type: 'RED_KPI',
            severity: 'HIGH',
            departmentId: s.kpi.departmentId,
            kpiId: s.kpiId,
            message: `${s.kpi.code} ไม่ผ่านเป้าหมาย`,
          },
          update: { resolvedAt: null },
        });
    }
    await audit(
      tx,
      a,
      `SUBMISSION_${state}`,
      'KpiSubmission',
      id,
      s.kpi.departmentId,
      { state, reason: reason ?? null },
      { state: s.state },
    );
    return { state };
  });
}
export function parseCsv(text: string) {
  if (Buffer.byteLength(text) > 250000) throw new HttpError(400, 'ไฟล์ใหญ่เกินกำหนด');
  let rows: Record<string, string>[];
  try {
    rows = parse(text, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as Record<string, string>[];
  } catch {
    throw new HttpError(400, 'รูปแบบ CSV ไม่ถูกต้อง');
  }
  if (rows.length === 0 || rows.length > 500) throw new HttpError(400, 'อนุญาต 1–500 แถว');
  return rows;
}
export async function validateCsv(a: Actor, text: string) {
  roleAccess(a, ['SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY']);
  const rows = parseCsv(text);
  const items = [];
  for (const [index, row] of rows.entries()) {
    try {
      const k = await db.kpiDefinition.findUnique({ where: { code: row.kpi_code } });
      if (!k) throw new HttpError(400, 'ไม่พบรหัสตัวชี้วัด');
      submitAccess(a, k.departmentId);
      if (!k.active) throw new HttpError(400, 'ตัวชี้วัดไม่พร้อมใช้งาน');
      const n = (s: string) => (s == null || s === '' ? null : Number(s));
      const data = submissionSchema.parse({
        kpiId: k.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        numerator: n(row.numerator),
        denominator: n(row.denominator),
        value: n(row.value),
        note: row.note ?? '',
      });
      if (
        k.calculationMode === 'CUSTOM' ||
        (k.calculationMode === 'DIRECT_VALUE'
          ? data.value == null
          : data.numerator == null || data.denominator == null)
      )
        throw new HttpError(400, 'ข้อมูลสำหรับคำนวณไม่ครบ');
      items.push({ row: index + 2, data, value: calculate(k, data), error: null });
    } catch (e) {
      items.push({
        row: index + 2,
        data: null,
        value: null,
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? 'รูปแบบข้อมูลหรือวันที่ไม่ถูกต้อง'
              : 'ไม่สามารถตรวจสอบข้อมูลแถวนี้',
      });
    }
  }
  return items;
}
export async function importCsv(a: Actor, text: string) {
  const items = await validateCsv(a, text);
  if (items.some((i) => i.error)) throw new HttpError(400, 'กรุณาแก้ไขข้อผิดพลาดก่อนนำเข้า');
  return db.$transaction(async (tx) => {
    for (const item of items) {
      const d = item.data!;
      const s = await tx.kpiSubmission.create({
        data: {
          ...d,
          value: item.value,
          periodStart: new Date(d.periodStart),
          periodEnd: new Date(d.periodEnd),
          authorId: a.id,
          source: 'CSV_IMPORT',
        },
      });
      const k = await tx.kpiDefinition.findUniqueOrThrow({ where: { id: d.kpiId } });
      submitAccess(a, k.departmentId);
      await audit(tx, a, 'SUBMISSION_CREATED', 'KpiSubmission', s.id, k.departmentId);
    }
    await audit(tx, a, 'CSV_IMPORTED', 'Import', 'batch', a.departmentId, { count: items.length });
    return { count: items.length };
  });
}
const userSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  username: z.string().regex(/^[a-z0-9._-]{3,60}$/),
  displayName: z.string().min(2).max(100),
  role: z.enum(roles),
  departmentId: z.string().nullable(),
  isActive: z.boolean(),
  password: z.string().min(12).max(128).optional(),
});
export async function saveUser(a: Actor, input: unknown, id?: string) {
  roleAccess(a, ['SUPER_ADMIN']);
  const data = userSchema.parse(input);
  if (['DEPARTMENT_ADMIN', 'DATA_ENTRY', 'VIEWER'].includes(data.role) && !data.departmentId)
    throw new HttpError(400, 'กรุณาเลือกกลุ่มงาน');
  if (
    data.departmentId &&
    !(await db.department.findFirst({ where: { id: data.departmentId, active: true } }))
  )
    throw new HttpError(400, 'กลุ่มงานไม่พร้อมใช้งาน');
  if (!id && !data.password) throw new HttpError(400, 'กรุณาตั้งรหัสผ่าน');
  const { password, ...safe } = data;
  const hash = password ? await argon2.hash(password) : undefined;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(828811)`;
      if (id) {
        const old = await tx.user.findUniqueOrThrow({ where: { id } });
        if (
          old.role === 'SUPER_ADMIN' &&
          old.isActive &&
          (data.role !== 'SUPER_ADMIN' || !data.isActive) &&
          (await tx.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })) <= 1
        )
          throw new HttpError(409, 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งคน');
      }
      const select = {
        id: true,
        email: true,
        username: true,
        displayName: true,
        role: true,
        departmentId: true,
        isActive: true,
      } as const;
      const u = id
        ? await tx.user.update({
            where: { id },
            data: {
              ...safe,
              ...(hash ? { passwordHash: hash } : {}),
              sessionVersion: { increment: 1 },
            },
            select,
          })
        : await tx.user.create({ data: { ...safe, passwordHash: hash! }, select });
      await audit(
        tx,
        a,
        id ? (data.isActive ? 'USER_UPDATED' : 'USER_DISABLED') : 'USER_CREATED',
        'User',
        u.id,
        u.departmentId,
        u,
      );
      return u;
    },
    { isolationLevel: 'Serializable' },
  );
}
