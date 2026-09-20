// Business settings (single row, id = 1).
import { cache } from 'react';
import { query } from './db.js';

const DEFAULTS = {
  business_name: 'Beverage Store',
  currency: 'Rs',
  timezone: 'Asia/Karachi',
  receipt_footer: 'Thank you for your business.',
  daily_sales_goal: 0,
  monthly_sales_goal: 0,
  has_logo: false,
};

export const TIMEZONES = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Europe/London',
  'UTC',
];

/**
 * The shared settings row (without binary blobs). Wrapped in React cache()
 * so a request that renders both the layout and the page queries the
 * database only once. The logo itself is served by /api/settings/logo so
 * it is never embedded in JSON responses.
 */
export const getSettings = cache(async () => {
  const rows = await query(
    `SELECT business_name, currency, timezone, receipt_footer,
            daily_sales_goal, monthly_sales_goal,
            (logo_data IS NOT NULL) AS has_logo
       FROM business_settings WHERE id = 1`
  );
  return rows[0]
    ? { ...rows[0], daily_sales_goal: Number(rows[0].daily_sales_goal), monthly_sales_goal: Number(rows[0].monthly_sales_goal) }
    : { ...DEFAULTS };
});

/** Raw logo bytes for the /api/settings/logo endpoint. */
export async function getLogo() {
  const rows = await query('SELECT logo_data, logo_mime FROM business_settings WHERE id = 1');
  if (!rows[0]) return null;
  return rows[0];
}
