// GET /api/finance/cash-flow?from=&to= (admin)
// Movement of each account (cash / bank / card) over a date range:
//   opening  -> received (sales, customer payments) -> paid out (vendor
//               payments, expenses) -> closing
// "unspecified" = legacy expenses recorded before methods existed; they are
// shown separately instead of being guessed into an account.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok, round2 } from '@/lib/validate';
import { accountBalanceQuery, periodFlowQueries } from '@/lib/finance';

const METHODS = ['cash', 'bank', 'card'];

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  if (sp.get('from') && !from) return fail('Invalid "from" date.');
  if (sp.get('to') && !to) return fail('Invalid "to" date.');
  if (from && to && from > to) return fail('"From" must be before "to".');

  const settings = await getSettings();
  // Default range = last 30 business days in the STORE timezone (not UTC).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: settings.timezone });
  const d0 = new Date(today + 'T00:00:00Z');
  d0.setUTCDate(d0.getUTCDate() - 29);
  const f = from || d0.toISOString().slice(0, 10);
  const t = to || today;

  // Opening balances (everything before `f`).
  const openQ = accountBalanceQuery({ mode: 'before', from: f, tz: settings.timezone });
  const openRow = (await query(openQ.sql, openQ.params))[0];

  // Period components per method.
  const flows = periodFlowQueries({ from: f, to: t, tz: settings.timezone });
  const [salesRows, custRows, vendRows, expRows] = await Promise.all([
    query(flows.sales.sql, flows.sales.params),
    query(flows.customer.sql, flows.customer.params),
    query(flows.vendor.sql, flows.vendor.params),
    query(flows.expenses.sql, flows.expenses.params),
  ]);

  const byMethod = (rows) => {
    const m = {};
    for (const r of rows) m[r.method] = Number(r.total);
    return m;
  };
  const sales = byMethod(salesRows);
  const cust = byMethod(custRows);
  const vend = byMethod(vendRows);
  const exp = byMethod(expRows);
  const unspecified = exp.unspecified || 0;

  const accounts = {};
  for (const m of METHODS) {
    const opening = Number(openRow[m]);
    const inflow = round2((sales[m] || 0) + (cust[m] || 0));
    const outflow = round2((vend[m] || 0) + (exp[m] || 0));
    accounts[m] = {
      opening,
      sales: sales[m] || 0,
      customer_payments: cust[m] || 0,
      inflow,
      vendor_payments: vend[m] || 0,
      expenses: exp[m] || 0,
      outflow,
      closing: round2(opening + inflow - outflow),
    };
  }
  // Legacy expenses without a recorded method.
  const openingAll = round2(Number(openRow.cash) + Number(openRow.bank) + Number(openRow.card) + Number(openRow.unspecified));
  const totalInflow = round2(
    METHODS.reduce((s, m) => s + accounts[m].inflow, 0)
  );
  const totalOutflow = round2(METHODS.reduce((s, m) => s + accounts[m].outflow, 0) + unspecified);
  accounts.total = {
    opening: openingAll,
    inflow: totalInflow,
    outflow: totalOutflow,
    unspecified,
    closing: round2(openingAll + totalInflow - totalOutflow),
  };

  return ok({ from: f, to: t, accounts });
}
