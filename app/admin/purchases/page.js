import { getSettings } from '@/lib/settings';
import PurchasesClient from '@/components/admin/PurchasesClient';

export const metadata = { title: 'Purchases — Beverage POS' };

export default async function PurchasesPage() {
  const settings = await getSettings().catch(() => null);
  return <PurchasesClient settings={settings} />;
}
