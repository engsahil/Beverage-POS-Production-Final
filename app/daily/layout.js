// Daily records for non-admin users who hold the 'reports' permission.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/Sidebar';

export default async function DailyLayout({ children }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && !hasPermission(user, 'reports')) redirect('/pos');
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
