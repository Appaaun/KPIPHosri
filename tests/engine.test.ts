import { describe, it, expect } from 'vitest';
import { calculate, evaluate, trend, round, type Definition } from '@kpi/kpi-engine';
import {
  departmentAccess,
  manageKpi,
  submitAccess,
  approveAccess,
  scope,
  submissionSchema,
  kpiSchema,
  csvCell,
  formatTarget,
  type Actor,
} from '@kpi/shared';
const def: Definition = {
  calculationMode: 'PERCENTAGE',
  targetType: 'GTE',
  targetValue: 90,
  warningThreshold: 85,
  decimalPlaces: 2,
};
describe('KPI engine', () => {
  it('calculates percentages and rounds', () =>
    expect(calculate(def, { numerator: 2, denominator: 3 })).toBe(66.67));
  it.each([0, -1, NaN, Infinity])('rejects invalid denominator %s', (denominator) =>
    expect(calculate(def, { numerator: 10, denominator })).toBeNull(),
  );
  it('handles direct values and nonfinite results', () => {
    expect(calculate({ ...def, calculationMode: 'DIRECT_VALUE' }, { value: 12.345 })).toBe(12.35);
    expect(calculate({ ...def, calculationMode: 'DIRECT_VALUE' }, { value: Infinity })).toBeNull();
    expect(calculate({ ...def, calculationMode: 'CUSTOM' }, { value: 1 })).toBeNull();
  });
  it('calculates configurable rates and ratios', () => {
    expect(
      calculate(
        { ...def, calculationMode: 'RATE', rateMultiplier: 1000 },
        { numerator: 2, denominator: 1000 },
      ),
    ).toBe(2);
    expect(calculate({ ...def, calculationMode: 'RATIO' }, { numerator: 1, denominator: 4 })).toBe(
      0.25,
    );
  });
  it.each([
    [90, 'GREEN'],
    [85, 'YELLOW'],
    [84, 'RED'],
    [null, 'NO_DATA'],
    [NaN, 'NO_DATA'],
    [Infinity, 'NO_DATA'],
  ])('evaluates GTE %s', (value, status) =>
    expect(evaluate(def, value as number | null)).toBe(status),
  );
  it.each([
    [2, 'GREEN'],
    [3, 'YELLOW'],
    [4, 'RED'],
  ])('evaluates LTE %s', (value, status) =>
    expect(
      evaluate({ ...def, targetType: 'LTE', targetValue: 2, warningThreshold: 3 }, value as number),
    ).toBe(status),
  );
  it.each([
    [10, 'GREEN'],
    [20, 'GREEN'],
    [9, 'YELLOW'],
    [21, 'YELLOW'],
    [8, 'RED'],
    [22, 'RED'],
  ])('evaluates BETWEEN %s', (value, status) =>
    expect(
      evaluate(
        {
          ...def,
          targetType: 'BETWEEN',
          targetMin: 10,
          targetMax: 20,
          warningMin: 9,
          warningMax: 21,
        },
        value as number,
      ),
    ).toBe(status),
  );
  it('has no implicit warning range', () =>
    expect(evaluate({ ...def, warningThreshold: null }, 89)).toBe('RED'));
  it('calculates trend safely', () => {
    expect(trend(3, 2)).toEqual({ delta: 1, direction: 'UP' });
    expect(trend(null, 2)).toBeNull();
    expect(round(1.23456, 3)).toBe(1.235);
  });
});
const actor = (role: Actor['role'], departmentId: string | null = 'PHARMACY'): Actor => ({
  id: 'user-a',
  role,
  departmentId,
});
describe('authorization acceptance', () => {
  for (const role of ['DATA_ENTRY', 'DEPARTMENT_ADMIN', 'VIEWER'] as const) {
    it(`${role} cannot read another department`, () =>
      expect(() => departmentAccess(actor(role), 'NURSING')).toThrow());
  }
  it('department admin cannot edit another department', () =>
    expect(() => manageKpi(actor('DEPARTMENT_ADMIN'), 'NURSING')).toThrow());
  it('viewer cannot submit', () =>
    expect(() => submitAccess(actor('VIEWER'), 'PHARMACY')).toThrow());
  it('data entry cannot approve', () =>
    expect(() => approveAccess(actor('DATA_ENTRY'), 'PHARMACY', 'other')).toThrow());
  it('executive cannot edit results', () =>
    expect(() => submitAccess(actor('EXECUTIVE', null), 'PHARMACY')).toThrow());
  it('super admin can administer', () =>
    expect(() => manageKpi(actor('SUPER_ADMIN', null), 'NURSING')).not.toThrow());
  it('disallows self approval even for admin', () =>
    expect(() => approveAccess(actor('SUPER_ADMIN', null), 'PHARMACY', 'user-a')).toThrow());
  it('fails closed without department', () => expect(() => scope(actor('VIEWER', null))).toThrow());
  it('allows department approval for another author', () =>
    expect(() => approveAccess(actor('DEPARTMENT_ADMIN'), 'PHARMACY', 'other')).not.toThrow());
});
describe('input safety', () => {
  const data = {
    kpiId: 'kpi',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    numerator: 1,
    denominator: 10,
  };
  it('validates date ranges and actual calendar dates', () => {
    expect(submissionSchema.safeParse(data).success).toBe(true);
    expect(submissionSchema.safeParse({ ...data, periodEnd: '2025-12-31' }).success).toBe(false);
    expect(submissionSchema.safeParse({ ...data, periodEnd: '2026-02-30' }).success).toBe(false);
  });
  it('rejects negatives and nonfinite inputs', () => {
    expect(submissionSchema.safeParse({ ...data, numerator: -1 }).success).toBe(false);
    expect(submissionSchema.safeParse({ ...data, value: Infinity }).success).toBe(false);
  });
  it('rejects inverted warning thresholds', () =>
    expect(
      kpiSchema.safeParse({
        code: 'TEST',
        nameTh: 'ทดสอบ',
        departmentId: 'PHARMACY',
        unit: '%',
        ...def,
        warningThreshold: 95,
      }).success,
    ).toBe(false));
  it('escapes CSV formula injection and quotes', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});

import { comparableMetrics } from '@kpi/kpi-engine';
describe('historical result presentation', () => {
  it.each([
    [{ targetType: 'GTE', targetValue: 90, unit: '%' }, '≥ 90 %'],
    [{ targetType: 'LTE', targetValue: 0, unit: 'ครั้ง' }, '≤ 0 ครั้ง'],
    [{ targetType: 'BETWEEN', targetValue: 0, targetMin: 0, targetMax: 10, unit: '%' }, '0–10 %'],
  ])('formats the evaluated target including zero bounds', (target, label) =>
    expect(formatTarget(target)).toBe(label),
  );
  it('never displays invalid target numbers', () =>
    expect(formatTarget({ targetType: 'GTE', targetValue: Infinity })).toBe('—'));
  it('keeps target changes comparable but separates units and frequencies', () => {
    const a = { unit: '%', frequency: 'MONTHLY', calculationMode: 'PERCENTAGE' };
    const before = { ...a, targetValue: 90 };
    const after = { ...a, targetValue: 99 };
    expect(comparableMetrics(before, after)).toBe(true);
    expect(comparableMetrics(a, { ...a, unit: 'ratio' })).toBe(false);
    expect(comparableMetrics(a, { ...a, frequency: 'DAILY' })).toBe(false);
  });
  it('separates rate scales and recognizes the default multiplier', () => {
    const a = { unit: 'rate', frequency: 'MONTHLY', calculationMode: 'RATE' };
    expect(comparableMetrics(a, { ...a, rateMultiplier: 1000 })).toBe(true);
    expect(comparableMetrics(a, { ...a, rateMultiplier: 100 })).toBe(false);
  });
});
