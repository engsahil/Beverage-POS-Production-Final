// PUT    /api/customers/:id/transactions/:txnId -> edit a ledger row (admin)
// DELETE /api/customers/:id/transactions/:txnId -> remove a ledger row (admin)
//
// Historical edits recalculate, never overwrite: after the change the
// running balance of EVERY following row and the customer's outstanding
// balance are recomputed from scratch, inside one transaction with row
// locks. If the edit would push the customer's balance below zero it is
// rejected.
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, fail, ok, round2, HttpError } from '@/lib/validate';

const METHODS = ['cash', 'bank', 'card'];

// change: { mode: 'edit', id, type, amount } or { mode: 'delete', id }
async function recalc(customerId, client, change) {
  const lock = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
  if (!lock.rows[0]) throw new HttpError('Customer not found.', 404);

  const rows = (
    await client.query(
      'SELECT id, type, amount FROM customer_transactions WHERE customer_id = $1 ORDER BY id FOR UPDATE',
      [customerId]
    )
  ).rows;

  // Apply the change to the working list (sign follows the row type:
  // 'sale' rows are positive credits, 'payment' rows are negative).
  let list = rows.map((r) => ({ id: r.id, type: r.type, amount: Number(r.amount) }));
  if (change.mode === 'edit') {
    const idx = list.findIndex((r) => r.id === change.id);
    if (idx === -1) throw new HttpError('Ledger entry not found.', 404);
    list[idx].amount = change.type === 'sale' ? round2(Math.abs(change.amount)) : round2(-Math.abs(change.amount));
  } else if (change.mode === 'delete') {
    list = list.filter((r) => r.id !== change.id);
  }

  // Recompute running balances from zero.
  let bal = 0;
  for (const r of list) {
    bal = round2(bal + r.amount);
    if (bal < -0.005) throw new HttpError('This change would make the customer balance negative.', 400);
    await client.query('UPDATE customer_transactions SET balance_after = $1 WHERE id = $2', [bal, r.id]);
  }
  await client.query('UPDATE customers SET outstanding_balance = $1 WHERE id = $2', [bal, customerId]);
  return bal;
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id, txnId } = await params;
  const customerId = Number(id);
  const editId = Number(txnId);
  if (!Number.isInteger(customerId) || !Number.isInteger(editId)) return fail('Invalid ledger entry.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const amount = toNumber(body.amount);
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  const method =
    body.method !== undefined ? (METHODS.includes(body.method) ? body.method : null) : undefined;
  const note = body.note !== undefined ? (str(body.note, { max: 200 }) ?? '') : undefined;

  try {
    const balance = await withTransaction(async (client) => {
      const rows = await client.query(
        'SELECT id, type FROM customer_transactions WHERE id = $1 AND customer_id = $2',
        [editId, customerId]
      );
      const row = rows.rows[0];
      if (!row) throw new HttpError('Ledger entry not found.', 404);
      if (row.type === 'payment' && method !== undefined) {
        await client.query('UPDATE customer_transactions SET method = $1 WHERE id = $2', [method, editId]);
      }
      if (note !== undefined) {
        await client.query('UPDATE customer_transactions SET note = $1 WHERE id = $2', [note, editId]);
      }
      return recalc(customerId, client, { mode: 'edit', id: editId, type: row.type, amount });
    });
    return ok({ balance });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] ledger edit failed:', err);
    return fail('Unable to update the ledger entry. Please try again.', 500);
  }
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id, txnId } = await params;
  const customerId = Number(id);
  const editId = Number(txnId);
  if (!Number.isInteger(customerId) || !Number.isInteger(editId)) return fail('Invalid ledger entry.', 404);

  try {
    const balance = await withTransaction(async (client) => {
      const rows = await client.query(
        'DELETE FROM customer_transactions WHERE id = $1 AND customer_id = $2 RETURNING id',
        [editId, customerId]
      );
      if (!rows.rows[0]) throw new HttpError('Ledger entry not found.', 404);
      return recalc(customerId, client, { mode: 'delete', id: editId });
    });
    return ok({ balance });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] ledger delete failed:', err);
    return fail('Unable to remove the ledger entry. Please try again.', 500);
  }
}
