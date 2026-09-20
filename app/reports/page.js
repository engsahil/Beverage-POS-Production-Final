import { getSettings } from '@/lib/settings';
import ReportsClient from '@/components/admin/ReportsClient';

export const metadata = { title: 'Reports — Beverage POS' };

export default async function ReportsPage() {
  const settings = await getSettings().catch(() => null);
  return <ReportsClient settings={settings} />;
}
