import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import PurchaseDetailClient from '@/components/admin/PurchaseDetailClient';

export const metadata = { title: 'Purchase — Beverage POS' };

export default async function PurchaseDetailPage({ params }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const settings = await getSettings().catch(() => null);
  return <PurchaseDetailClient purchaseId={id} settings={settings} />;
}
