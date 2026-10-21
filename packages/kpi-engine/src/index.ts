export type Status = 'GREEN' | 'YELLOW' | 'RED' | 'NO_DATA';
export type Definition = {
  calculationMode: string;
  targetType: string;
  targetValue: number;
  targetMin?: number | null;
  targetMax?: number | null;
  warningThreshold?: number | null;
  warningMin?: number | null;
  warningMax?: number | null;
  decimalPlaces: number;
  rateMultiplier?: number;
};
export type Input = {
  value?: number | null;
  numerator?: number | null;
  denominator?: number | null;
};
export const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function round(n: number, places: number): number {
  const factor = 10 ** Math.max(0, Math.min(6, places));
  return Math.round((n + Number.EPSILON) * factor) / factor;
}
export function calculate(d: Definition, input: Input): number | null {
  let value: number | null = null;
  if (d.calculationMode === 'DIRECT_VALUE') value = finite(input.value) ? input.value : null;
  else if (
    ['PERCENTAGE', 'RATE', 'RATIO'].includes(d.calculationMode) &&
    finite(input.numerator) &&
    finite(input.denominator) &&
    input.numerator >= 0 &&
    input.denominator > 0
  )
    value =
      (input.numerator / input.denominator) *
      (d.calculationMode === 'PERCENTAGE'
        ? 100
        : d.calculationMode === 'RATE'
          ? (d.rateMultiplier ?? 1000)
          : 1);
  return finite(value) ? round(value, d.decimalPlaces) : null;
}
export function evaluate(d: Definition, value: number | null): Status {
  if (!finite(value)) return 'NO_DATA';
  if (d.targetType === 'GTE')
    return value >= d.targetValue
      ? 'GREEN'
      : finite(d.warningThreshold) && value >= d.warningThreshold
        ? 'YELLOW'
        : 'RED';
  if (d.targetType === 'LTE')
    return value <= d.targetValue
      ? 'GREEN'
      : finite(d.warningThreshold) && value <= d.warningThreshold
        ? 'YELLOW'
        : 'RED';
  if (d.targetType === 'BETWEEN' && finite(d.targetMin) && finite(d.targetMax))
    return value >= d.targetMin && value <= d.targetMax
      ? 'GREEN'
      : finite(d.warningMin) &&
          finite(d.warningMax) &&
          value >= d.warningMin &&
          value <= d.warningMax
        ? 'YELLOW'
        : 'RED';
  return 'NO_DATA';
}
export function trend(current: number | null, previous: number | null) {
  return finite(current) && finite(previous)
    ? {
        delta: round(current - previous, 2),
        direction: current > previous ? 'UP' : current < previous ? 'DOWN' : 'FLAT',
      }
    : null;
}

export type CalculationMetadata = {
  unit: string;
  calculationMode: string;
  frequency: string;
  rateMultiplier?: number;
};
export function comparableMetrics(a: CalculationMetadata, b: CalculationMetadata): boolean {
  return (
    a.unit === b.unit &&
    a.calculationMode === b.calculationMode &&
    a.frequency === b.frequency &&
    (a.calculationMode !== 'RATE' || (a.rateMultiplier ?? 1000) === (b.rateMultiplier ?? 1000))
  );
}
