// GET /api/products/:id/image -> product image (any authenticated user)
// Stored in the database; the product list query never loads image bytes,
// so listings stay fast. Short client cache keeps POS grids snappy.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { notFound } from 'next/navigation';

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();

  const rows = await query('SELECT image_data, image_mime FROM products WHERE id = $1', [productId]);
  const row = rows[0];
  if (!row || !row.image_data) notFound();

  return new Response(Buffer.from(row.image_data), {
    headers: {
      'Content-Type': row.image_mime || 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
