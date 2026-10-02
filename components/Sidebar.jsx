'use client';
// App shell: sidebar navigation + content area.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useToast } from './Toast';
import InstallAppButton from './InstallAppButton';
import {
  IconHome,
  IconCart,
  IconBox,
  IconTag,
  IconLayers,
  IconTruck,
  IconReceipt,
  IconCalendar,
  IconChart,
  IconUsers,
  IconSliders,
  IconUser,
  IconLogout,
  IconGlass,
  IconWallet,
  IconScale,
} from './icons';

const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: IconHome },
  { href: '/pos', label: 'POS', icon: IconCart },
  { href: '/admin/products', label: 'Products', icon: IconBox },
  { href: '/admin/categories', label: 'Categories', icon: IconTag },
  { href: '/admin/inventory', label: 'Inventory', icon: IconLayers },
  { href: '/admin/purchases', label: 'Purchases', icon: IconTruck },
  { href: '/admin/vendors', label: 'Vendors', icon: IconUsers },
  { href: '/admin/customers', label: 'Customers', icon: IconUsers },
  { href: '/admin/credit-dues', label: 'Credit & Dues', icon: IconScale },
  { href: '/admin/finance', label: 'Finance', icon: IconWallet },
  { href: '/admin/shifts', label: 'Shifts', icon: IconCalendar },
  { href: '/sales', label: 'Sales', icon: IconReceipt },
  { href: '/admin/claims', label: 'Vendor Claims', icon: IconTruck },
  { href: '/admin/expenses', label: 'Expenses', icon: IconChart },
  { href: '/admin/daily', label: 'Daily Records', icon: IconCalendar },
  { href: '/admin/reports', label: 'Reports', icon: IconChart },
  { href: '/admin/users', label: 'Users', icon: IconUsers },
  { href: '/admin/settings', label: 'Settings', icon: IconSliders },
];

const CASHIER_NAV = [
  { href: '/pos', label: 'POS', icon: IconCart },
  { href: '/sales', label: 'Sales History', icon: IconReceipt },
  { href: '/account', label: 'Account', icon: IconUser },
];

const CASHIER_REPORT_NAV = [
  { href: '/reports', label: 'Reports', icon: IconChart },
  { href: '/daily', label: 'Daily Records', icon: IconCalendar },
];

export default function AppShell({ user, businessName, hasLogo = false, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  // The logo + business name must always show the REAL current state. The
  // layout's props are server-rendered and fresh for this request, so no
  // client fetch on first mount; after a client-side change (logo upload,
  // renaming the business in Settings) they go stale — refresh on route
  // change (one small cached request, deduped by the API client).
  const [logoLive, setLogoLive] = useState(hasLogo);
  const [nameLive, setNameLive] = useState(businessName);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return; // SSR props are fresh for the initial render
    }
    let alive = true;
    api('/api/settings')
      .then((d) => {
        if (!alive) return;
        setLogoLive(Boolean(d.has_logo));
        if (d.business_name) setNameLive(d.business_name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);
  let nav = user.role === 'admin' ? ADMIN_NAV : CASHIER_NAV;
  if (user.role !== 'admin' && (user.permissions || []).includes('reports')) {
    nav = [...nav, ...CASHIER_REPORT_NAV];
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // even if the call fails, send the user to the login page
    }
    window.location.href = '/login';
  }

  return (
    <div className="h-dvh flex bg-cream">
      <aside className="w-14 lg:w-56 shrink-0 bg-white border-r border-line flex flex-col">
        <div className="flex items-center gap-2.5 px-3 lg:px-4 h-14 border-b border-line shrink-0">
          {hasLogo ? (
            <img
              src="/api/settings/logo"
              alt={nameLive}
              className="w-8 h-8 rounded-lg object-contain bg-cream border border-line shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center shrink-0">
              <IconGlass className="w-4.5 h-4.5" />
            </div>
          )}
          <div className="hidden lg:block min-w-0">
            <div className="text-sm font-semibold text-stone-900 truncate">{nameLive}</div>
            <div className="text-[11px] text-stone-400">{user.role === 'admin' ? 'Admin' : 'Cashier'}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {nav.map((item) => {
            const active =
              item.href === '/pos'
                ? pathname === '/pos'
                : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                  active
                    ? 'bg-cream-deep text-stone-900 font-medium'
                    : 'text-stone-500 hover:bg-cream hover:text-stone-800'
                }`}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                <span className="hidden lg:block truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-2.5 lg:p-3 border-t border-line space-y-2 shrink-0">
          <InstallAppButton />
          <div className="hidden lg:flex items-center gap-2.5 px-1 pt-1">
            <div className="w-7 h-7 rounded-full bg-cream-deep text-stone-600 flex items-center justify-center text-xs font-semibold uppercase shrink-0">
              {(user.full_name || user.username).slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-stone-800 truncate">
                {user.full_name || user.username}
              </div>
              <div className="text-[11px] text-stone-400 truncate">@{user.username}</div>
            </div>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="flex items-center justify-center gap-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-cream disabled:opacity-60"
          >
            <IconLogout className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
    </div>
  );
}
