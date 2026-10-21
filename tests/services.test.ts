import { it, expect, vi, beforeEach } from 'vitest';
const fake = vi.hoisted(() => ({
  kpiDefinition: { findUnique: vi.fn() },
  kpiSubmission: { findUnique: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@kpi/db', async () => ({ db: fake, Prisma: {} }));
import { transition, validateCsv, saveSubmission, getKpi } from '../apps/web/lib/services';
const admin = { id: 'reviewer', role: 'DEPARTMENT_ADMIN' as const, departmentId: 'PHARMACY' };
const k = {
  id: 'pharm-kpi',
  departmentId: 'PHARMACY',
  calculationMode: 'PERCENTAGE',
  decimalPlaces: 2,
  targetType: 'GTE',
  targetValue: 90,
  active: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  fake.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.kpiDefinition.findUnique.mockResolvedValue(k);
  fake.kpiSubmission.findUnique.mockResolvedValue({
    id: 's',
    kpi: k,
    kpiId: k.id,
    authorId: 'author',
    state: 'SUBMITTED',
    version: 0,
  });
  fake.kpiSubmission.updateMany.mockResolvedValue({ count: 1 });
});
it('requires rejection reason and does not write', async () => {
  await expect(transition(admin, 's', 'reject', ' ')).rejects.toMatchObject({ status: 400 });
  expect(fake.kpiSubmission.updateMany).not.toHaveBeenCalled();
});
it('records a reason and audited rejection', async () => {
  await expect(transition(admin, 's', 'reject', 'incorrect source')).resolves.toEqual({
    state: 'REJECTED',
  });
  expect(fake.auditLog.create).toHaveBeenCalled();
});
it.each(['submit', 'approve', 'reject'] as const)(
  'blocks foreign department %s',
  async (action) => {
    fake.kpiSubmission.findUnique.mockResolvedValue({
      id: 's',
      kpi: { ...k, departmentId: 'NURSING' },
      authorId: 'author',
      state: 'SUBMITTED',
      version: 0,
    });
    await expect(transition(admin, 's', action, 'reason')).rejects.toMatchObject({ status: 403 });
    expect(fake.kpiSubmission.updateMany).not.toHaveBeenCalled();
  },
);
it('blocks known foreign KPI detail', async () => {
  fake.kpiDefinition.findUnique.mockResolvedValue({ ...k, departmentId: 'NURSING' });
  await expect(getKpi(admin, 'known-id')).rejects.toMatchObject({ status: 403 });
});
it('blocks creating a foreign result through submission', async () => {
  fake.kpiDefinition.findUnique.mockResolvedValue({ ...k, departmentId: 'NURSING' });
  await expect(
    saveSubmission(admin, {
      kpiId: 'known-id',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      numerator: 9,
      denominator: 10,
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('rejects concurrent transitions', async () => {
  fake.kpiSubmission.updateMany.mockResolvedValue({ count: 0 });
  await expect(transition(admin, 's', 'reject', 'reason')).rejects.toMatchObject({ status: 409 });
});
it('CSV preview validates date, numbers, and department without writes', async () => {
  const header = 'kpi_code,period_start,period_end,numerator,denominator,value,note\n';
  let r = await validateCsv(
    { ...admin, role: 'DATA_ENTRY' },
    header + 'TEST,2026-01-01,2026-01-31,9,10,,demo',
  );
  expect(r[0].value).toBe(90);
  r = await validateCsv(admin, header + 'TEST,2026-01-01,2026-01-31,-9,10,,demo');
  expect(r[0].error).toBeTruthy();
  fake.kpiDefinition.findUnique.mockResolvedValue({ ...k, departmentId: 'NURSING' });
  r = await validateCsv(admin, header + 'TEST,2026-01-01,2026-01-31,9,10,,demo');
  expect(r[0].error).toBeTruthy();
  expect(fake.kpiSubmission.updateMany).not.toHaveBeenCalled();
});

it('malformed CSV returns a validation error', async () => {
  await expect(validateCsv(admin, 'kpi_code,note\nTEST,"unterminated')).rejects.toMatchObject({
    status: 400,
  });
});
