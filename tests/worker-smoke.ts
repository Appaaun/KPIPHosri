import { db } from '@kpi/db';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
async function main() {
  assert.equal(process.env.SEED_DEMO_DATA, 'true');
  const dep = await db.department.findUniqueOrThrow({ where: { code: 'PHARMACY' } });
  const source = await db.dataSource.create({
    data: {
      name: 'Worker smoke ' + randomUUID(),
      type: 'MOCK',
      enabled: true,
      schedule: '* * * * *',
    },
  });
  try {
    const k = await db.kpiDefinition.create({
      data: {
        code: 'WORKER-' + randomUUID().slice(0, 8).toUpperCase(),
        nameTh: 'ข้อมูลสังเคราะห์ทดสอบ worker',
        departmentId: dep.id,
        unit: '%',
        calculationMode: 'PERCENTAGE',
        targetValue: 101,
        warningThreshold: 100,
        dataSourceId: source.id,
        dataSourceType: 'HIS',
      },
    });
    const run = spawnSync(
      process.execPath,
      ['scripts/run.mjs', 'tsx', 'apps/worker/src/index.ts'],
      { env: { ...process.env, WORKER_ONCE: 'true' }, stdio: 'pipe', encoding: 'utf8' },
    );
    assert.equal(run.status, 0, 'Worker process failed');
    const result = await db.kpiResult.findFirstOrThrow({ where: { kpiId: k.id } });
    assert(result.synthetic);
    assert.equal(result.status, 'RED');
    assert(await db.workerHeartbeat.findUnique({ where: { id: 'worker' } }));
    assert(await db.syncRun.findFirst({ where: { dataSourceId: source.id, state: 'SUCCEEDED' } }));
    assert(await db.alert.findFirst({ where: { kpiId: k.id, type: 'RED_KPI' } }));
    assert.equal(
      await db.alert.count({ where: { key: `stale:${source.id}`, resolvedAt: null } }),
      0,
    );
    await assert.rejects(
      db.auditLog.updateMany({ where: { entityType: 'SyncRun' }, data: { action: 'TAMPERED' } }),
    );
    await db.kpiDefinition.update({ where: { id: k.id }, data: { active: false } });
    console.log(
      'Worker smoke passed: aggregate sync, calculation, result, RED alert, heartbeat, no false stale alert, immutable audit.',
    );
  } finally {
    await db.dataSource.update({ where: { id: source.id }, data: { enabled: false } });
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'Worker test failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
