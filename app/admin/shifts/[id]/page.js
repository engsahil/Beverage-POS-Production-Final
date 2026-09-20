// Admin-only: shift summary.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import ShiftDetailClient from '@/components/admin/ShiftDetailClient';

export const metadata = { title: 'Shift — Beverage POS' };

export default async function ShiftDetailPage({ params }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/pos');
  const { id } = await params;
  const settings = await getSettings().catch(() => null);
  return <ShiftDetailClient shiftId={id} user={user} settings={settings} />;
}
