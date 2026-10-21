import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { db, Prisma } from '@kpi/db';
import { MockHisAdapter, HimproAdapter } from '@kpi/shared/src/adapters';
import { calculate, evaluate } from '@kpi/kpi-engine';
export async function tick() {
  await db.workerHeartbeat.upsert({
    where: { id: 'worker' },
    create: {},
    update: { updatedAt: new Date() },
  });
  const sources = await db.dataSource.findMany({
    where: { enabled: true },
    include: { kpis: { where: { active: true } } },
  });
  for (const source of sources) {
    if (!cron.validate(source.schedule)) continue;
    const now = new Date();
    const last = await db.syncRun.findFirst({
      where: { dataSourceId: source.id },
      orderBy: { startedAt: 'desc' },
    });
    // Match a source's UTC cron schedule, independent of the heartbeat interval.
    if (last && last.startedAt.getTime() > now.getTime() - 60000) continue;
    // Run only when this minute matches by asking the cron parser through a one-minute-back clock-independent matcher below.
    if (!sourceDue(source.schedule, now)) continue;
    await db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext(${source.id})) as locked`;
        if (!locked[0]?.locked) return;
        const run = await tx.syncRun.create({
          data: { dataSourceId: source.id, state: 'RUNNING' },
        });
        await tx.auditLog.create({
          data: {
            actorRole: 'SYSTEM_WORKER',
            action: 'SYNC_STARTED',
            entityType: 'SyncRun',
            entityId: run.id,
          },
        });
        try {
          if (!['MOCK', 'HIMPRO'].includes(source.type))
            throw new Error('No configured automated adapter');
          const adapter = source.type === 'MOCK' ? new MockHisAdapter() : new HimproAdapter();
          await adapter.testConnection();
          let count = 0;
          const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
          for (const k of source.kpis) {
            const metric = await adapter.fetchMetric({ code: k.code, periodStart, periodEnd });
            const value = calculate(k, metric);
            const status = evaluate(k, value);
            const result = {
              numerator: metric.numerator,
              denominator: metric.denominator,
              value,
              status,
              source: 'HIS' as const,
              synthetic: metric.synthetic,
              targetSnapshot: JSON.parse(JSON.stringify(k)) as Prisma.InputJsonValue,
            };
            const existing = await tx.kpiResult.findUnique({
              where: { kpiId_periodStart_periodEnd: { kpiId: k.id, periodStart, periodEnd } },
            });
            if (existing?.submissionId) continue;
            await tx.kpiResult.upsert({
              where: { kpiId_periodStart_periodEnd: { kpiId: k.id, periodStart, periodEnd } },
              create: { kpiId: k.id, periodStart, periodEnd, ...result },
              update: result,
            });
            const key = `red:${k.id}:${periodStart.toISOString()}`;
            if (status === 'RED')
              await tx.alert.upsert({
                where: { key },
                create: {
                  key,
                  type: 'RED_KPI',
                  severity: 'HIGH',
                  departmentId: k.departmentId,
                  kpiId: k.id,
                  message: `${k.code} ไม่ผ่านเป้าหมาย`,
                },
                update: { resolvedAt: null },
              });
            else
              await tx.alert.updateMany({
                where: { key, resolvedAt: null },
                data: { resolvedAt: new Date(), resolvedBy: 'SYSTEM_WORKER' },
              });
            count++;
          }
          await tx.syncRun.update({
            where: { id: run.id },
            data: {
              state: 'SUCCEEDED',
              count,
              finishedAt: new Date(),
              message: source.type === 'MOCK' ? 'Synthetic aggregate data' : '',
            },
          });
          await tx.dataSource.update({
            where: { id: source.id },
            data: { lastSyncAt: new Date() },
          });
          await tx.alert.updateMany({
            where: { key: { in: [`sync:${source.id}`, `stale:${source.id}`] }, resolvedAt: null },
            data: { resolvedAt: new Date(), resolvedBy: 'SYSTEM_WORKER' },
          });
          await tx.auditLog.create({
            data: {
              actorRole: 'SYSTEM_WORKER',
              action: 'SYNC_SUCCEEDED',
              entityType: 'SyncRun',
              entityId: run.id,
              after: { count },
            },
          });
        } catch {
          await tx.syncRun.update({
            where: { id: run.id },
            data: {
              state: 'FAILED',
              finishedAt: new Date(),
              message: 'Adapter failed; check mapping and configuration. No payload logged.',
            },
          });
          await tx.alert.upsert({
            where: { key: `sync:${source.id}` },
            create: {
              key: `sync:${source.id}`,
              type: 'SYNC_FAILURE',
              severity: 'HIGH',
              message: `การซิงก์ ${source.name} ล้มเหลว`,
            },
            update: { resolvedAt: null },
          });
          await tx.auditLog.create({
            data: {
              actorRole: 'SYSTEM_WORKER',
              action: 'SYNC_FAILED',
              entityType: 'SyncRun',
              entityId: run.id,
            },
          });
        }
      },
      { timeout: 30000 },
    );
    const refreshed = await db.dataSource.findUniqueOrThrow({ where: { id: source.id } });
    if (
      !refreshed.lastSyncAt ||
      Date.now() - refreshed.lastSyncAt.getTime() > source.staleAfterMinutes * 60000
    )
      await db.alert.upsert({
        where: { key: `stale:${source.id}` },
        create: {
          key: `stale:${source.id}`,
          type: 'STALE_DATA',
          severity: 'WARNING',
          message: `ข้อมูล ${source.name} ไม่ได้รับการอัปเดตตามกำหนด`,
        },
        update: {},
      });
  }
}
function sourceDue(schedule: string, now: Date) {
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  const previous = new Date(minute.getTime() - 1);
  const next = CronExpressionParser.parse(schedule, { currentDate: previous, tz: 'UTC' })
    .next()
    .toDate();
  return next.getTime() === minute.getTime();
}
async function main() {
  if (process.env.WORKER_ENABLED === 'false') {
    console.log('Worker disabled');
    return;
  }
  const schedule = process.env.WORKER_CRON ?? '*/5 * * * *';
  if (!cron.validate(schedule)) throw new Error('Invalid WORKER_CRON');
  await tick();
  cron.schedule('* * * * *', () =>
    db.workerHeartbeat
      .upsert({ where: { id: 'worker' }, create: {}, update: { updatedAt: new Date() } })
      .then(() => {}),
  );
  let running = false;
  cron.schedule(
    schedule,
    async () => {
      if (running) return;
      running = true;
      try {
        await tick();
      } catch {
        console.error('Worker tick failed');
      } finally {
        running = false;
      }
    },
    { timezone: 'UTC' },
  );
  console.log('Worker started; source schedules evaluated in UTC');
}
if (process.env.WORKER_ONCE === 'true') tick().finally(() => db.$disconnect());
else
  main().catch(() => {
    console.error('Worker startup failed');
    process.exitCode = 1;
  });
