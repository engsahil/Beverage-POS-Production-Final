// Admin-only: expenses.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import ExpensesClient from '@/components/admin/ExpensesClient';

export const metadata = { title: 'Expenses — Beverage POS' };

export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/pos');
  const settings = await getSettings().catch(() => null);
  return <ExpensesClient settings={settings} />;
}
