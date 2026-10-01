// GET  /api/expenses -> list (admin; ?from & ?to & ?category & ?method)
// POST /api/expenses -> record an expense (admin)
//
// Fields: category, amount, date, method (cash|bank|card — which account
// it leaves), payee, reference, note, optional attachment.
// Legacy rows have method = NULL and are shown as "unspecified".
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, okGzip, round2 } from '@/lib/validate';

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Transport',
  'Maintenance',
  'Salaries',
  'Supplies',
  'Other',
];
const METHODS = ['cash', 'bank', 'card'];

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  const category = str(sp.get('category'), { max: 60 });
  const method = sp.get('method');

  const where = [];
  const params = [];
  if (from) {
    params.push(from);
    where.push(`e.expense_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`e.expense_date <= $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`e.category = $${params.length}`);
  }
  if (method === 'unspecified') {
    where.push('e.method IS NULL');
  } else if (METHODS.includes(method)) {
    params.push(method);
    where.push(`e.method = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT e.id, e.category, e.amount, e.expense_date, e.method, e.payee, e.reference, e.note,
            (e.attachment_data IS NOT NULL) AS has_attachment, e.attachment_name, e.created_at,
            u.full_name AS created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       ${whereSql}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT 500`,
    params
  );
  return okGzip({ expenses: rows.map((r) => ({ ...r, amount: Number(r.amount) })) }, req);
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const category = str(body.category, { max: 60 });
  const amount = toNumber(body.amount);
  const date = body.date ? validDate(body.date) : null;
  const method = METHODS.includes(body.method) ? body.method : null;
  const payee = str(body.payee, { max: 120 }) ?? '';
  const reference = str(body.reference, { max: 80 }) ?? '';
  const note = str(body.note, { max: 300 }) ?? '';

  if (!category || !EXPENSE_CATEGORIES.includes(category)) return fail('Select an expense category.');
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (body.date && !date) return fail('Invalid date.');

  const rows = await query(
    `INSERT INTO expenses (category, amount, expense_date, method, payee, reference, note, created_by)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8) RETURNING id`,
    [category, round2(amount), date, method, payee, reference, note, auth.user.id]
  );
  return ok({ id: rows[0].id }, 201);
}
