import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import AccountClient from '@/components/account/AccountClient';

export const metadata = { title: 'Account — Beverage POS' };

export default async function AccountPage() {
  const user = await getSessionUser();
  const settings = await getSettings().catch(() => null);
  return <AccountClient user={user} settings={settings} />;
}
