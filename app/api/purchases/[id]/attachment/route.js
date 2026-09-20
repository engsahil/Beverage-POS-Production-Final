// GET   /api/purchases/:id/attachment -> file bytes (admin)
// PUT   /api/purchases/:id/attachment -> attach/replace the invoice file
// DELETE /api/purchases/:id/attachment -> remove it
// The attachment belongs to the purchase, so editing payments or the
// invoice never touches it.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, fail, ok } from '@/lib/validate';
import { parseAttachment } from '../../../file-attachment.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const purchaseId = Number((await params).id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const rows = await query('SELECT attachment_data, attachment_mime, attachment_name FROM purchases WHERE id = $1', [
    purchaseId,
  ]);
  const row = rows[0];
  if (!row || !row.attachment_data) return fail('No attachment on this purchase.', 404);

  const disposition = row.attachment_mime === 'application/pdf' ? 'inline' : 'attachment';
  return new Response(Buffer.from(row.attachment_data), {
    headers: {
      'Content-Type': row.attachment_mime || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${(row.attachment_name || 'attachment').replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const purchaseId = Number((await params).id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const parsed = parseAttachment(body.data, body.name);
  if (parsed.error) return fail(parsed.error, 400);

  const res = await query(
    'UPDATE purchases SET attachment_data = $1, attachment_mime = $2, attachment_name = $3 WHERE id = $4 RETURNING id',
    [parsed.buffer, parsed.mime, parsed.name, purchaseId]
  );
  if (!res[0]) return fail('Purchase not found.', 404);
  return ok({ name: parsed.name, size: parsed.buffer.length }, 201);
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const purchaseId = Number((await params).id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const res = await query(
    'UPDATE purchases SET attachment_data = NULL, attachment_mime = NULL, attachment_name = NULL WHERE id = $1 RETURNING id',
    [purchaseId]
  );
  if (!res[0]) return fail('Purchase not found.', 404);
  return ok(null);
}
