// Customers: admin-only page (cashiers with the customer_management
// permission get access through the API, but this admin page stays in the
// admin area for consistency with the rest of the settings pages).
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import CustomersClient from '@/components/admin/CustomersClient';

export const metadata = { title: 'Customers — Beverage POS' };

export default async function CustomersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);
  return <CustomersClient settings={settings} />;
}
