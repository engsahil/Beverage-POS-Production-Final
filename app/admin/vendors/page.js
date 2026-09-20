import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import VendorsClient from '@/components/admin/VendorsClient';

export const metadata = { title: 'Vendors — Beverage POS' };

export default async function VendorsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);
  return <VendorsClient settings={settings} />;
}
