// GET /api/products/:id/variants/:variantId/image -> size image (authenticated)
// Stored in the database; listings never load image bytes.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { notFound } from 'next/navigation';

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id, variantId } = await params;
  const productId = Number(id);
  const vid = Number(variantId);
  if (!Number.isInteger(productId) || !Number.isInteger(vid)) notFound();

  const rows = await query(
    'SELECT image_data, image_mime FROM product_variants WHERE id = $1 AND product_id = $2',
    [vid, productId]
  );
  const row = rows[0];
  if (!row || !row.image_data) notFound();

  return new Response(Buffer.from(row.image_data), {
    headers: {
      'Content-Type': row.image_mime || 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
