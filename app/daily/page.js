import { getSettings } from '@/lib/settings';
import DailyClient from '@/components/admin/DailyClient';

export const metadata = { title: 'Daily Records — Beverage POS' };

export default async function DailyPage() {
  const settings = await getSettings().catch(() => null);
  return <DailyClient settings={settings} />;
}
