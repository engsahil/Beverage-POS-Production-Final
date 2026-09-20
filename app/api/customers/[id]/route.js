// GET /api/customers/:id            -> detail + ledger (customer_management)
// PUT /api/customers/:id            -> edit (admin or customer_management)
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, str, fail, ok } from '@/lib/validate';

function canManage(user) {
  return hasPermission(user, 'customer_management');
}

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) return fail('Invalid customer id.', 404);

  const rows = await query(
    `SELECT c.id, c.name, c.phone, c.address, c.notes, c.active, c.outstanding_balance, c.created_at
       FROM customers c WHERE c.id = $1`,
    [customerId]
  );
  const customer = rows[0];
  if (!customer) return fail('Customer not found.', 404);
  if (!canManage(auth.user) && !customer.active) return fail('Customer not found.', 404);

  const ledger = await query(
    `SELECT ct.id, ct.type, ct.amount, ct.balance_after, ct.method, ct.ref_id, ct.note, ct.created_at,
            u.full_name AS user_name,
            s.sale_no
       FROM customer_transactions ct
       LEFT JOIN users u ON u.id = ct.created_by
       LEFT JOIN sales s ON s.id = ct.ref_id AND ct.type = 'sale'
      WHERE ct.customer_id = $1
      ORDER BY ct.id DESC
      LIMIT 200`,
    [customerId]
  );
  return ok({ customer, ledger });
}

export async function PUT(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!canManage(auth.user)) return fail('You do not have permission to manage customers.', 403);

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) return fail('Invalid customer id.', 404);

  const rows = await query('SELECT * FROM customers WHERE id = $1', [customerId]);
  const customer = rows[0];
  if (!customer) return fail('Customer not found.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const name = body.name !== undefined ? str(body.name, { max: 80 }) : customer.name;
  const phone = body.phone !== undefined ? str(body.phone, { max: 30 }) ?? '' : customer.phone;
  const address = body.address !== undefined ? str(body.address, { max: 200 }) ?? '' : customer.address;
  const notes = body.notes !== undefined ? str(body.notes, { max: 300 }) ?? '' : customer.notes;
  const active = typeof body.active === 'boolean' ? body.active : customer.active;

  if (!name) return fail('Customer name is required.');

  await query(
    'UPDATE customers SET name = $1, phone = $2, address = $3, notes = $4, active = $5 WHERE id = $6',
    [name, phone, address, notes, active, customerId]
  );
  return ok(null);
}
