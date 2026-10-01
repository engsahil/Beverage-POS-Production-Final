// POST /api/customers/:id/payments -> record a recovery/payment
// Atomic: balance update and ledger entry happen in one transaction.
// Money is handled as NUMERIC (decimal) end to end — never floats in SQL.
import { withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, toNumber, str, fail, ok, round2, HttpError } from '@/lib/validate';
import { MAX_LEDGER_AMOUNT } from '@/lib/ledger';

export async function POST(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'customer_credit')) {
    return fail('You do not have permission to record customer payments.', 403);
  }

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) return fail('Invalid customer id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const amount = toNumber(body.amount);
  const note = str(body.note, { max: 200 }) ?? '';
  const method = ['cash', 'bank', 'card'].includes(body.method) ? body.method : null;
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (amount > MAX_LEDGER_AMOUNT) return fail(`The amount cannot exceed ${MAX_LEDGER_AMOUNT.toFixed(2)}.`);
  if (!method) return fail('Select the payment method (cash, bank or card).');

  try {
    const result = await withTransaction(async (client) => {
      const res = await client.query('SELECT id, name, active, outstanding_balance FROM customers WHERE id = $1 FOR UPDATE', [
        customerId,
      ]);
      const customer = res.rows[0];
      if (!customer) throw new HttpError('Customer not found.', 404);
      if (!customer.active) throw new HttpError('This customer is disabled.', 409);

      const outstanding = Number(customer.outstanding_balance);
      if (amount > outstanding + 0.001) {
        throw new HttpError(
          `Recovery amount exceeds the outstanding balance (${outstanding.toFixed(2)}).`,
          400
        );
      }

      const newBalance = round2(outstanding - amount);
      await client.query('UPDATE customers SET outstanding_balance = $1 WHERE id = $2', [
        newBalance,
        customerId,
      ]);
      // Negate in JS, never in SQL (pg: unary minus on a bind param is ambiguous).
      const signedAmount = -round2(amount);
      await client.query(
        `INSERT INTO customer_transactions (customer_id, type, amount, balance_after, note, method, created_by)
         VALUES ($1, 'payment', $2, $3, $4, $5, $6)`,
        [customerId, signedAmount, newBalance, note, method, auth.user.id]
      );
      return { newBalance };
    });
    return ok({ balance: result.newBalance }, 201);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] payment failed:', err);
    return fail('Unable to record the payment. Please try again.', 500);
  }
}
