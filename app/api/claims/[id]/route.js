// PUT /api/claims/:id -> settle a pending claim (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId)) return fail('Invalid claim id.', 404);

  const rows = await query('SELECT * FROM vendor_claims WHERE id = $1', [claimId]);
  const claim = rows[0];
  if (!claim) return fail('Claim not found.', 404);
  if (claim.status !== 'pending') return fail('This claim is already settled.', 409);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const adjustmentRef = str(body.adjustmentRef, { max: 120 }) ?? '';
  const note = body.note !== undefined ? str(body.note, { max: 300 }) ?? '' : claim.note;

  await query(
    `UPDATE vendor_claims
        SET status = 'settled', settled_at = now(), adjustment_ref = $1, note = $2
      WHERE id = $3`,
    [adjustmentRef, note, claimId]
  );
  return ok(null);
}
