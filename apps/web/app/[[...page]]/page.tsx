import { redirect } from 'next/navigation';
import { db } from '@kpi/db';
import { HttpError } from '@kpi/shared';
import { requireUser } from '../../lib/auth';
import Workspace from '../workspace';
export const dynamic = 'force-dynamic';
export default async function Page() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/login');
    throw e;
  }
  const settings = await db.organizationSettings.findUnique({ where: { id: 'organization' } });
  return (
    <Workspace
      user={{
        id: user.id,
        role: user.role,
        departmentId: user.departmentId,
        displayName: user.displayName,
      }}
      organization={settings?.name ?? process.env.ORGANIZATION_NAME ?? 'โรงพยาบาลโพธิ์ศรีสุวรรณ'}
      timezone={settings?.timezone ?? process.env.APP_TIMEZONE ?? 'Asia/Bangkok'}
      refresh={Math.max(30, Math.min(300, Number(process.env.DASHBOARD_REFRESH_SECONDS) || 45))}
    />
  );
}
