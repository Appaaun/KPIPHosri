import { z } from 'zod';
export const roles = [
  'SUPER_ADMIN',
  'EXECUTIVE',
  'QUALITY_ADMIN',
  'DEPARTMENT_ADMIN',
  'DATA_ENTRY',
  'VIEWER',
] as const;
export type Actor = { id: string; role: (typeof roles)[number]; departmentId: string | null };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const globalRoles = ['SUPER_ADMIN', 'EXECUTIVE', 'QUALITY_ADMIN'];
export function scope(a: Actor) {
  if (globalRoles.includes(a.role)) return {};
  if (!a.departmentId) throw new HttpError(403, 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
  return { departmentId: a.departmentId };
}
export function departmentAccess(a: Actor, id: string) {
  const s = scope(a);
  if (s.departmentId && s.departmentId !== id)
    throw new HttpError(403, 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
}
export function roleAccess(a: Actor, allowed: readonly string[]) {
  if (!allowed.includes(a.role)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ดำเนินการ');
}
export function manageKpi(a: Actor, departmentId: string) {
  roleAccess(a, ['SUPER_ADMIN', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN']);
  departmentAccess(a, departmentId);
}
export function submitAccess(a: Actor, departmentId: string) {
  roleAccess(a, ['SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY']);
  departmentAccess(a, departmentId);
}
export function approveAccess(a: Actor, departmentId: string, authorId: string) {
  roleAccess(a, ['SUPER_ADMIN', 'DEPARTMENT_ADMIN']);
  departmentAccess(a, departmentId);
  if (a.id === authorId) throw new HttpError(403, 'ไม่สามารถอนุมัติข้อมูลของตนเอง');
}
const number = z.number().finite().nonnegative().nullable().optional();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'วันที่ไม่ถูกต้อง',
  );
export const submissionSchema = z
  .object({
    kpiId: z.string().min(1),
    periodStart: date,
    periodEnd: date,
    numerator: number,
    denominator: number,
    value: number,
    note: z.string().max(2000).default(''),
  })
  .refine((v) => v.periodEnd >= v.periodStart, 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น');
export const kpiSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9-]+$/)
      .max(60),
    nameTh: z.string().min(2).max(200),
    nameEn: z.string().max(200).optional(),
    description: z.string().max(2000).default(''),
    departmentId: z.string().min(1),
    unit: z.string().min(1).max(50),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
    calculationMode: z.enum(['DIRECT_VALUE', 'PERCENTAGE', 'RATE', 'RATIO']),
    targetType: z.enum(['GTE', 'LTE', 'BETWEEN']),
    targetValue: z.number().finite(),
    targetMin: number,
    targetMax: number,
    warningThreshold: number,
    warningMin: number,
    warningMax: number,
    decimalPlaces: z.number().int().min(0).max(6).default(2),
    rateMultiplier: z.number().positive().max(1000000).default(1000),
    dataSourceType: z.enum(['MANUAL', 'CSV_IMPORT', 'HIS', 'SYSTEM']).default('MANUAL'),
    dataSourceId: z.string().nullable().optional(),
    active: z.boolean().default(true),
    owner: z.string().max(100).default(''),
    displayOrder: z.number().int().default(0),
  })
  .superRefine((v, c) => {
    if (
      v.targetType === 'BETWEEN' &&
      (v.targetMin == null || v.targetMax == null || v.targetMin > v.targetMax)
    )
      c.addIssue({ code: 'custom', message: 'ช่วงเป้าหมายไม่ถูกต้อง', path: ['targetMin'] });
    if (
      v.warningThreshold != null &&
      ((v.targetType === 'GTE' && v.warningThreshold > v.targetValue) ||
        (v.targetType === 'LTE' && v.warningThreshold < v.targetValue))
    )
      c.addIssue({
        code: 'custom',
        message: 'ขอบเขตเฝ้าระวังไม่ถูกต้อง',
        path: ['warningThreshold'],
      });
    if (
      v.targetType === 'BETWEEN' &&
      ((v.warningMin != null && v.warningMin > (v.targetMin ?? 0)) ||
        (v.warningMax != null && v.warningMax < (v.targetMax ?? 0)))
    )
      c.addIssue({
        code: 'custom',
        message: 'ขอบเขตเฝ้าระวังไม่ครอบคลุมเป้าหมาย',
        path: ['warningMin'],
      });
  });
export const statusLabels = {
  GREEN: '✓ ผ่านเป้า',
  YELLOW: '△ เฝ้าระวัง',
  RED: '! ไม่ผ่านเป้า',
  NO_DATA: '— ไม่มีข้อมูล',
};
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}

export function formatTarget(input: {
  targetType: string;
  targetValue: number;
  targetMin?: number | null;
  targetMax?: number | null;
  unit?: string;
}): string {
  let label: string;
  if (input.targetType === 'BETWEEN') {
    if (!Number.isFinite(input.targetMin) || !Number.isFinite(input.targetMax)) return '—';
    label = `${input.targetMin}–${input.targetMax}`;
  } else {
    if (!['GTE', 'LTE'].includes(input.targetType) || !Number.isFinite(input.targetValue))
      return '—';
    label = `${input.targetType === 'GTE' ? '≥' : '≤'} ${input.targetValue}`;
  }
  return label + (input.unit ? ' ' + input.unit : '');
}
