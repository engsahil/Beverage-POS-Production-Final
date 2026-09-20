import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import SalesClient from '@/components/sales/SalesClient';

export const metadata = { title: 'Sales — Beverage POS' };

export default async function SalesPage() {
  const user = await getSessionUser();
  const settings = await getSettings().catch(() => null);
  return <SalesClient user={user} settings={settings} />;
}
