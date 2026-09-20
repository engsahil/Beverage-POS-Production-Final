// Admin-only: all shifts.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import ShiftsClient from '@/components/admin/ShiftsClient';

export const metadata = { title: 'Shifts — Beverage POS' };

export default async function ShiftsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/pos');
  const settings = await getSettings().catch(() => null);
  return <ShiftsClient user={user} settings={settings} />;
}
