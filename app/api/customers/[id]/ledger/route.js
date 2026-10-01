// POST /api/customers/:id/ledger -> record an OPENING BALANCE or an ADJUSTMENT
//
// The ledger already recorded credit sales (written by /api/sales) and
// recoveries (written by /api/customers/:id/payments). What it could not do
// was start an account with a balance the customer already owed, or correct
// an account without editing history. Both are ordinary, auditable ledger
// entries, so both are written the same way every other entry is:
// one row in customer_transactions + the matching balance update, in a single
// transaction with the customer row locked. Nothing is ever overwritten.
//
// Body: { type: 'opening_balance' | 'adjustment', amount, direction, note?, method? }
//   amount     > 0, at most 999999999.99 (NUMERIC(12,2) headroom)
//   direction  'debit'  -> the customer owes more   (stored positive)
//              'credit' -> the customer owes less   (stored negative)
// The stored balance may never go below zero (same rule as every other path),
// so a credit that exceeds the outstanding balance is rejected, not clamped.
import { query, withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, toNumber, str, fail, ok, HttpError } from '@/lib/validate';
import { MAX_LEDGER_AMOUNT, appendLedgerEntry } from '@/lib/ledger';

const METHODS = ['cash', 'bank', 'card'];

export async function POST(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'customer_management')) {
    return fail('You do not have permission to manage customer accounts.', 403);
  }

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) return fail('Invalid customer id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const type = body.type === 'opening_balance' ? 'opening_balance' : body.type === 'adjustment' ? 'adjustment' : null;
  if (!type) return fail('Ledger entry must be an opening balance or an adjustment.');

  const amount = toNumber(body.amount);
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (amount > MAX_LEDGER_AMOUNT) return fail(`The amount cannot exceed ${MAX_LEDGER_AMOUNT.toFixed(2)}.`);

  const direction = body.direction === 'credit' ? 'credit' : body.direction === 'debit' ? 'debit' : null;
  if (!direction) return fail("Direction must be 'debit' (customer owes more) or 'credit' (customer owes less).");

  const note = str(body.note, { max: 200 }) ?? '';
  if (type === 'adjustment' && !note) return fail('An adjustment needs a note explaining the change.');

  // Optional payment account. Only validated when supplied: an opening
  // balance or a stock/write-off correction is not necessarily a cash event.
  let method = null;
  if (body.method !== undefined && body.method !== null && body.method !== '') {
    if (!METHODS.includes(body.method)) return fail('Payment method must be cash, bank or card.');
    method = body.method;
  }

  try {
    const result = await withTransaction(async (client) => {
      const res = await client.query('SELECT id, name, active FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      const customer = res.rows[0];
      if (!customer) throw new HttpError('Customer not found.', 404);
      if (type === 'opening_balance' && !customer.active) {
        throw new HttpError('This customer is disabled.', 409);
      }

      if (type === 'opening_balance') {
        // "Opening" means the account has no history yet. Once entries exist
        // the correct tool is an adjustment, so the history stays honest.
        const existing = await client.query(
          'SELECT 1 FROM customer_transactions WHERE customer_id = $1 LIMIT 1',
          [customerId]
        );
        if (existing.rows.length > 0) {
          throw new HttpError(
            'This account already has ledger entries — record an adjustment instead of an opening balance.',
            409
          );
        }
      }

      const signed = direction === 'debit' ? amount : -amount;
      const entry = await appendLedgerEntry(client, {
        customerId,
        type,
        amount: signed,
        note: note || (type === 'opening_balance' ? 'Opening balance' : 'Adjustment'),
        method,
        userId: auth.user.id,
      });
      if (entry.error) throw new HttpError(entry.error, 400);
      return entry.balance;
    });
    return ok({ balance: result }, 201);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] ledger entry failed:', err);
    return fail('Unable to record the ledger entry. Please try again.', 500);
  }
}
