import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import LoginClient from '@/components/LoginClient';

export const metadata = { title: 'Sign in — Beverage POS' };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === 'admin' ? '/admin' : '/pos');
  const settings = await getSettings().catch(() => null);
  return <LoginClient businessName={settings?.business_name || 'Beverage POS'} />;
}
