import { getSettings } from '@/lib/settings';
import ProductsClient from '@/components/admin/ProductsClient';

export const metadata = { title: 'Products — Beverage POS' };

export default async function ProductsPage() {
  const settings = await getSettings().catch(() => null);
  return <ProductsClient settings={settings} />;
}
