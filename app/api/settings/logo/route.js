// GET   /api/settings/logo -> logo bytes (any authenticated user)
// PUT   /api/settings/logo -> upload/replace the business logo (admin)
// DELETE /api/settings/logo -> remove it (admin)
// Stored in the database; every branding spot (admin shell, POS header,
// printed receipts) reads from here — the name/logo are never hard-coded.
import { query } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { getLogo } from '@/lib/settings';
import { readJson, fail, ok } from '@/lib/validate';

const MAX_BYTES = 256 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const logo = await getLogo();
  if (!logo || !logo.logo_data) return fail('No logo set.', 404);
  return new Response(Buffer.from(logo.logo_data), {
    headers: {
      'Content-Type': logo.logo_mime || 'image/png',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export async function PUT(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  if (typeof body.data !== 'string' || !body.data.startsWith('data:')) {
    return fail('Invalid image data.');
  }
  const match = body.data.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!match) return fail('Invalid image format.');
  const mime = match[1].toLowerCase();
  if (!ALLOWED.includes(mime)) return fail('Logo must be a JPG, PNG, WebP or SVG file.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return fail('The image is empty.');
  if (buffer.length > MAX_BYTES) {
    return fail('Logo is too large (max 256 KB). The client resizes to 512px — try a smaller image.');
  }

  await query(
    `INSERT INTO business_settings (id, logo_data, logo_mime, logo_updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET logo_data = EXCLUDED.logo_data,
       logo_mime = EXCLUDED.logo_mime,
       logo_updated_at = now()`,
    [buffer, mime]
  );
  return ok({ size: buffer.length }, 201);
}

export async function DELETE(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await query('UPDATE business_settings SET logo_data = NULL, logo_mime = NULL, logo_updated_at = now() WHERE id = 1');
  return ok(null);
}
