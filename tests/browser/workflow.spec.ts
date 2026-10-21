import { test, expect } from '@playwright/test';
test('Thai login, dashboard, department and KPI detail', async ({ page }) => {
  test.skip(process.env.SEED_DEMO_USERS !== 'true', 'Explicit demo users required');
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeEnabled();
  await page.getByLabel('ชื่อผู้ใช้ / อีเมล').fill('pharmacy.entry');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(process.env.DEMO_USER_PASSWORD!);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'ภาพรวมโรงพยาบาล' })).toBeVisible();
  await expect(page.getByText('PHARM-MR-001', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: '▦ กลุ่มงาน', exact: true }).click();
  await page.locator('.department-card').first().click();
  await expect(page.locator('h1')).toContainText('กลุ่มงานเภสัชกรรม');
  await page
    .getByRole('link', { name: /Medication Reconciliation/ })
    .first()
    .click();
  await expect(page.locator('h2').first()).toContainText('Medication Reconciliation');
  await expect(page.getByRole('columnheader', { name: 'ตัวตั้ง' })).toBeVisible();
});

test('manual form to independent approval and responsive layout', async ({ browser }) => {
  test.setTimeout(240000);
  test.skip(process.env.SEED_DEMO_USERS !== 'true', 'Explicit demo users required');
  const reviewer = await browser.newContext();
  const staff = await browser.newContext();
  const review = await reviewer.newPage();
  const entry = await staff.newPage();
  async function login(page: typeof entry, username: string) {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeEnabled();
    await page.getByLabel('ชื่อผู้ใช้ / อีเมล').fill(username);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(process.env.DEMO_USER_PASSWORD!);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 60000 });
  }
  await login(review, 'pharmacy.admin');
  const departments = await (await review.request.get('/api/departments')).json();
  const dep = departments[0];
  const code = 'BROWSER-' + Date.now();
  const name = 'สังเคราะห์ทดสอบแบบฟอร์ม ' + code;
  const created = await review.request.post('/api/kpis', {
    headers: { Origin: process.env.APP_URL ?? 'http://localhost:3000' },
    data: {
      code,
      nameTh: name,
      departmentId: dep.id,
      unit: '%',
      calculationMode: 'PERCENTAGE',
      targetType: 'GTE',
      targetValue: 90,
      warningThreshold: 85,
      decimalPlaces: 2,
      displayOrder: -1,
    },
  });
  expect(created.ok()).toBeTruthy();
  const kpi = await created.json();
  await login(entry, 'pharmacy.entry');
  await entry.getByRole('link', { name: '＋ กรอกข้อมูล', exact: true }).click();
  await entry.getByLabel('ตัวชี้วัด', { exact: true }).selectOption(kpi.id);
  await entry.getByLabel('วันที่เริ่มรอบข้อมูล').fill('2098-01-01');
  await entry.getByLabel('วันที่สิ้นสุดรอบข้อมูล').fill('2098-01-31');
  await entry.getByLabel('ตัวตั้ง', { exact: true }).fill('95');
  await entry.getByLabel('ตัวหาร', { exact: true }).fill('100');
  await entry.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
  const entryRow = entry.getByRole('row').filter({ hasText: name });
  await expect(entryRow).toContainText('DRAFT');
  await entryRow.getByRole('button', { name: 'ส่งอนุมัติ' }).click();
  await expect(entryRow).toContainText('SUBMITTED');
  await review.goto('/approvals');
  const reviewRow = review.getByRole('row').filter({ hasText: name });
  await reviewRow.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(reviewRow).toHaveCount(0);
  const targetEdit = await review.request.post('/api/kpis/' + kpi.id, {
    headers: { Origin: process.env.APP_URL ?? 'http://localhost:3000' },
    data: { ...kpi, nameEn: kpi.nameEn ?? undefined, targetValue: 99, warningThreshold: 98 },
  });
  expect(targetEdit.ok()).toBeTruthy();
  await entry.goto('/dashboard');
  await expect(entry.getByRole('heading', { name: 'ภาพรวมโรงพยาบาล' })).toBeVisible();
  await expect(entry.getByText('PHARM-MR-001', { exact: false }).first()).toBeVisible();
  await entry.screenshot({ path: '/tmp/hospital-kpi-dashboard.png', fullPage: true });
  await entry.getByLabel('รอบข้อมูล', { exact: true }).fill('2098-01');
  const officialRow = entry.getByRole('row').filter({ hasText: name });
  await expect(officialRow.getByRole('cell', { name: '≥ 90 %', exact: true })).toBeVisible();
  await expect(officialRow).toContainText('ผ่านเป้า');
  await entry.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => entry.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await review.request.post('/api/kpis/' + kpi.id, {
    headers: { Origin: process.env.APP_URL ?? 'http://localhost:3000' },
    data: { ...kpi, nameEn: kpi.nameEn ?? undefined, active: false },
  });
  await reviewer.close();
  await staff.close();
});

test('login fails safely before JavaScript loads', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/login');
  await expect(page.locator('form')).toHaveAttribute('method', 'post');
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeDisabled();
  await context.close();
});

test('super administrator searches and filters hospital accounts', async ({ page }) => {
  test.skip(process.env.SEED_DEMO_USERS !== 'true', 'Explicit demo users required');
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeEnabled();
  await page.getByLabel('ชื่อผู้ใช้ / อีเมล').fill('admin');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(process.env.DEMO_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 60000 });
  await page.goto('/admin/users');
  await page.getByLabel('ค้นหาผู้ใช้งาน').fill('pharmacy');
  await page.getByLabel('บทบาท', { exact: true }).selectOption('DATA_ENTRY');
  await expect(page.getByRole('row').filter({ hasText: 'pharmacy.entry' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'pharmacy.admin' })).toHaveCount(0);
});
