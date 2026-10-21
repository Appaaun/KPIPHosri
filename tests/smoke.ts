import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.APP_URL ?? 'http://localhost:3000';
assert(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname) &&
    process.env.SEED_DEMO_USERS === 'true',
  'Smoke test requires local explicitly enabled demo users',
);
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, method = 'POST') {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : method,
      headers: {
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        Origin: base,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }
  async login(username: string, password: string) {
    const csrf = await this.request('/api/auth/csrf');
    assert.equal(csrf.status, 200);
    const response = await fetch(base + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: base,
      },
      body: new URLSearchParams({
        csrfToken: csrf.data.csrfToken,
        username,
        password,
        json: 'true',
        callbackUrl: base + '/dashboard',
      }),
      redirect: 'manual',
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    assert.equal((await this.request('/api/me')).status, 200, 'Login must produce usable session');
  }
}
async function main() {
  const anonymous = new Client();
  assert.equal((await anonymous.request('/api/dashboard')).status, 401);
  const admin = new Client(),
    entry = new Client(),
    reviewer = new Client(),
    nursing = new Client(),
    viewer = new Client(),
    executive = new Client(),
    quality = new Client();
  for (const [client, username] of [
    [admin, 'admin'],
    [entry, 'pharmacy.entry'],
    [reviewer, 'pharmacy.admin'],
    [nursing, 'nursing.admin'],
    [viewer, 'nursing.viewer'],
    [executive, 'executive'],
    [quality, 'quality'],
  ] as const)
    await client.login(
      username,
      username === 'admin' ? process.env.DEMO_ADMIN_PASSWORD! : process.env.DEMO_USER_PASSWORD!,
    );
  const ds = (await admin.request('/api/departments')).data;
  const pharmacy = ds.find((d: { code: string }) => d.code === 'PHARMACY'),
    nurse = ds.find((d: { code: string }) => d.code === 'NURSING');
  const definition = {
    code: 'SMOKE-' + randomUUID().slice(0, 8).toUpperCase(),
    nameTh: 'ทดสอบระบบสังเคราะห์',
    departmentId: pharmacy.id,
    unit: '%',
    calculationMode: 'PERCENTAGE',
    targetType: 'GTE',
    targetValue: 90,
    warningThreshold: 85,
    decimalPlaces: 2,
  };
  const created = await reviewer.request('/api/kpis', definition);
  assert.equal(created.status, 200);
  const k = created.data;
  const nursingKpi = (await admin.request('/api/kpis?departmentId=' + nurse.id)).data.items[0];
  assert.equal((await reviewer.request('/api/departments/' + nurse.id)).status, 403);
  assert.equal((await entry.request('/api/dashboard?departmentId=' + nurse.id)).status, 403);
  assert.equal((await reviewer.request('/api/kpis/' + nursingKpi.id)).status, 403);
  assert.equal(
    (
      await reviewer.request('/api/kpis/' + nursingKpi.id, {
        ...definition,
        code: nursingKpi.code,
        departmentId: nurse.id,
      })
    ).status,
    403,
  );
  const form = {
    kpiId: k.id,
    periodStart: '2099-01-01',
    periodEnd: '2099-01-31',
    numerator: 95,
    denominator: 100,
    note: 'Synthetic HTTP smoke test',
  };
  assert.equal(
    (await reviewer.request('/api/submissions', { ...form, kpiId: nursingKpi.id })).status,
    403,
  );
  assert.equal(
    (await viewer.request('/api/submissions', { ...form, kpiId: nursingKpi.id })).status,
    403,
  );
  assert.equal((await executive.request('/api/submissions', form)).status, 403);
  assert.equal((await quality.request('/api/users')).status, 403);
  const draft = await entry.request('/api/submissions', { ...form, value: 1 });
  assert.equal(draft.status, 200);
  assert.equal(draft.data.value, 95, 'Backend ignores forged calculation');
  assert.equal((await entry.request(`/api/submissions/${draft.data.id}/approve`, {})).status, 403);
  assert.equal((await entry.request(`/api/submissions/${draft.data.id}/submit`, {})).status, 200);
  assert.equal((await entry.request('/api/submissions/' + draft.data.id, form)).status, 409);
  assert.equal(
    (await reviewer.request(`/api/submissions/${draft.data.id}/reject`, {})).status,
    400,
  );
  assert.equal(
    (await reviewer.request(`/api/submissions/${draft.data.id}/approve`, {})).status,
    200,
  );
  assert.equal(
    (await reviewer.request(`/api/submissions/${draft.data.id}/approve`, {})).status,
    409,
  );
  const official = await executive.request(
    '/api/dashboard?period=2099-01&departmentId=' + pharmacy.id,
  );
  assert.equal(official.status, 200);
  assert.equal(official.data.items.find((v: { id: string }) => v.id === k.id).current.value, 95);
  const nursingDraft = await nursing.request('/api/submissions', {
    ...form,
    kpiId: nursingKpi.id,
    periodStart: '2099-02-01',
    periodEnd: '2099-02-28',
  });
  assert.equal(nursingDraft.status, 200);
  assert.equal(
    (await nursing.request(`/api/submissions/${nursingDraft.data.id}/submit`, {})).status,
    200,
  );
  assert.equal(
    (await reviewer.request(`/api/submissions/${nursingDraft.data.id}/approve`, {})).status,
    403,
  );
  assert.equal(
    (await nursing.request(`/api/submissions/${nursingDraft.data.id}/approve`, {})).status,
    403,
  );
  const duplicate = await entry.request('/api/submissions', form);
  assert.equal(
    (await entry.request(`/api/submissions/${duplicate.data.id}/submit`, {})).status,
    200,
  );
  assert.equal(
    (await reviewer.request(`/api/submissions/${duplicate.data.id}/approve`, {})).status,
    409,
  );
  const rejected = await entry.request('/api/submissions', {
    ...form,
    periodStart: '2099-03-01',
    periodEnd: '2099-03-31',
  });
  await entry.request(`/api/submissions/${rejected.data.id}/submit`, {});
  assert.equal(
    (
      await reviewer.request(`/api/submissions/${rejected.data.id}/reject`, {
        reason: 'Synthetic rejection',
      })
    ).status,
    200,
  );
  const text = `kpi_code,period_start,period_end,numerator,denominator,value,note\n${k.code},2099-04-01,2099-04-30,1,0,,Synthetic CSV`;
  const countBefore = (await entry.request('/api/submissions')).data.length;
  const preview = await entry.request('/api/csv', { text, confirm: false });
  assert.equal(preview.status, 200);
  assert.equal(preview.data[0].value, null);
  assert.equal(preview.data[0].error, null);
  assert.equal((await entry.request('/api/submissions')).data.length, countBefore);
  assert.equal((await entry.request('/api/csv', { text, confirm: true })).data.count, 1);
  const imported = (await entry.request('/api/submissions')).data.find(
    (s: { kpiId: string; source: string }) => s.kpiId === k.id && s.source === 'CSV_IMPORT',
  );
  assert(imported);
  assert.equal((await entry.request(`/api/submissions/${imported.id}/submit`, {})).status, 200);
  assert.equal((await reviewer.request(`/api/submissions/${imported.id}/approve`, {})).status, 200);
  const csvResult = (await reviewer.request('/api/kpis/' + k.id)).data.results.find(
    (r: { periodStart: string }) => r.periodStart.startsWith('2099-04'),
  );
  assert.equal(csvResult.source, 'CSV_IMPORT');
  assert.equal(csvResult.status, 'NO_DATA');
  assert.equal(
    (
      await entry.request('/api/csv', {
        text: text.replace(k.code, nursingKpi.code),
        confirm: true,
      })
    ).status,
    400,
  );
  const exported = await reviewer.request('/api/export?period=2099-01');
  assert.equal(exported.status, 200);
  assert(exported.data.includes(k.code));
  assert(!exported.data.includes(nursingKpi.code));
  const audit = (await admin.request('/api/audit')).data;
  assert(
    audit.some(
      (r: { action: string; entityId: string }) =>
        r.action === 'SUBMISSION_APPROVED' && r.entityId === draft.data.id,
    ),
  );
  assert.equal((await admin.request('/api/health')).status, 200);
  const users = (await admin.request('/api/users')).data;
  assert(users.every((u: object) => !('passwordHash' in u)));
  const localPassword = randomUUID() + randomUUID();
  const account = {
    username: 'smoke-' + randomUUID().slice(0, 8),
    email: 'smoke-' + randomUUID() + '@example.local',
    displayName: 'Synthetic account',
    role: 'VIEWER',
    departmentId: nurse.id,
    isActive: true,
    password: localPassword,
  };
  const added = await admin.request('/api/users', account);
  assert.equal(added.status, 200);
  assert(!('passwordHash' in added.data));
  assert(
    (await admin.request('/api/users?search=' + account.username + '&role=VIEWER')).data.some(
      (u: { id: string }) => u.id === added.data.id,
    ),
  );
  assert.equal(
    (await admin.request('/api/users?search=' + account.username + '&role=SUPER_ADMIN')).data
      .length,
    0,
  );
  assert.equal((await admin.request('/api/users?role=INVALID')).status, 400);
  const temporary = new Client();
  await temporary.login(account.username, localPassword);
  const { password: unusedPassword, ...safeAccount } = account;
  void unusedPassword;
  assert.equal(
    (await admin.request('/api/users/' + added.data.id, { ...safeAccount, isActive: false }))
      .status,
    200,
  );
  assert.equal(
    (await temporary.request('/api/me')).status,
    401,
    'Disabled account session is revoked',
  );
  const activeAdmins = users.filter(
    (u: { role: string; isActive: boolean }) => u.role === 'SUPER_ADMIN' && u.isActive,
  );
  if (activeAdmins.length === 1) {
    const first = activeAdmins[0];
    assert.equal(
      (await admin.request('/api/users/' + first.id, { ...first, isActive: false })).status,
      409,
      'Last admin must remain active',
    );
  }
  await reviewer.request('/api/kpis/' + k.id, { ...definition, active: false });
  console.log(
    'HTTP smoke passed: seven-role login, cross-department 403s, calculation, immutable submission, approval/rejection, duplicate prevention, executive result, CSV, scoped export, audit, safe users.',
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Smoke failed');
  process.exitCode = 1;
});
