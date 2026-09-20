import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import SettingsClient from '@/components/admin/SettingsClient';

export const metadata = { title: 'Settings — Beverage POS' };

export default async function SettingsPage() {
  const user = await getSessionUser();
  const settings = await getSettings().catch(() => null);
  return <SettingsClient user={user} initial={settings} />;
}
