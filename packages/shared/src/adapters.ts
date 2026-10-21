export interface MetricRequest {
  code: string;
  periodStart: Date;
  periodEnd: Date;
}
export interface Metric {
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  synthetic: boolean;
}
export interface KpiDataAdapter {
  testConnection(): Promise<boolean>;
  fetchMetric(request: MetricRequest): Promise<Metric>;
  fetchPeriod(requests: MetricRequest[]): Promise<Metric[]>;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}
export class MockHisAdapter implements KpiDataAdapter {
  async testConnection() {
    return true;
  }
  async fetchMetric(r: MetricRequest) {
    const seed = Array.from(r.code).reduce(
      (n, c) => n + c.charCodeAt(0),
      r.periodStart.getUTCMonth(),
    );
    return {
      numerator: 80 + (seed % 21),
      denominator: 100,
      value: 80 + (seed % 21),
      synthetic: true,
    };
  }
  async fetchPeriod(requests: MetricRequest[]) {
    return Promise.all(requests.map((r) => this.fetchMetric(r)));
  }
  async healthCheck() {
    return { ok: true, message: 'Synthetic mock adapter' };
  }
}
export class HimproAdapter implements KpiDataAdapter {
  private unavailable(): never {
    throw new Error(
      'HIMPRO mapping unavailable. Configure a reviewed SELECT-only aggregate mapping before enabling.',
    );
  }
  async testConnection(): Promise<boolean> {
    return this.unavailable();
  }
  async fetchMetric(_request: MetricRequest): Promise<Metric> {
    return this.unavailable();
  }
  async fetchPeriod(_requests: MetricRequest[]): Promise<Metric[]> {
    return this.unavailable();
  }
  async healthCheck() {
    return {
      ok: false,
      message: 'Disabled: actual schema mapping and timeout-bound read-only driver required',
    };
  }
}
export interface Notifier {
  notify(message: { type: string; message: string; departmentId: string | null }): Promise<void>;
}
