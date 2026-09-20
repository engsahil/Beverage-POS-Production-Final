// Admin-only: vendor claims.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import ClaimsClient from '@/components/admin/ClaimsClient';

export const metadata = { title: 'Vendor Claims — Beverage POS' };

export default async function ClaimsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/pos');
  const settings = await getSettings().catch(() => null);
  return <ClaimsClient settings={settings} />;
}
