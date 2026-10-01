// Sargable business-date predicates.
//
// Every business date in this app is bucketed in the STORE timezone. The
// obvious way to write that filter —
//
//     (s.created_at AT TIME ZONE $1)::date >= $2
//
// — wraps the indexed column in a function, so PostgreSQL cannot use
// sales_created_idx: it seq-scans the table and evaluates the expression for
// every row (measured: 8.3 ms and 8,945 rows discarded on a 9k-row table,
// growing linearly with history).
//
// The rewrites below express the SAME condition as a half-open range on the
// raw timestamptz column. PostgreSQL still performs the timezone arithmetic
// (so DST-transition days stay correct) but the planner can now use the
// existing index (measured: 0.13 ms, bitmap index scan).
//
// Every helper takes $n parameter references so callers keep full control of
// the parameter list — nothing here injects user input into SQL.

/**
 * `col` falls on or after the business day `dateRef` (YYYY-MM-DD text/date).
 * Parameter order at the call site must be [tz, date].
 */
export function dayGte(col, tzRef, dateRef) {
  return `${col} >= (date_trunc('day', (${dateRef})::timestamp) AT TIME ZONE ${tzRef})`;
}

/**
 * `col` falls on or before the business day `dateRef`. Implemented as
 * `< start of the NEXT day` so a timestamp late in the day is still included
 * and the predicate stays a plain range.
 */
export function dayLte(col, tzRef, dateRef) {
  return `${col} < (date_trunc('day', (${dateRef})::timestamp) + interval '1 day') AT TIME ZONE ${tzRef}`;
}

/** `col` falls strictly before the business day `dateRef` (opening balances). */
export function dayLt(col, tzRef, dateRef) {
  return `${col} < (date_trunc('day', (${dateRef})::timestamp) AT TIME ZONE ${tzRef})`;
}

/**
 * `col` falls inside the business day of `expr` (a SQL expression such as
 * `now()`), i.e. "today in the store timezone". No date parameter needed.
 */
export function sameBusinessDay(col, tzRef, expr = 'now()') {
  const day = `date_trunc('day', ${expr} AT TIME ZONE ${tzRef})`;
  return `${col} >= ${day} AT TIME ZONE ${tzRef}
      AND ${col} < (${day} + interval '1 day') AT TIME ZONE ${tzRef}`;
}

/**
 * `col` falls inside the business month of `expr` ("month to date" style).
 */
export function sameBusinessMonth(col, tzRef, expr = 'now()') {
  const month = `date_trunc('month', ${expr} AT TIME ZONE ${tzRef})`;
  return `${col} >= ${month} AT TIME ZONE ${tzRef}
      AND ${col} < (${month} + interval '1 month') AT TIME ZONE ${tzRef}`;
}
