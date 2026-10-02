import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import CreditDuesClient from '@/components/admin/CreditDuesClient';

export const metadata = { title: 'Credit & Dues (Udhaar) — Beverage POS' };

export default async function CreditDuesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);
  return <CreditDuesClient settings={settings} />;
}
