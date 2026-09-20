// GET/PUT/DELETE /api/expenses/:id/attachment (admin)
// Receipt or supporting document for one expense.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, fail, ok } from '@/lib/validate';
import { parseAttachment } from '../../../file-attachment.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail('Invalid expense id.', 404);

  const rows = await query('SELECT attachment_data, attachment_mime, attachment_name FROM expenses WHERE id = $1', [id]);
  const row = rows[0];
  if (!row || !row.attachment_data) return fail('No attachment on this expense.', 404);

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
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail('Invalid expense id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const parsed = parseAttachment(body.data, body.name);
  if (parsed.error) return fail(parsed.error, 400);

  const res = await query(
    'UPDATE expenses SET attachment_data = $1, attachment_mime = $2, attachment_name = $3 WHERE id = $4 RETURNING id',
    [parsed.buffer, parsed.mime, parsed.name, id]
  );
  if (!res[0]) return fail('Expense not found.', 404);
  return ok({ name: parsed.name, size: parsed.buffer.length }, 201);
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail('Invalid expense id.', 404);

  const res = await query(
    'UPDATE expenses SET attachment_data = NULL, attachment_mime = NULL, attachment_name = NULL WHERE id = $1 RETURNING id',
    [id]
  );
  if (!res[0]) return fail('Expense not found.', 404);
  return ok(null);
}
