// Customer ledger — the single source of truth for what a customer owes.
//
// ACCOUNTING CONVENTION (unchanged, used everywhere in this app):
//   customer_transactions.amount is SIGNED.
//     amount > 0  -> DEBIT  : the customer owes more
//                              (credit sale, opening balance owed, + adjustment)
//     amount < 0  -> CREDIT : the customer owes less
//                              (recovery/payment, opening credit, - adjustment)
//   balance_after is the RUNNING balance stored on every row, and
//   customers.outstanding_balance must always equal
//       opening balance + total debits - total credits
//     = SUM(customer_transactions.amount) for that customer.
//
// Nothing here is derived from client state: every figure comes from the
// ledger rows, and every write happens inside a transaction that holds a row
// lock on the customer, so concurrent sales/payments can never interleave
// into an inconsistent balance.

/** Ledger entry types (mirrors the CHECK constraint on customer_transactions). */
export const LEDGER_TYPES = ['sale', 'payment', 'adjustment', 'opening_balance'];

/**
 * Largest amount that fits the NUMERIC(12,2) money columns. Every entry point
 * validates against it so an oversized value is a clean 400 instead of a
 * database overflow surfacing as a 500.
 */
export const MAX_LEDGER_AMOUNT = 999999999.99;

/** Round half away from zero to 2dp (money is never left as a raw float). */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Totals for one customer's account, computed from the ledger rows.
 * Returns one row:
 *   opening_balance, sales_debit, adjustments_debit, adjustments_credit,
 *   payments_credit, total_debits, total_credits, ledger_balance,
 *   transaction_count
 *
 * @param {(sql: string, params?: unknown[]) => Promise<any[]>} run
 *        a query function (pool `query` or `client.query` wrapper)
 */
export async function ledgerTotals(run, customerId) {
  const rows = await run(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'opening_balance'), 0) AS opening_balance,
            COALESCE(SUM(amount) FILTER (WHERE type = 'sale'), 0)           AS sales_debit,
            COALESCE(SUM(amount) FILTER (WHERE type = 'adjustment' AND amount >= 0), 0) AS adjustments_debit,
            COALESCE(SUM(-amount) FILTER (WHERE type = 'adjustment' AND amount < 0), 0) AS adjustments_credit,
            COALESCE(SUM(-amount) FILTER (WHERE type = 'payment'), 0)       AS payments_credit,
            COALESCE(SUM(amount), 0)                                        AS ledger_balance,
            COUNT(*)::int                                                   AS transaction_count
       FROM customer_transactions
      WHERE customer_id = $1`,
    [customerId]
  );
  const r = rows[0] || {};
  const num = (v) => Number(v || 0);
  const opening = num(r.opening_balance);
  const salesDebit = num(r.sales_debit);
  const adjDebit = num(r.adjustments_debit);
  const adjCredit = num(r.adjustments_credit);
  const payments = num(r.payments_credit);
  return {
    opening_balance: round2(opening),
    total_purchases_on_credit: round2(salesDebit),
    total_payments: round2(payments),
    total_adjustments: round2(adjDebit - adjCredit),
    total_debits: round2(opening + salesDebit + adjDebit),
    total_credits: round2(payments + adjCredit),
    ledger_balance: round2(num(r.ledger_balance)),
    transaction_count: Number(r.transaction_count || 0),
  };
}

/**
 * Rebuild every running balance from the ledger rows and re-sync the stored
 * outstanding balance. Idempotent: with an untouched ledger it writes back
 * exactly the values already there.
 *
 * Used after a historical edit/delete, and available as an explicit repair
 * action. Rejects (by throwing HttpError) any ledger whose running balance
 * would go negative, matching the rule enforced everywhere else.
 *
 * @param {import('pg').PoolClient} client  (already inside a transaction)
 */
export async function recalculateCustomerLedger(client, customerId, { HttpError }) {
  const lock = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
  if (!lock.rows[0]) throw new HttpError('Customer not found.', 404);

  const rows = (
    await client.query(
      'SELECT id, amount FROM customer_transactions WHERE customer_id = $1 ORDER BY id FOR UPDATE',
      [customerId]
    )
  ).rows;

  let bal = 0;
  for (const r of rows) {
    bal = round2(bal + Number(r.amount));
    if (bal < -0.005) {
      throw new HttpError('This change would make the customer balance negative.', 400);
    }
    await client.query('UPDATE customer_transactions SET balance_after = $1 WHERE id = $2', [bal, r.id]);
  }
  await client.query('UPDATE customers SET outstanding_balance = $1 WHERE id = $2', [bal, customerId]);
  return bal;
}

/**
 * Append a ledger row and update the stored balance atomically.
 * `amount` is the SIGNED amount (positive = the customer owes more).
 *
 * @param {import('pg').PoolClient} client (already inside a transaction)
 */
export async function appendLedgerEntry(client, { customerId, type, amount, note, method, refId, userId }) {
  const signed = round2(amount);
  const cur = await client.query('SELECT outstanding_balance FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
  const before = Number(cur.rows[0]?.outstanding_balance ?? 0);
  const after = round2(before + signed);
  if (after < -0.005) {
    return { error: 'This entry would make the customer balance negative.' };
  }
  await client.query(
    `INSERT INTO customer_transactions
       (customer_id, type, amount, balance_after, ref_id, note, method, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [customerId, type, signed, after, refId ?? null, note ?? '', method ?? null, userId ?? null]
  );
  await client.query('UPDATE customers SET outstanding_balance = $1 WHERE id = $2', [after, customerId]);
  return { error: null, balance: after };
}
