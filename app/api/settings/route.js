// GET /api/settings -> business settings (any authenticated user)
// PUT /api/settings -> update settings (admin)
import { query } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { getSettings, TIMEZONES } from '@/lib/settings';
import { readJson, str, toNumber, fail, ok, round2 } from '@/lib/validate';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  return ok(await getSettings());
}

export async function PUT(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const businessName = str(body.businessName, { max: 80 });
  const currency = str(body.currency, { max: 10 });
  const timezone = str(body.timezone, { max: 64 });
  const receiptFooter = str(body.receiptFooter, { max: 160 });
  const dailyGoal = body.dailySalesGoal !== undefined ? toNumber(body.dailySalesGoal) : null;
  const monthlyGoal = body.monthlySalesGoal !== undefined ? toNumber(body.monthlySalesGoal) : null;

  if (!businessName) return fail('Business name is required.');
  if (!currency) return fail('Currency label is required.');
  if (!timezone || !TIMEZONES.includes(timezone)) return fail('Invalid timezone.');
  if (receiptFooter === null) return fail('Invalid receipt footer.');
  if (dailyGoal !== null && dailyGoal < 0) return fail('Daily goal must be zero or more.');
  if (monthlyGoal !== null && monthlyGoal < 0) return fail('Monthly goal must be zero or more.');

  // Keep existing goals when the client did not send them.
  const current = (await query('SELECT daily_sales_goal, monthly_sales_goal FROM business_settings WHERE id = 1'))[0];
  const finalDaily = dailyGoal !== null ? round2(dailyGoal) : Number(current?.daily_sales_goal ?? 0);
  const finalMonthly = monthlyGoal !== null ? round2(monthlyGoal) : Number(current?.monthly_sales_goal ?? 0);

  await query(
    `INSERT INTO business_settings (id, business_name, currency, timezone, receipt_footer,
                                    daily_sales_goal, monthly_sales_goal, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       currency = EXCLUDED.currency,
       timezone = EXCLUDED.timezone,
       receipt_footer = EXCLUDED.receipt_footer,
       daily_sales_goal = EXCLUDED.daily_sales_goal,
       monthly_sales_goal = EXCLUDED.monthly_sales_goal,
       updated_at = now()`,
    [businessName, currency, timezone, receiptFooter, finalDaily, finalMonthly]
  );
  return ok(await getSettings());
}
