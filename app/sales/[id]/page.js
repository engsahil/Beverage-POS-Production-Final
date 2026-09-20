import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import SaleDetailClient from '@/components/sales/SaleDetailClient';

export const metadata = { title: 'Receipt — Beverage POS' };

export default async function SaleDetailPage({ params }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const settings = await getSettings().catch(() => null);
  return <SaleDetailClient saleId={id} user={user} settings={settings} />;
}
