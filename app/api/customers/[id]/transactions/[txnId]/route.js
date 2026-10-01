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
import { MAX_LEDGER_AMOUNT, recalculateCustomerLedger } from '@/lib/ledger';

const METHODS = ['cash', 'bank', 'card'];

// Apply the amount of a historical edit, then recompute every running
// balance. The sign always follows the row's type ('sale' rows are positive
// debits, everything else is a negative credit) so an edit can never flip an
// entry into the wrong direction. The shared recalculation lives in
// lib/ledger.js so the explicit repair endpoint uses the same rule.
async function applyEditAndRecalc(client, customerId, { id, type, amount }) {
  const signed = type === 'sale' ? round2(Math.abs(amount)) : round2(-Math.abs(amount));
  const rows = await client.query('UPDATE customer_transactions SET amount = $1 WHERE id = $2 RETURNING id', [
    signed,
    id,
  ]);
  if (!rows.rows[0]) throw new HttpError('Ledger entry not found.', 404);
  return recalculateCustomerLedger(client, customerId, { HttpError });
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
  if (amount > MAX_LEDGER_AMOUNT) return fail(`The amount cannot exceed ${MAX_LEDGER_AMOUNT.toFixed(2)}.`);
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
      return applyEditAndRecalc(client, customerId, { id: editId, type: row.type, amount });
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
      return recalculateCustomerLedger(client, customerId, { HttpError });
    });
    return ok({ balance });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] ledger delete failed:', err);
    return fail('Unable to remove the ledger entry. Please try again.', 500);
  }
}
