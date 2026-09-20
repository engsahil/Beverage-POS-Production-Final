import { getSettings } from '@/lib/settings';
import DashboardClient from '@/components/admin/DashboardClient';

export const metadata = { title: 'Dashboard — Beverage POS' };

export default async function AdminPage() {
  const settings = await getSettings().catch(() => null);
  return <DashboardClient settings={settings} />;
}
