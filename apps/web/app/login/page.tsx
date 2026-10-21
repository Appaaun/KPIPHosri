import { db } from '@kpi/db';
import Login from './view';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const settings = await db.organizationSettings.findUnique({ where: { id: 'organization' } });
  return (
    <Login
      organization={settings?.name ?? process.env.ORGANIZATION_NAME ?? 'โรงพยาบาลโพธิ์ศรีสุวรรณ'}
    />
  );
}
