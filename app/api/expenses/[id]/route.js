// PUT    /api/expenses/:id -> edit an expense (admin)
// DELETE /api/expenses/:id -> void (remove) an expense (admin)
// All finance reports derive from the rows, so editing or voiding an
// expense immediately and correctly changes cash flow, P&L and the
// account balances — nothing else is stored to keep in sync.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, round2 } from '@/lib/validate';
import { EXPENSE_CATEGORIES } from '../route.js';

const METHODS = ['cash', 'bank', 'card'];

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail('Invalid expense id.', 404);

  const rows = await query(
    'SELECT id, category, amount, expense_date, method, payee, reference, note FROM expenses WHERE id = $1',
    [id]
  );
  const cur = rows[0];
  if (!cur) return fail('Expense not found.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const category = body.category !== undefined ? str(body.category, { max: 60 }) : cur.category;
  const amount = body.amount !== undefined ? toNumber(body.amount) : Number(cur.amount);
  const date = body.date !== undefined ? validDate(body.date) : cur.expense_date;
  const method =
    body.method !== undefined ? (METHODS.includes(body.method) ? body.method : null) : cur.method;
  const payee = body.payee !== undefined ? (str(body.payee, { max: 120 }) ?? cur.payee) : cur.payee;
  const reference = body.reference !== undefined ? (str(body.reference, { max: 80 }) ?? cur.reference) : cur.reference;
  const note = body.note !== undefined ? (str(body.note, { max: 300 }) ?? cur.note) : cur.note;

  if (!category || !EXPENSE_CATEGORIES.includes(category)) return fail('Select an expense category.');
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (!date) return fail('Invalid date.');

  await query(
    'UPDATE expenses SET category = $1, amount = $2, expense_date = $3, method = $4, payee = $5, reference = $6, note = $7 WHERE id = $8',
    [category, round2(amount), date, method, payee, reference, note, id]
  );
  return ok(null);
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail('Invalid expense id.', 404);

  const res = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [id]);
  if (!res[0]) return fail('Expense not found.', 404);
  return ok(null);
}
