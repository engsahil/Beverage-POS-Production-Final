// POS screen: full-width, available to admin and cashier.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { query } from '@/lib/db';
import PosClient from '@/components/pos/PosClient';

export const metadata = { title: 'POS — Beverage POS' };

export default async function PosPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const settings = await getSettings().catch(() => null);

  // The cashier's own minimum prices (admin-configured) — used for
  // instant client-side feedback only; the server re-enforces them.
  // Admins are never limited, so no lookup is needed for them.
  let priceLimits = null;
  if (user.role !== 'admin') {
    try {
      const r = (
        await query(
          'SELECT retail_min, wholesale_min, special_min FROM cashier_price_limits WHERE user_id = $1',
          [user.id]
        )
      )[0];
      if (r) {
        priceLimits = {
          retail: r.retail_min === null ? null : Number(r.retail_min),
          wholesale: r.wholesale_min === null ? null : Number(r.wholesale_min),
          special: r.special_min === null ? null : Number(r.special_min),
        };
      }
    } catch {
      // Non-fatal: the server still enforces the limits at sale time.
    }
  }

  return <PosClient user={user} settings={settings} priceLimits={priceLimits} />;
}
