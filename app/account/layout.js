// Account page: any authenticated user.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import AppShell from '@/components/Sidebar';

export default async function AccountLayout({ children }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);
  return (
    <AppShell
      user={user}
      businessName={settings?.business_name || 'Beverage POS'}
      hasLogo={Boolean(settings?.has_logo)}
    >
      {children}
    </AppShell>
  );
}
