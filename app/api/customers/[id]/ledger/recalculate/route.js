// POST /api/customers/:id/ledger/recalculate (admin)
// Rebuild every running balance from the ledger rows and re-sync the stored
// outstanding balance.
//
// Nothing is invented and nothing is deleted: the ledger rows are the input,
// the running balances and customers.outstanding_balance are the output. With
// a healthy account this writes back exactly the values already stored, so it
// is safe to run at any time; with a drifted account it repairs it. If the
// rows themselves imply a negative balance the request is refused rather than
// silently clamped.
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { fail, ok, HttpError } from '@/lib/validate';
import { recalculateCustomerLedger, ledgerTotals } from '@/lib/ledger';

export async function POST(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) return fail('Invalid customer id.', 404);

  try {
    const result = await withTransaction(async (client) => {
      const balance = await recalculateCustomerLedger(client, customerId, { HttpError });
      const totals = await ledgerTotals(
        (sql, p) => client.query(sql, p).then((r) => r.rows),
        customerId
      );
      return { balance, totals };
    });
    return ok(result);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[customers] ledger recalculate failed:', err);
    return fail('Unable to recalculate the ledger. Please try again.', 500);
  }
}
