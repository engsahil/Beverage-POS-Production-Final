import { getSettings } from '@/lib/settings';
import InventoryClient from '@/components/admin/InventoryClient';

export const metadata = { title: 'Inventory — Beverage POS' };

export default async function InventoryPage() {
  const settings = await getSettings().catch(() => null);
  return <InventoryClient settings={settings} />;
}
