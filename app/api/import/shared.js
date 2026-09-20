// Shared helpers for import preview + apply.
import { query } from '@/lib/db';
import { toNumber } from '@/lib/validate';

export function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export function validateRow(entity, r, rowNo) {
  const spec = ENTITIES[entity];
  const missing = spec.require.filter((f) => !(r[f] ?? ''));
  if (missing.length) return `Missing: ${missing.join(', ')}`;
  if ((r.name ?? '').length > 120) return 'Name is too long (max 120).';
  if (entity === 'products') {
    const price = toNumber(r.price);
    if (price === null || price < 0) return 'Price must be a number of 0 or more.';
    for (const f of ['cost', 'stock', 'min_stock', 'min_price']) {
      const val = r[f] ?? '';
      if (val !== '' && toNumber(val) === null) return `${f} must be a number.`;
    }
    if ((r.expiry_date ?? '') !== '' && !parseDate(r.expiry_date)) return 'expiry_date must be YYYY-MM-DD.';
  }
  if (entity === 'customers' && (r.phone ?? '').length > 30) return 'Phone is too long (max 30).';
  return null;
}

export const ENTITIES = {
  products: {
    require: ['name', 'price'],
    optional: ['barcode', 'category', 'cost', 'stock', 'min_stock', 'min_price', 'expiry_date'],
  },
  customers: {
    require: ['name'],
    optional: ['phone', 'address', 'notes'],
  },
  vendors: {
    require: ['name'],
    optional: [],
  },
};

export function keyFor(entity, r) {
  if (entity === 'products') return r.barcode ? `b:${r.barcode}` : `n:${r.name.toLowerCase()}`;
  if (entity === 'customers') return r.phone ? `p:${r.phone}` : `n:${r.name.toLowerCase()}`;
  return `n:${r.name.toLowerCase()}`;
}

/**
 * Duplicates already in the database.
 * Accepts a pg client (transaction) or the pool-level query() helper.
 * (client.query returns { rows }, the pool helper returns rows directly.)
 */
export async function findDuplicates(exec, entity, rows) {
  const run = async (text, params) => {
    // exec is either a pg client (transaction) or the pool-level query() helper.
    if (typeof exec === 'function') return exec(text, params); // returns rows
    const res = await exec.query(text, params); // returns { rows }
    return res.rows;
  };
  const dupes = new Set();
  if (entity === 'products') {
    const barcodes = [...new Set(rows.map((r) => r.barcode).filter(Boolean))];
    const names = [...new Set(rows.map((r) => r.name.toLowerCase()))];
    if (barcodes.length) {
      const res = await run('SELECT barcode FROM products WHERE barcode = ANY($1::text[])', [barcodes]);
      res.forEach((r) => dupes.add(`b:${r.barcode}`));
    }
    if (names.length) {
      const res = await run('SELECT name FROM products WHERE LOWER(name) = ANY($1::text[])', [names]);
      res.forEach((r) => dupes.add(`n:${r.name.toLowerCase()}`));
    }
  } else if (entity === 'customers') {
    const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))];
    const names = [...new Set(rows.map((r) => r.name.toLowerCase()))];
    if (phones.length) {
      const res = await run('SELECT phone FROM customers WHERE phone = ANY($1::text[])', [phones]);
      res.forEach((r) => dupes.add(`p:${r.phone}`));
    }
    if (names.length) {
      const res = await run('SELECT name FROM customers WHERE LOWER(name) = ANY($1::text[])', [names]);
      res.forEach((r) => dupes.add(`n:${r.name.toLowerCase()}`));
    }
  } else if (entity === 'vendors') {
    const names = [...new Set(rows.map((r) => r.name.toLowerCase()))];
    if (names.length) {
      const res = await run('SELECT name FROM vendors WHERE LOWER(name) = ANY($1::text[])', [names]);
      res.forEach((r) => dupes.add(`n:${r.name.toLowerCase()}`));
    }
  }
  return dupes;
}
