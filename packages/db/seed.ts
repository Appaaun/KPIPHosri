import { db } from './src/index';
import { calculate, evaluate } from '@kpi/kpi-engine';
import argon2 from 'argon2';
const departments = [
  ['ADMIN', 'บริหาร'],
  ['PHARMACY', 'กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค'],
  ['NURSING', 'กลุ่มงานการพยาบาล'],
  ['LAB', 'กลุ่มงานเทคนิคการแพทย์'],
  ['RADIOLOGY', 'กลุ่มงานรังสีวิทยา'],
  ['DENTAL', 'กลุ่มงานทันตกรรม'],
  ['REHAB', 'กลุ่มงานเวชศาสตร์ฟื้นฟู'],
  ['MEDICAL', 'กลุ่มงานการแพทย์'],
  ['FINANCE', 'กลุ่มงานการเงิน'],
  ['INSURANCE', 'กลุ่มงานประกันสุขภาพ'],
  ['HR', 'กลุ่มงานทรัพยากรบุคคล'],
  ['IT', 'กลุ่มงานเทคโนโลยีสารสนเทศ'],
  ['QUALITY', 'กลุ่มงานพัฒนาคุณภาพ'],
];
async function seed() {
  await db.organizationSettings.upsert({
    where: { id: 'organization' },
    create: {
      name: process.env.ORGANIZATION_NAME ?? 'โรงพยาบาลโพธิ์ศรีสุวรรณ',
      timezone: process.env.APP_TIMEZONE ?? 'Asia/Bangkok',
    },
    update: {},
  });
  for (const [sortOrder, [code, nameTh]] of departments.entries())
    await db.department.upsert({
      where: { code },
      create: { code, nameTh, sortOrder },
      update: {},
    });
  await db.dataSource.upsert({
    where: { name: 'Synthetic HIS' },
    create: { name: 'Synthetic HIS', type: 'MOCK', enabled: false },
    update: {},
  });
  await db.dataSource.upsert({
    where: { name: 'HIMPRO (not configured)' },
    create: { name: 'HIMPRO (not configured)', type: 'HIMPRO', enabled: false },
    update: {},
  });
  if (process.env.SEED_DEMO_DATA === 'true') {
    const definitions = [
      ['PHARMACY', 'PHARM-MR-001', 'Medication Reconciliation ภายใน 24 ชั่วโมง', 90, 'GTE'],
      ['PHARMACY', 'PHARM-ME-001', 'Dispensing Error Rate', 2, 'LTE'],
      ['PHARMACY', 'PHARM-HAD-001', 'High Alert Drug Monitoring', 95, 'GTE'],
      ['PHARMACY', 'PHARM-ADR-001', 'ADR Follow-up Completeness', 90, 'GTE'],
      ['PHARMACY', 'PHARM-CLOZ-001', 'Clozapine CBC Follow-up', 95, 'GTE'],
      ['PHARMACY', 'PHARM-STOCK-001', 'Essential Drug Availability', 95, 'GTE'],
      ['NURSING', 'NUR-FALL-001', 'อัตราการพลัดตกหกล้ม', 2, 'LTE'],
      ['NURSING', 'NUR-HAND-001', 'การปฏิบัติตามหลักสุขอนามัยมือ', 90, 'GTE'],
      ['NURSING', 'NUR-REC-001', 'ความครบถ้วนของบันทึกการพยาบาล', 95, 'GTE'],
      ['LAB', 'LAB-TAT-001', 'ความทันเวลาของผลตรวจ', 90, 'GTE'],
      ['LAB', 'LAB-CRIT-001', 'การแจ้งค่าวิกฤต', 95, 'GTE'],
      ['LAB', 'LAB-REJ-001', 'อัตราการปฏิเสธสิ่งส่งตรวจ', 2, 'LTE'],
      ['FINANCE', 'FIN-BUD-001', 'การใช้จ่ายงบประมาณ', 90, 'GTE'],
      ['FINANCE', 'FIN-CLAIM-001', 'อัตราการยอมรับคำขอเบิก', 95, 'GTE'],
      ['FINANCE', 'FIN-AR-001', 'การเรียกเก็บลูกหนี้', 90, 'GTE'],
    ] as const;
    for (const [i, [code, kpiCode, name, targetValue, targetType]] of definitions.entries()) {
      const dep = await db.department.findUniqueOrThrow({ where: { code } });
      const k = await db.kpiDefinition.upsert({
        where: { code: kpiCode },
        create: {
          code: kpiCode,
          nameTh: name,
          description: 'ข้อมูลสังเคราะห์สำหรับสาธิต ไม่ใช่ตัวชี้วัดทางการของโรงพยาบาล',
          departmentId: dep.id,
          unit: targetType === 'LTE' ? 'ต่อ 1,000' : '%',
          calculationMode: targetType === 'LTE' ? 'RATE' : 'PERCENTAGE',
          targetValue,
          targetType,
          warningThreshold: targetType === 'LTE' ? 3 : targetValue - 5,
          displayOrder: i,
          owner: 'Demo quality team',
        },
        update: {},
      });
      for (let month = 0; month < 12; month++) {
        const now = new Date();
        const periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + month, 1),
        );
        const periodEnd = new Date(
          Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0),
        );
        const bucket = (i + month) % 4;
        const denominator = bucket === 3 ? 0 : 1000;
        const numerator =
          targetType === 'LTE'
            ? [1, 3, 5, 0][bucket]
            : [980, Math.round((targetValue - 3) * 10), Math.round((targetValue - 12) * 10), 0][
                bucket
              ];
        const value = calculate(k, { numerator, denominator });
        await db.kpiResult.upsert({
          where: { kpiId_periodStart_periodEnd: { kpiId: k.id, periodStart, periodEnd } },
          create: {
            kpiId: k.id,
            periodStart,
            periodEnd,
            numerator,
            denominator,
            value,
            status: evaluate(k, value),
            synthetic: true,
            targetSnapshot: JSON.parse(JSON.stringify(k)),
            source: 'SYSTEM',
          },
          update: {},
        });
      }
    }
  }
  if (process.env.SEED_DEMO_USERS === 'true') {
    const adminPassword = process.env.DEMO_ADMIN_PASSWORD,
      userPassword = process.env.DEMO_USER_PASSWORD;
    if (!adminPassword || !userPassword) {
      console.log('Demo users skipped: set DEMO_ADMIN_PASSWORD and DEMO_USER_PASSWORD securely.');
      return;
    }
    if (adminPassword.length < 12 || userPassword.length < 12)
      throw new Error('Demo passwords require at least 12 characters');
    const users = [
      ['admin', 'SUPER_ADMIN', null],
      ['executive', 'EXECUTIVE', null],
      ['quality', 'QUALITY_ADMIN', null],
      ['pharmacy.admin', 'DEPARTMENT_ADMIN', 'PHARMACY'],
      ['pharmacy.entry', 'DATA_ENTRY', 'PHARMACY'],
      ['nursing.admin', 'DEPARTMENT_ADMIN', 'NURSING'],
      ['nursing.viewer', 'VIEWER', 'NURSING'],
    ] as const;
    for (const [username, role, code] of users) {
      const departmentId = code
        ? (await db.department.findUniqueOrThrow({ where: { code } })).id
        : null;
      await db.user.upsert({
        where: { username },
        create: {
          username,
          email: `${username}@example.local`,
          displayName: `Demo ${username}`,
          role,
          departmentId,
          passwordHash: await argon2.hash(username === 'admin' ? adminPassword : userPassword),
        },
        update: {},
      });
    }
    console.log('Demo users seeded; existing accounts/passwords were preserved.');
  }
  console.log('Seed completed. All demonstration KPI data is synthetic.');
}
seed().finally(() => db.$disconnect());
