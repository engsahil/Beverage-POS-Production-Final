// Acceptance suite: TOTAL COST ACROSS THE WHOLE ITEM HIERARCHY + CUSTOMER LEDGER.
//
// Runs against a LIVE instance (BASE_URL, default http://127.0.0.1:3002) with
// the admin account, and cross-checks every API figure against an INDEPENDENT
// SQL query run straight against the database (DATABASE_URL) — so the test
// cannot pass by agreeing with the application's own (possibly wrong) SQL.
//
//   A  total cost / value
//      - the brief's worked example (Category -> items, expected 1,500)
//      - a nested product whose 500ml / 1000ml / 1500ml sizes each own a cost
//      - dashboard == balance sheet == inventory report == product list
//      - category-scoped subtotals
//      - zero cost, decimal cost, blank cost, editing, deleting, adding
//   B  ledger
//      - opening balance, credit sale, partial + multiple payments
//      - Opening + Debits - Credits == stored balance (and every row's
//        running balance), history pagination, validation limits
//
// Usage:
//   DATABASE_URL=postgres://... BASE_URL=http://127.0.0.1:3002 \
//     node scripts/e2e/total-cost-ledger.mjs
import pg from 'pg';
import { loadEnv } from '../env.mjs';

loadEnv();

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3002';
const TAG = `AUDIT${Date.now().toString().slice(-6)}`;

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  FAIL  ${name} ${extra}`);
  }
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const eq = (name, a, b) => check(name, Math.abs(Number(a) - Number(b)) <= 0.005, `got ${a}, expected ${b}`);

// --- tiny cookie jar -------------------------------------------------
function jar() {
  return { cookies: [] };
}
async function call(j, path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (j.cookies.length) headers.Cookie = j.cookies.map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    j.cookies = j.cookies.filter((x) => !x.startsWith(name + '='));
    const value = pair.split('=').slice(1).join('=');
    if (value !== '' && value !== 'deleted') j.cookies.push(pair);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body: data, data: data && data.data };
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

/**
 * Ground truth for the inventory value at cost, written from the DATA MODEL
 * and deliberately NOT sharing any code with the application:
 *   every variant row contributes variant.stock * variant.cost
 *   every product WITHOUT variant rows contributes product.stock * product.cost
 * A product with sizes never contributes its own product-level figure.
 */
async function dbInventoryValue({ categoryId = null, names = null } = {}) {
  const params = [];
  let prodWhere = 'p.active';
  if (categoryId) {
    params.push(categoryId);
    prodWhere += ` AND p.category_id = $${params.length}`;
  }
  if (names) {
    params.push(names);
    prodWhere += ` AND p.name = ANY($${params.length}::text[])`;
  }
  const res = await db.query(
    `SELECT COALESCE(SUM(v.stock * v.cost), 0)::float AS total
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE ${prodWhere}
      UNION ALL
     SELECT COALESCE(SUM(p.stock * p.cost), 0)::float AS total
       FROM products p
      WHERE ${prodWhere}
        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`,
    params
  );
  return r2(res.rows.reduce((s, r) => s + Number(r.total), 0));
}

async function main() {
  await db.connect();
  const admin = jar();
  const login = await call(admin, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin123' },
  });
  if (login.status !== 200) {
    console.error('login failed — cannot run the acceptance suite');
    process.exit(1);
  }

  // ================= A. TOTAL COST / VALUE =================
  console.log('\nA. TOTAL COST ACROSS THE ITEM HIERARCHY');

  // --- the brief's worked example: Category A with nested items ---------
  const catA = (await call(admin, '/api/categories', { method: 'POST', body: { name: `${TAG} A` } })).data?.id;
  const catA1 = (await call(admin, '/api/categories', { method: 'POST', body: { name: `${TAG} A1` } })).data?.id;
  check('category A created', Boolean(catA));
  check('sub-category A1 created', Boolean(catA1));

  const mk = async (name, categoryId, extra) =>
    (await call(admin, '/api/products', { method: 'POST', body: { name, categoryId, ...extra } })).data?.id;

  // Items 1-5, one unit each, exactly the amounts in the brief.
  const item1 = await mk(`${TAG} Item 1`, catA, { price: 150, cost: 100, stock: 1 });
  const item2 = await mk(`${TAG} Item 2`, catA, { price: 250, cost: 200, stock: 1 });
  const item3 = await mk(`${TAG} Item 3`, catA1, { price: 350, cost: 300, stock: 1 });
  // "Variant 500ml" as its own product, and "Sub-variant 500ml Special".
  const item4 = await mk(`${TAG} Item 4`, catA, { price: 450, cost: 400, stock: 1 });
  const item5 = await mk(`${TAG} Item 5`, catA, { price: 550, cost: 500, stock: 1 });
  check('five items created', [item1, item2, item3, item4, item5].every(Boolean));

  const briefTotal = await dbInventoryValue({ names: [`${TAG} Item 1`, `${TAG} Item 2`, `${TAG} Item 3`, `${TAG} Item 4`, `${TAG} Item 5`] });
  eq('brief example: 100+200+300+400+500 = 1500 (database)', briefTotal, 1500);

  // The same five products as the product API reports them.
  let listed = (await call(admin, `/api/products?search=${encodeURIComponent(TAG)}`)).data?.products || [];
  const fiveNames = new Set([`${TAG} Item 1`, `${TAG} Item 2`, `${TAG} Item 3`, `${TAG} Item 4`, `${TAG} Item 5`]);
  const apiFiveTotal = r2(
    listed.filter((p) => fiveNames.has(p.name)).reduce((s, p) => s + Number(p.stock_value || 0), 0)
  );
  eq('brief example: product API stock_value sums to 1500', apiFiveTotal, 1500);

  // --- a deeply nested product: one cost per size ----------------------
  const nested = await mk(`${TAG} Nested Cola`, catA, {
    price: 100,
    cost: 0, // the product-level cost is deliberately 0 — the real costs live on the sizes
    stock: 0,
    variants: [
      { name: '500ml', price: 60, cost: 40, stock: 10 },
      { name: '1000ml', price: 110, cost: 75.5, stock: 4 },
      { name: '1500ml', price: 160, cost: 110.25, stock: 2 },
      { name: 'Free sample', price: 0, cost: 0, stock: 5 }, // zero cost must count as 0, not be skipped
      { name: 'Mini', price: 25, cost: 12.34, stock: 3 }, // decimals
    ],
  });
  check('nested product with 5 sizes created', Boolean(nested));
  listed = (await call(admin, `/api/products?search=${encodeURIComponent(TAG)}`)).data?.products || [];
  // 10*40 + 4*75.50 + 2*110.25 + 5*0 + 3*12.34 = 400 + 302 + 220.50 + 0 + 37.02
  const nestedExpected = r2(10 * 40 + 4 * 75.5 + 2 * 110.25 + 5 * 0 + 3 * 12.34);
  const nestedDb = await dbInventoryValue({ names: [`${TAG} Nested Cola`] });
  eq('nested sizes: database value includes every size', nestedDb, nestedExpected);
  const nestedApi = listed.find((p) => p.name === `${TAG} Nested Cola`);
  eq('nested sizes: product API value includes every size', nestedApi?.stock_value, nestedExpected);
  check('nested product with a 0 product-level cost is NOT reported as 0', Number(nestedApi?.stock_value) > 0);

  // --- every screen must show the same number -------------------------
  const [dash, bs, report, productsAll] = await Promise.all([
    call(admin, '/api/dashboard'),
    call(admin, '/api/finance/balance-sheet'),
    call(admin, '/api/reports/inventory'),
    call(admin, '/api/products'),
  ]);
  const truth = await dbInventoryValue();
  eq('dashboard stock_value == database total', dash.data?.inventory?.stock_value, truth);
  eq('balance sheet inventory == database total', bs.data?.assets?.inventory, truth);
  const reportTotal = r2((report.data?.rows || []).reduce((s, r) => s + Number(r.value), 0));
  eq('inventory report rows sum == database total', reportTotal, truth);
  const listTotal = r2((productsAll.data?.products || []).reduce((s, p) => s + Number(p.stock_value || 0), 0));
  eq('product list stock_value sums == database total', listTotal, truth);
  check('dashboard and balance sheet agree with each other',
    Math.abs(Number(dash.data?.inventory?.stock_value) - Number(bs.data?.assets?.inventory)) <= 0.005);
  check('inventory report exposes a Sizes column', (report.data?.columns || []).some((c) => c.key === 'sizes'));
  const nestedRow = (report.data?.rows || []).find((r) => r.product === `${TAG} Nested Cola`);
  eq('inventory report row for the nested product', nestedRow?.value, nestedExpected);
  check('inventory report flags the nested product as having 5 sizes', Number(nestedRow?.sizes) === 5);

  // --- category scope -------------------------------------------------
  const catProducts = (productsAll.data?.products || []).filter((p) => String(p.category_id) === String(catA));
  const catApiTotal = r2(catProducts.reduce((s, p) => s + Number(p.stock_value || 0), 0));
  const catDbTotal = await dbInventoryValue({ categoryId: catA });
  eq('category-scoped total (client sum of server values) == database', catApiTotal, catDbTotal);
  const subDbTotal = await dbInventoryValue({ categoryId: catA1 });
  eq('sub-category-scoped total == database', subDbTotal, 300);
  check('category scope is a strict subset of the whole', catApiTotal < listTotal && subDbTotal < listTotal);

  // --- edit / delete / add keep the total exact -----------------------
  const variantsOf = async (id) => {
    const d = (await call(admin, `/api/products?search=${encodeURIComponent(`${TAG} Nested Cola`)}`)).data?.products;
    return (d.find((p) => p.id === id) || {}).variants || [];
  };
  let vs = await variantsOf(nested);
  const v500 = vs.find((v) => v.name === '500ml');
  await call(admin, `/api/products/${nested}`, {
    method: 'PUT',
    body: { variants: [{ id: v500.id, name: '500ml', price: 60, cost: 55, stock: 10 }] },
  });
  const afterEdit = await dbInventoryValue({ names: [`${TAG} Nested Cola`] });
  eq('editing a size cost moves the total by exactly the delta', afterEdit, r2(nestedExpected + 10 * (55 - 40)));

  await call(admin, `/api/products/${nested}/variants/${v500.id}`, { method: 'DELETE' });
  const afterDelete = await dbInventoryValue({ names: [`${TAG} Nested Cola`] });
  eq('deleting a size removes exactly its value', afterDelete, r2(afterEdit - 10 * 55));

  vs = await variantsOf(nested);
  await call(admin, `/api/products/${nested}`, {
    method: 'PUT',
    body: {
      variants: [
        ...vs.map((v) => ({ id: v.id, name: v.name, price: Number(v.price), cost: Number(v.cost), stock: Number(v.stock) })),
        { name: '2000ml', price: 200, cost: 150, stock: 6 },
      ],
    },
  });
  const afterAdd = await dbInventoryValue({ names: [`${TAG} Nested Cola`] });
  eq('adding a size adds exactly its value', afterAdd, r2(afterDelete + 6 * 150));

  const dashAfter = (await call(admin, '/api/dashboard')).data?.inventory?.stock_value;
  eq('dashboard total tracks the edits immediately', dashAfter, await dbInventoryValue());

  // --- null / blank / zero costs are safe -----------------------------
  const blankCost = await mk(`${TAG} Blank Cost`, catA, { price: 50, cost: '', stock: 7 });
  const zeroCost = await mk(`${TAG} Zero Cost`, catA, { price: 50, cost: 0, stock: 7 });
  const blankRow = (await db.query('SELECT cost FROM products WHERE id = $1', [blankCost])).rows[0];
  eq('blank cost is stored as 0', blankRow.cost, 0);
  eq('blank-cost product contributes 0', await dbInventoryValue({ names: [`${TAG} Blank Cost`] }), 0);
  eq('zero-cost product contributes 0', await dbInventoryValue({ names: [`${TAG} Zero Cost`] }), 0);
  check('no NaN anywhere in the product list values', (productsAll.data?.products || []).every((p) => Number.isFinite(Number(p.stock_value))));

  // ================= B. CUSTOMER LEDGER =================
  console.log('\nB. CUSTOMER LEDGER');

  const cust = (await call(admin, '/api/customers', { method: 'POST', body: { name: `${TAG} Ledger` } })).data?.id;
  check('customer created', Boolean(cust));

  // 1) opening balance
  const ob = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'opening_balance', amount: 1000, direction: 'debit', note: 'Balance carried forward' },
  });
  eq('opening balance recorded -> balance 1000', ob.data?.balance, 1000);

  // 2) a second opening balance must be refused once history exists
  const ob2 = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'opening_balance', amount: 500, direction: 'debit' },
  });
  check('second opening balance rejected (409)', ob2.status === 409, `status ${ob2.status}`);

  // 3) credit sale 10,000 paying 4,000 -> 6,000 on account
  const sellable = (await call(admin, '/api/products?search=' + encodeURIComponent(`${TAG} Item 1`))).data?.products[0];
  await call(admin, `/api/products/${sellable.id}`, { method: 'PUT', body: { price: 10000, stock: 100 } });
  const sale1 = await call(admin, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: sellable.id, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 4000, customerId: cust },
  });
  check('partial payment sale accepted (201)', sale1.status === 201, JSON.stringify(sale1.body));
  let acct = (await call(admin, `/api/customers/${cust}`)).data;
  eq('invoice 10,000 paid 4,000 -> outstanding 7,000 (1,000 opening + 6,000 credit)', acct.customer.outstanding_balance, 7000);

  // 4) two partial payments
  await call(admin, `/api/customers/${cust}/payments`, { method: 'POST', body: { amount: 3000, method: 'cash' } });
  await call(admin, `/api/customers/${cust}/payments`, { method: 'POST', body: { amount: 2000, method: 'bank' } });
  acct = (await call(admin, `/api/customers/${cust}`)).data;
  eq('after 3,000 + 2,000 -> outstanding 2,000', acct.customer.outstanding_balance, 2000);

  // 5) a bigger invoice with three payments
  const sale2 = await call(admin, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: sellable.id, qty: 2 }], discount: 0, paymentMethod: 'cash', paid: 0, customerId: cust },
  });
  check('fully-credit sale accepted', sale2.status === 201);
  for (const amount of [5000, 5000, 3000]) {
    await call(admin, `/api/customers/${cust}/payments`, { method: 'POST', body: { amount, method: 'card' } });
  }
  acct = (await call(admin, `/api/customers/${cust}`)).data;
  eq('2,000 + 20,000 - 13,000 -> outstanding 9,000', acct.customer.outstanding_balance, 9000);

  // 6) every payment stays individually visible (nothing overwritten)
  const payments = acct.ledger.filter((t) => t.type === 'payment');
  check('all five payments are separate ledger rows', payments.length === 5, `found ${payments.length}`);
  eq('payments sum to 18,000 (3k + 2k + 5k + 5k + 3k)', acct.totals.total_payments, 18000);

  // 7) the accounting identity
  eq('opening balance', acct.totals.opening_balance, 1000);
  eq('total purchases on credit', acct.totals.total_purchases_on_credit, 26000);
  eq('total debits = opening + credit sales', acct.totals.total_debits, 27000);
  eq('total credits = payments', acct.totals.total_credits, 18000);
  // The accounting identity: opening balance is already inside total_debits
  // (an opening debit), so debits - credits is the balance.
  eq('total debits - total credits == stored balance', r2(acct.totals.total_debits - acct.totals.total_credits), 9000);
  eq('ledger sum == stored outstanding balance', acct.totals.ledger_balance, 9000);
  check('server reports the ledger as in sync', acct.totals.in_sync === true);

  // 8) running balance is correct on every row (oldest -> newest)
  const asc = [...acct.ledger].reverse();
  let running = 0;
  let runningOk = true;
  for (const t of asc) {
    running = r2(running + Number(t.amount));
    if (Math.abs(running - Number(t.balance_after)) > 0.005) runningOk = false;
  }
  check('running balance correct on every ledger row', runningOk);
  eq('final running balance == outstanding', running, 9000);

  // 9) limits and validation
  const bad = [
    ['zero amount', { amount: 0, method: 'cash' }, 400],
    ['negative amount', { amount: -50, method: 'cash' }, 400],
    ['absurd amount (numeric overflow guard)', { amount: 1e15, method: 'cash' }, 400],
    ['over-payment', { amount: 9000.01, method: 'cash' }, 400],
    ['missing method', { amount: 10 }, 400],
  ];
  for (const [name, body, expected] of bad) {
    const r = await call(admin, `/api/customers/${cust}/payments`, { method: 'POST', body });
    check(`payment rejected: ${name}`, r.status === expected, `status ${r.status} ${JSON.stringify(r.body)}`);
  }
  const hugeSale = await call(admin, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: sellable.id, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 1e15, customerId: cust },
  });
  check('sale with an absurd "paid" is a clean 400 (was a 500)', hugeSale.status === 400, `status ${hugeSale.status}`);
  const exact = await call(admin, `/api/customers/${cust}/payments`, { method: 'POST', body: { amount: 9000, method: 'cash' } });
  eq('exact full settlement accepted -> balance 0', exact.data?.balance, 0);

  // 10) adjustments, both directions
  const adjUp = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'adjustment', amount: 250.5, direction: 'debit', note: 'Invoice correction' },
  });
  eq('debit adjustment increases the balance', adjUp.data?.balance, 250.5);
  const adjDown = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'adjustment', amount: 100, direction: 'credit', note: 'Goodwill credit' },
  });
  eq('credit adjustment decreases the balance', adjDown.data?.balance, 150.5);
  const tooFar = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'adjustment', amount: 99999, direction: 'credit', note: 'Too much' },
  });
  check('adjustment below zero balance rejected', tooFar.status === 400, `status ${tooFar.status}`);
  const noNote = await call(admin, `/api/customers/${cust}/ledger`, {
    method: 'POST',
    body: { type: 'adjustment', amount: 10, direction: 'debit' },
  });
  check('adjustment without a note rejected', noNote.status === 400);

  // 11) history pagination
  for (let i = 0; i < 210; i++) {
    await call(admin, `/api/customers/${cust}/ledger`, {
      method: 'POST',
      body: { type: 'adjustment', amount: 1, direction: 'debit', note: `bulk ${i}` },
    });
  }
  const page1 = (await call(admin, `/api/customers/${cust}`)).data;
  check('history page 1 is capped', page1.ledger.length === 200, `got ${page1.ledger.length}`);
  check('server flags that more history exists', page1.hasMore === true);
  const oldest = page1.ledger[page1.ledger.length - 1];
  const page2 = (await call(admin, `/api/customers/${cust}?before=${oldest.id}`)).data;
  check('older page returns the earlier rows', page2.ledger.length > 0 && page2.ledger.every((t) => t.id < oldest.id));
  const seen = new Set([...page1.ledger, ...page2.ledger].map((t) => t.id));
  eq('pagination returns every entry exactly once', seen.size, page1.totals.transaction_count);
  eq('balance still correct after 210 adjustments', page1.customer.outstanding_balance, r2(150.5 + 210));

  // 12) receivables agrees with the per-customer balances
  const recv = (await call(admin, '/api/finance/receivables')).data;
  const recvDb = (await db.query('SELECT COALESCE(SUM(outstanding_balance),0)::float AS s FROM customers WHERE outstanding_balance > 0.005')).rows[0].s;
  eq('receivables total == sum of stored balances', recv.total, r2(recvDb));
  const me = recv.customers.find((c) => c.id === cust);
  eq('this customer appears in receivables with the right balance', me?.outstanding_balance, r2(150.5 + 210));

  // 13) historical edit recalculates every following balance
  const fullHistory = (await call(admin, `/api/customers/${cust}?limit=500`)).data;
  const firstSale = [...fullHistory.ledger].reverse().find((t) => t.type === 'sale');
  check('full history (limit=500) reaches the original sale rows', Boolean(firstSale));
  const edited = await call(admin, `/api/customers/${cust}/transactions/${firstSale.id}`, {
    method: 'PUT',
    body: { amount: 6000 },
  });
  check('historical edit recalculates', edited.status === 200, JSON.stringify(edited.body));
  const after = (await call(admin, `/api/customers/${cust}`)).data;
  check('still in sync after a historical edit', after.totals.in_sync === true);
  eq('balance after the edit', after.customer.outstanding_balance, edited.data?.balance);

  // 14) explicit recalculation is idempotent
  const repaired = await call(admin, `/api/customers/${cust}/ledger/recalculate`, { method: 'POST' });
  eq('recalculate returns the same balance (idempotent)', repaired.data?.balance, after.customer.outstanding_balance);
  check('recalculate confirms the ledger is in sync', repaired.data?.totals?.in_sync !== false);

  console.log('\n==================================================');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  await db.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
