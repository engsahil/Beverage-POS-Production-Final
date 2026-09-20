import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import FinanceClient from '@/components/admin/FinanceClient';

export const metadata = { title: 'Finance — Beverage POS' };

export default async function FinancePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);
  return <FinanceClient settings={settings} />;
}
