// Shared finance calculations.
//
// Money never travels as floats: every sum is done in SQL on NUMERIC
// columns and only converted to Number() at the response boundary.
//
// The four sources of cash movement (and their natural dates):
//   sales              IN   sales.paid by payment_method      (created_at, tz-aware)
//   customer payments  IN   -customer_transactions.amount     (created_at, tz-aware)
//                        where type = 'payment' and method is set
//   vendor payments    OUT  purchase_payments.amount by method (payment_date)
//   expenses           OUT  expenses.amount by method         (expense_date)
//                        legacy expenses have method = NULL -> "unspecified"
import { dayGte, dayLte, dayLt } from './date-range.js';

/**
 * Build a single-row query that returns the account balances for the
 * cash / bank / card accounts plus the legacy "unspecified" expense total.
 *
 * mode: 'all'    -> entire history (current balances)
 *       'before' -> everything strictly before `from` (opening balances)
 *       'range'  -> `from` .. `to` inclusive
 *
 * Returns { sql, params } where params starts with [timezone, ...dates].
 */
// Caller passes the business timezone; params layout is [tz?, from?, to?]
// depending on mode — pg rejects unused parameters, so 'all' has none.
export function accountBalanceQuery({ mode, from, to, tz }) {
  const params = [];
  const useTz = mode !== 'all';
  if (useTz) params.push(tz);
  const tzRef = `$1`;

  // Timestamp columns are filtered as half-open ranges on the raw column
  // (see lib/date-range.js) so the indexes stay usable; DATE columns
  // (purchase_payments.payment_date, expenses.expense_date) are compared
  // directly, which was already index-friendly.
  let salesF = '', ctF = '', ppF = '', expF = '';
  if (mode === 'before') {
    params.push(from);
    const f = `$${params.length}`;
    salesF = `AND ${dayLt('s.created_at', tzRef, f)}`;
    ctF = `AND ${dayLt('ct.created_at', tzRef, f)}`;
    ppF = `AND pp.payment_date < ${f}`;
    expF = `AND e.expense_date < ${f}`;
  } else if (mode === 'range') {
    params.push(from, to);
    const f = `$${params.length - 1}`;
    const t = `$${params.length}`;
    salesF = `AND ${dayGte('s.created_at', tzRef, f)} AND ${dayLte('s.created_at', tzRef, t)}`;
    ctF = `AND ${dayGte('ct.created_at', tzRef, f)} AND ${dayLte('ct.created_at', tzRef, t)}`;
    ppF = `AND pp.payment_date BETWEEN ${f} AND ${t}`;
    expF = `AND e.expense_date BETWEEN ${f} AND ${t}`;
  }

  const account = (m) => `
    (SELECT COALESCE(SUM(s.paid), 0) FROM sales s WHERE s.payment_method = '${m}' ${salesF})
  + (SELECT COALESCE(SUM(-ct.amount), 0) FROM customer_transactions ct
        WHERE ct.type = 'payment' AND ct.method = '${m}' ${ctF})
  - (SELECT COALESCE(SUM(pp.amount), 0) FROM purchase_payments pp WHERE pp.method = '${m}' ${ppF})
  - (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.method = '${m}' ${expF})`;

  const sql = `
    SELECT
      ${account('cash')} AS cash,
      ${account('bank')} AS bank,
      ${account('card')} AS card,
      (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.method IS NULL ${expF}) AS unspecified
  `;
  return { sql, params };
}

/**
 * Per-method totals for the period from..to (inclusive), one query each:
 * sales paid, customer payments, vendor payments, expenses.
 * Caller passes tz as first param.
 */
// Each query carries its OWN params: sales/customer take [tz, from, to]
// (timestamptz columns need the business timezone); vendor/expenses use
// DATE columns and take [from, to]. pg rejects unused parameters, so the
// layouts must match the $n references exactly.
export function periodFlowQueries({ from, to, tz }) {
  const sales = {
    sql: `SELECT s.payment_method AS method, COALESCE(SUM(s.paid), 0) AS total
           FROM sales s
          WHERE ${dayGte('s.created_at', '$1', '$2')} AND ${dayLte('s.created_at', '$1', '$3')}
          GROUP BY s.payment_method`,
    params: [tz, from, to],
  };
  const customer = {
    sql: `SELECT ct.method AS method, COALESCE(SUM(-ct.amount), 0) AS total
           FROM customer_transactions ct
          WHERE ct.type = 'payment' AND ct.method IS NOT NULL
            AND ${dayGte('ct.created_at', '$1', '$2')} AND ${dayLte('ct.created_at', '$1', '$3')}
          GROUP BY ct.method`,
    params: [tz, from, to],
  };
  const vendor = {
    sql: `SELECT pp.method AS method, COALESCE(SUM(pp.amount), 0) AS total
           FROM purchase_payments pp
          WHERE pp.payment_date BETWEEN $1 AND $2
          GROUP BY pp.method`,
    params: [from, to],
  };
  const expenses = {
    sql: `SELECT COALESCE(e.method, 'unspecified') AS method, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
          WHERE e.expense_date BETWEEN $1 AND $2
          GROUP BY 1`,
    params: [from, to],
  };
  return { sales, customer, vendor, expenses };
}
