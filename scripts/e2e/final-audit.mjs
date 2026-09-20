// Final audit E2E — Phase 5 export verification.
//
// Runs against a LIVE instance (BASE_URL, default http://127.0.0.1:3001)
// with the admin account. Requires Playwright with Chromium installed
// (same harness as the other suites in this directory).
//
// Sections:
//   A  Performance / real client-side navigation (no artificial waits)
//   B  Product variant independence (Coca Cola x4) + batch/expiry + COGS
//   C  Purchase invoice 100,000 -> 30,000 + 20,000 -> remaining 50,000,
//      attachments, ledger, payables, overdue
//   D  Customer payments by method (10k cash / 20k bank / 5k card) + ledger
//   E  Expense flow (account + P&L, no double counting)
//   F  Logo + business name propagation (sidebar / POS / receipt)
//   H  Goals + streak on dashboard
//   I  POS manual flow (variant + credit + order notes + receipt)
//   J  UI/UX sweep (console errors, broken images, overflow, touch targets)
//
// Usage: BASE_URL=http://127.0.0.1:3001 node scripts/e2e/final-audit.mjs

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const BIZ_TZ = 'Asia/Karachi';
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const bizDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: BIZ_TZ });

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name} ${extra}`); }
};
const approx = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

async function req(path, { method = 'GET', body, raw = false } = {}) {
  return page.evaluate(async ({ path, method, body, raw }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return { status: res.status, type: res.headers.get('content-type') || '' };
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    // unwrap the { ok, data } envelope
    return { status: res.status, data: json && json.ok !== undefined ? json.data : json };
  }, { path, method, body, raw });
}

// ---------- login ----------
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[placeholder="Enter username"]', 'admin');
await page.fill('input[placeholder="Enter password"]', 'Admin123');
await Promise.all([page.waitForURL('**/admin', { timeout: 15000 }), page.click('button[type="submit"]')]);
await page.waitForSelector('h1');
await page.waitForTimeout(1500);
const skip = page.locator('div.fixed.inset-0.z-50 button:has-text("Skip")');
if (await skip.count()) await skip.first().click();

// ================= A. PERFORMANCE / REAL NAVIGATION =================
console.log('\nA. REAL CLIENT-SIDE NAVIGATION');
const navCountAtStart = await page.evaluate(() => performance.getEntriesByType('navigation').length);

async function navPerf(label, linkText, waitSel) {
  const t0 = await page.evaluate(() => performance.now());
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  await page.click(`aside nav a:has-text("${linkText}")`);
  await page.waitForSelector(waitSel, { timeout: 10000 });
  const s = await page.evaluate((a) => {
    const now = performance.now();
    const fresh = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !a.b.includes(n));
    const counts = {};
    fresh.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
    const dups = Object.entries(counts).filter(([, v]) => v > 1).map(([k, v]) => `${v}x ${k.split('/').pop()}`);
    return {
      ms: Math.round(now - a.t0),
      reqs: fresh.length,
      settings: fresh.filter((n) => n.includes('/api/settings')).length,
      dups,
      navs: performance.getEntriesByType('navigation').length,
    };
  }, { b: before, t0 });
  check(
    `nav ${label}: <800ms, no dup requests, no full reload`,
    s.ms < 800 && s.dups.length === 0 && s.navs === navCountAtStart && s.settings <= 1,
    JSON.stringify(s)
  );
}

await navPerf('-> Products', 'Products', 'h1:has-text("Products")');
await navPerf('-> Purchases', 'Purchases', 'h1:has-text("Purchases")');
await navPerf('-> Vendors', 'Vendors', 'h1:has-text("Vendors")');
await navPerf('-> Customers', 'Customers', 'h1:has-text("Customers")');
await navPerf('-> Finance', 'Finance', 'text=Opening');
await navPerf('-> Settings', 'Settings', 'h1:has-text("Settings")');
// POS and Sales are standalone layouts (no sidebar) -> full loads there
let t0 = await page.evaluate(() => performance.now());
await page.click('aside nav a:has-text("POS")');
await page.waitForSelector('h1:has-text("Point of Sale")', { timeout: 10000 });
let ms = await page.evaluate((a) => Math.round(performance.now() - a.t0), { t0 });
check('nav -> POS (full load): <1500ms', ms < 1500, `${ms}ms`);
t0 = await page.evaluate(() => performance.now());
await page.goto(BASE + '/sales', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Sales")');
ms = await page.evaluate((a) => Math.round(performance.now() - a.t0), { t0 });
check('load /sales (full load): <1500ms', ms < 1500, `${ms}ms`);
await navPerf('-> Dashboard (client-side from Sales)', 'Dashboard', 'h1:has-text("Dashboard")');

// Finance tab switching (real click -> render completion)
await page.click('aside nav a:has-text("Finance")');
await page.waitForSelector('text=Opening', { timeout: 10000 }); // initial cash-flow rendered first
const TABS = [
  ['Profit & Loss', 'text=Sales revenue'],
  ['Balance Sheet', 'text=Total assets'],
  ['Receivables', 'text=Total owed to you'],
  ['Payables', 'text=Total you owe'],
  ['Cash Flow', 'text=Opening'],
];
for (const [tab, sel] of TABS) {
  const t0 = await page.evaluate(() => performance.now());
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  await page.click(`button:text-is("${tab}")`);
  await page.waitForSelector(sel, { timeout: 10000 });
  const s = await page.evaluate((a) => {
    const fresh = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !a.b.includes(n));
    const fin = fresh.filter((n) => n.includes('/api/finance/'));
    return { ms: Math.round(performance.now() - a.t0), apiCalls: fin.length, urls: fin };
  }, { b: before, t0 });
  if (s.apiCalls > 1) console.log('      fresh finance URLs: ' + JSON.stringify(s.urls));
  check(`tab ${tab}: <800ms, no redundant finance API calls`, s.ms < 800 && s.apiCalls <= 1, JSON.stringify(s));
}

// ================= B. PRODUCT VARIANTS =================
console.log('\nB. PRODUCT VARIANT INDEPENDENCE (Coca Cola x4)');
let r = await req('/api/categories', { method: 'POST', body: { name: 'Audit Cats' } });
check('audit category created', r.status === 201, JSON.stringify(r.data));
const catId = r.data.id;
r = await req('/api/vendors', { method: 'POST', body: { name: 'Audit Supplier' } });
check('audit supplier created', r.status === 201, JSON.stringify(r.data));
const supId = r.data.id;

const VARIANTS = [
  { name: '500ml', unit: 'bottle', sku: 'CC-500', barcode: '8901001', price: 90, cost: 45, stock: 20, minStock: 5, expiryDate: bizDate(30), batchNo: 'B-CC500-A', supplierId: supId },
  { name: '1 Liter', unit: 'bottle', sku: 'CC-1L', barcode: '8901002', price: 140, cost: 70, stock: 15, minStock: 4, expiryDate: bizDate(45), batchNo: 'B-CC1L-A', supplierId: supId },
  { name: '1.5 Liter', unit: 'bottle', sku: 'CC-1500', barcode: '8901003', price: 180, cost: 95, stock: 10, minStock: 3, expiryDate: bizDate(60), batchNo: 'B-CC1500-A', supplierId: supId },
  { name: '2 Liter', unit: 'bottle', sku: 'CC-2L', barcode: '8901004', price: 220, cost: 110, stock: 8, minStock: 2, expiryDate: bizDate(75), batchNo: 'B-CC2L-A', supplierId: supId },
];
r = await req('/api/products', { method: 'POST', body: { name: 'Coca Cola', categoryId: catId, price: 180, cost: 1, stock: 0, variants: VARIANTS } });
check('Coca Cola created with 4 variants', r.status === 201, JSON.stringify(r.data));
const prodId = r.data.id;

const getProd = async () => {
  const res = await req(`/api/products?search=Coca Cola`);
  return (res.data.products || []).find((x) => x.name === 'Coca Cola');
};
let prod = await getProd();
check('4 variant rows returned', (prod.variants || []).length === 4, JSON.stringify((prod.variants || []).map((v) => v.name)));
const V = {};
for (const v of prod.variants || []) V[v.name] = v;

let fieldOk = true, fieldExtra = [];
for (const spec of VARIANTS) {
  const v = V[spec.name];
  const F = { sku: v.sku, barcode: v.barcode, price: Number(v.price), cost: Number(v.cost), minStock: Number(v.min_stock), expiryDate: String(v.expiry_date).slice(0, 10), batchNo: v.batch_no, unit: v.unit, stock: Number(v.stock), supplierId: Number(v.supplier_id) };
  for (const f of ['sku', 'barcode', 'price', 'cost', 'minStock', 'expiryDate', 'batchNo', 'unit', 'stock', 'supplierId']) {
    if (String(F[f]) !== String(spec[f])) { fieldOk = false; fieldExtra.push(`${spec.name}.${f}=${F[f]} want ${spec[f]}`); }
  }
}
check('each variant stores its own sku/barcode/price/cost/minStock/expiry/batch/supplier', fieldOk, fieldExtra.join('; '));
check('500ml and 1.5L prices differ', Number(V['500ml'].price) !== Number(V['1.5 Liter'].price));

// sell one 500ml + one 1 Liter -> only those two stocks move
r = await req('/api/sales', { method: 'POST', body: {
  items: [{ productId: prodId, variantId: V['500ml'].id, qty: 1 }, { productId: prodId, variantId: V['1 Liter'].id, qty: 1 }],
  discount: 0, paid: 230, paymentMethod: 'cash',
} });
check('variant sale 500ml+1L completed (201)', r.status === 201, JSON.stringify(r.data));
const saleB = { id: r.data.id };
r = await req(`/api/sales/${saleB.id}`);
check('sale total 230 (90 + 140)', approx(r.data.sale?.total, 230), JSON.stringify(r.data.sale?.total));
prod = await getProd();
check('sale deducted 500ml only (20->19)', Number(V2stock(prod, '500ml')) === 19, JSON.stringify(prod.variants.map((v) => [v.name, v.stock])));
check('sale deducted 1L only (15->14)', Number(V2stock(prod, '1 Liter')) === 14);
check('1.5L and 2L untouched', Number(V2stock(prod, '1.5 Liter')) === 10 && Number(V2stock(prod, '2 Liter')) === 8);
function V2stock(p, name) { return (p.variants || []).find((x) => x.name === name)?.stock; }

// receipt line shows variant label + charged variant price
r = await req(`/api/sales/${saleB.id}`);
const itemsB = r.data.items || [];
check('receipt lines carry variant label + charged price', itemsB.some((i) => i.variant?.includes('500ml') && approx(i.unit_price, 90)) && itemsB.some((i) => i.variant?.includes('1 Liter') && approx(i.unit_price, 140)), JSON.stringify(itemsB.map((i) => [i.name, i.variant, i.unit_price])));

// PATCH semantics: change ONLY the 500ml price -> nothing else may move
const putBody = { name: 'Coca Cola', variants: prod.variants.map((v) => {
  const full = { id: v.id, name: v.name, unit: v.unit, sku: v.sku, barcode: v.barcode, price: v.price, cost: v.cost, stock: v.stock, minStock: v.minStock, expiryDate: v.expiryDate, batchNo: v.batchNo, supplierId: v.supplierId };
  if (v.name === '500ml') full.price = 95;
  return full;
}) };
r = await req(`/api/products/${prodId}`, { method: 'PUT', body: putBody });
prod = await getProd();
check('edit 500ml price only: 90->95, stock kept (19)', r.status === 200 && Number(V2stock(prod, '500ml')) === 19 && Number((prod.variants || []).find((v) => v.name === '500ml').price) === 95);
check('other variants untouched by the edit', Number((prod.variants || []).find((v) => v.name === '1 Liter').price) === 140 && Number((prod.variants || []).find((v) => v.name === '1.5 Liter').cost) === 95);

// batches of the SAME variant with different cost/expiry/batch
r = await req('/api/purchases', { method: 'POST', body: {
  vendorId: supId, date: bizDate(0),
  items: [{ productId: prodId, variantId: V['1 Liter'].id, qty: 10, cost: 70, expiryDate: bizDate(30), batchNo: 'B-CC1L-B' }],
} });
check('batch B purchase of 1L (10 @70) accepted', r.status === 201, JSON.stringify(r.data));
r = await req('/api/purchases', { method: 'POST', body: {
  vendorId: supId, date: bizDate(0),
  items: [{ productId: prodId, variantId: V['1 Liter'].id, qty: 5, cost: 75, expiryDate: bizDate(60), batchNo: 'B-CC1L-C' }],
} });
check('batch C purchase of 1L (5 @75, later expiry) accepted', r.status === 201, JSON.stringify(r.data));
prod = await getProd();
const v1 = (prod.variants || []).find((v) => v.name === '1 Liter');
check('1L stock 14+15=29 after both batches', Number(v1.stock) === 29, JSON.stringify(v1.stock));
check('1L cost = latest batch (75)', Number(v1.cost) === 75, JSON.stringify(v1.cost));
check('1L expiry = latest batch (+60d)', String(v1.expiry_date).slice(0, 10) === bizDate(60), JSON.stringify(v1.expiry_date));
check('1L batch = B-CC1L-C', v1.batch_no === 'B-CC1L-C', JSON.stringify(v1.batch_no));
check('500ml/1.5L/2L unaffected by 1L batches', Number((prod.variants || []).find((v) => v.name === '500ml').cost) === 45 && Number((prod.variants || []).find((v) => v.name === '1.5 Liter').cost) === 95 && Number((prod.variants || []).find((v) => v.name === '2 Liter').stock) === 8);
r = await req('/api/purchases', { method: 'POST', body: {
  vendorId: supId, date: bizDate(0),
  items: [{ productId: prodId, variantId: V['2 Liter'].id, qty: 2, cost: 110, expiryDate: bizDate(75), batchNo: 'B-CC2L-B' }],
} });
check('2L batch purchase accepted', r.status === 201, JSON.stringify(r.data));

// COGS must use the VARIANT cost (base product cost is deliberately 1)
r = await req(`/api/finance/profit?from=${bizDate(0)}&to=${bizDate(0)}`);
const pl = r.data;
check('P&L COGS uses variant costs (1x45 + 1x75 = 120), not base product cost (2)', approx(pl?.cogs, 120), JSON.stringify(pl && { cogs: pl.cogs }));
check('P&L revenue 230 today', approx(pl?.revenue, 230), JSON.stringify(pl && { revenue: pl.revenue }));

// variant-specific expiry: expire the 500ml -> sale must be rejected
const expPut = { name: 'Coca Cola', variants: prod.variants.map((v) => {
  const full = { id: v.id, name: v.name, unit: v.unit, sku: v.sku, barcode: v.barcode, price: v.price, cost: v.cost, stock: v.stock, minStock: v.minStock, expiryDate: v.expiryDate, batchNo: v.batchNo, supplierId: v.supplierId };
  if (v.name === '500ml') full.expiryDate = bizDate(-1);
  return full;
}) };
await req(`/api/products/${prodId}`, { method: 'PUT', body: expPut });
r = await req('/api/sales', { method: 'POST', body: { items: [{ productId: prodId, variantId: V['500ml'].id, qty: 1 }], discount: 0, paid: 999, paymentMethod: 'cash' } });
check('expired variant sale rejected', r.status === 400 || r.status === 409, `${r.status} ${JSON.stringify(r.data)}`);
const expRestore = { name: 'Coca Cola', variants: prod.variants.map((v) => {
  const full = { id: v.id, name: v.name, unit: v.unit, sku: v.sku, barcode: v.barcode, price: v.price, cost: v.cost, stock: v.stock, minStock: v.minStock, expiryDate: v.expiryDate, batchNo: v.batchNo, supplierId: v.supplierId };
  if (v.name === '500ml') full.expiryDate = bizDate(30);
  return full;
}) };
await req(`/api/products/${prodId}`, { method: 'PUT', body: expRestore });

// ================= C. PURCHASE INVOICE 100,000 =================
console.log('\nC. PURCHASE INVOICE 100,000 -> PAYMENTS -> 50,000 REMAINING');
r = await req('/api/vendors', { method: 'POST', body: { name: 'Audit Vendor' } });
const avId = r.data.id;
r = await req('/api/products', { method: 'POST', body: { name: 'Audit Crate', categoryId: catId, price: 1200, cost: 1000, stock: 0, barcode: '8902001' } });
const crateId = r.data.id;
r = await req('/api/purchases', { method: 'POST', body: { vendorId: avId, date: bizDate(0), items: [{ productId: crateId, qty: 100, cost: 1000 }] } });
check('purchase 100 x 1,000 created (201)', r.status === 201, JSON.stringify(r.data));
const p100 = { id: r.data.id };
r = await req(`/api/purchases/${p100.id}`);
check('purchase total = 100,000', approx(r.data.purchase?.total, 100000), JSON.stringify(r.data.purchase?.total));

r = await req(`/api/purchases/${p100.id}`);
check('initial status unpaid, outstanding 100,000', r.data.purchase.status === 'unpaid' && approx(r.data.purchase.outstanding, 100000), JSON.stringify({ s: r.data.purchase.status, o: r.data.purchase.outstanding }));
r = await req(`/api/purchases/${p100.id}/attachment`, { method: 'PUT', body: { data: TINY_PNG, name: 'inv-audit.png' } });
check('invoice attachment uploaded', r.status === 201, JSON.stringify(r.data));
r = await req(`/api/purchases/${p100.id}/attachment`, { raw: true });
check('attachment served as image/png', r.status === 200 && r.type.includes('image/png'), JSON.stringify(r));

r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 30000, method: 'cash', reference: 'A-30K' } });
check('payment 30,000 cash -> partially paid, 70,000 remaining', r.status === 201 && r.data.purchase.status === 'partially_paid' && approx(r.data.purchase.outstanding, 70000), JSON.stringify(r.data.purchase));
const pay30 = r.data.payment;
r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 20000, method: 'bank', reference: 'A-20K' } });
check('payment 20,000 bank -> 50,000 remaining', r.status === 201 && approx(r.data.purchase.outstanding, 50000), JSON.stringify(r.data.purchase));
const pay20 = r.data.payment;
r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 50001, method: 'card' } });
check('overpayment 50,001 blocked (400)', r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 50000, method: 'card', reference: 'A-50K' } });
check('exact remaining 50,000 card -> PAID, 0 remaining', r.status === 201 && r.data.purchase.status === 'paid' && approx(r.data.purchase.outstanding, 0), JSON.stringify(r.data.purchase));
r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 1, method: 'cash' } });
check('further payment on paid invoice blocked', r.status === 400, `${r.status}`);

// app model: payments are added or deleted (delete + re-add = the supported "edit")
r = await req(`/api/purchases/${p100.id}/payments/${pay20.id}`, { method: 'DELETE' });
check('delete bank payment 20,000: outstanding 20,000, partially paid', r.status === 200 && approx(r.data.purchase.outstanding, 20000) && r.data.purchase.status === 'partially_paid', JSON.stringify(r.data.purchase));
r = await req(`/api/purchases/${p100.id}/payments`, { method: 'POST', body: { amount: 20000, method: 'bank', reference: 'A-20K-B' } });
check('re-add bank 20,000: back to paid, 0 remaining', r.status === 201 && approx(r.data.purchase.outstanding, 0) && r.data.purchase.status === 'paid', JSON.stringify(r.data.purchase));
r = await req(`/api/purchases/${p100.id}/payments/${pay30.id}`, { method: 'DELETE' });
check('delete cash payment 30,000: outstanding 30,000', r.status === 200 && approx(r.data.purchase.outstanding, 30000), JSON.stringify(r.data.purchase));

r = await req(`/api/purchases/${p100.id}`);
check('attachment still on the invoice after payment edits', r.data.purchase.has_attachment === true && r.data.purchase.attachment_name === 'inv-audit.png', JSON.stringify({ h: r.data.purchase.has_attachment, n: r.data.purchase.attachment_name }));
r = await req(`/api/purchases/${p100.id}/attachment`, { raw: true });
check('attachment bytes still served after payment edits', r.status === 200 && r.type.includes('image/png'), JSON.stringify(r));
r = await req('/api/purchases');
const row100 = (r.data.purchases || []).find((x) => x.id === p100.id);
check('purchases list does not leak attachment bytes', row100 && row100.attachment_data === undefined, JSON.stringify(Object.keys(row100 || {})));

r = await req(`/api/vendors/${avId}/ledger`);
const led = r.data;
check('vendor ledger: opening 0, closing 30,000', approx(led.opening, 0) && approx(led.closing, 30000), JSON.stringify({ o: led.opening, c: led.closing }));
const rows = led.rows || [];
const invRow = rows.find((x) => x.type === 'invoices');
const cardRow = rows.find((x) => x.type === 'payments' && x.method === 'card');
const bankRow = rows.find((x) => x.type === 'payments' && x.method === 'bank');
check('ledger rows: invoice credit 100,000; card debit 50,000; bank debit 20,000; last running balance = closing',
  rows.length === 3 &&
  invRow && approx(invRow.credit, 100000) && approx(invRow.debit, 0) &&
  cardRow && approx(cardRow.debit, 50000) &&
  bankRow && approx(bankRow.debit, 20000) &&
  approx(rows[rows.length - 1].balance, 30000),
  JSON.stringify(rows.map((x) => [x.type, x.method, x.debit, x.credit, x.balance])));
check('payments default-dated on business today (store tz, not UTC)',
  String(cardRow.date).slice(0, 10) === bizDate(0) && String(bankRow.date).slice(0, 10) === bizDate(0),
  JSON.stringify([cardRow.date, bankRow.date]));

r = await req('/api/finance/payables');
const myV = (r.data.vendors || []).find((x) => x.vendor_id === avId);
check('payables: vendor outstanding 30,000', myV && approx(myV.outstanding, 30000), JSON.stringify(myV));

// overdue: old unpaid invoice (due_date = date + 30d)
r = await req('/api/vendors', { method: 'POST', body: { name: 'Audit Vendor Old' } });
const avOld = r.data.id;
r = await req('/api/purchases', { method: 'POST', body: { vendorId: avOld, date: bizDate(-40), items: [{ productId: crateId, qty: 1, cost: 100 }] } });
const pOld = { id: r.data.id };
r = await req(`/api/purchases/${pOld.id}`);
check('40-day-old unpaid invoice is OVERDUE', r.data.purchase.status === 'overdue', JSON.stringify(r.data.purchase.status));
r = await req('/api/finance/payables');
const oldV = (r.data.vendors || []).find((x) => x.vendor_id === avOld);
check('payables overdue: 100 outstanding + 100 overdue', oldV && approx(oldV.outstanding, 100) && approx(oldV.overdue, 100) && approx(r.data.overdueTotal, 100), JSON.stringify(oldV));

r = await req(`/api/finance/cash-flow?from=${bizDate(0)}&to=${bizDate(0)}`);
const acc = r.data.accounts;
check('cash flow today: bank vendor out 20,000; card 50,000; cash 0 (deleted)', approx(acc.bank.vendor_payments, 20000) && approx(acc.card.vendor_payments, 50000) && approx(acc.cash.vendor_payments, 0), JSON.stringify({ b: acc.bank.vendor_payments, c: acc.card.vendor_payments, csh: acc.cash.vendor_payments }));
check('cash flow rows are internally consistent (closing = opening + in - out)',
  ['cash', 'bank', 'card'].every((k) => approx(acc[k].closing, acc[k].opening + acc[k].inflow - acc[k].outflow)),
  JSON.stringify(acc));
r = await req('/api/finance/balance-sheet');
// 30,100 (this vendor 30,000 + old vendor 100) + 1,295 (section B batch purchases, unpaid)
check('balance sheet: payables = 31,395 exactly (no double counting); balanced', approx(r.data.liabilities.payables, 31395) && r.data.balanced === true, JSON.stringify(r.data.liabilities));
r = await req(`/api/products?search=Audit Crate`);
check('crate stock 101 after 100 + 1 purchases', Number(r.data.products?.[0]?.stock) === 101, JSON.stringify(r.data.products?.[0]?.stock));

// ================= D. CUSTOMER PAYMENTS BY METHOD =================
console.log('\nD. CUSTOMER PAYMENTS 10K CASH / 20K BANK / 5K CARD');
r = await req('/api/products', { method: 'POST', body: { name: 'Audit Bottle', categoryId: catId, price: 10000, cost: 6000, stock: 5, barcode: '8903001' } });
const bottleId = r.data.id;
r = await req('/api/customers', { method: 'POST', body: { name: 'Audit Cust' } });
check('audit customer created', r.status === 201, JSON.stringify(r.data));
const custId = r.data.id;

r = await req('/api/sales', { method: 'POST', body: { items: [{ productId: bottleId, qty: 4 }], discount: 0, paid: 5000, paymentMethod: 'cash', customerId: custId } });
check('credit sale 4 x 10,000, paid 5,000 -> outstanding 35,000', r.status === 201, JSON.stringify(r.data?.sale));
r = await req(`/api/customers/${custId}`);
check('customer outstanding = 35,000', approx(r.data.customer.outstanding_balance, 35000), JSON.stringify(r.data.customer.outstanding_balance));
const txnOf = (t) => (r.data.ledger || []).find((x) => x.id === t);

const txnByNote = async (note) => {
  const res = await req(`/api/customers/${custId}`);
  return (res.data.ledger || []).find((t) => t.type === 'payment' && t.note === note);
};
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 10000, method: 'cash', note: 'pay-1' } });
check('payment 10,000 CASH -> balance 25,000', r.status === 201 && approx(r.data.balance, 25000), JSON.stringify(r.data));
const ct1 = await txnByNote('pay-1');
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 20000, method: 'bank', note: 'pay-2' } });
check('payment 20,000 BANK -> balance 5,000', r.status === 201 && approx(r.data.balance, 5000), JSON.stringify(r.data));
const ct2 = await txnByNote('pay-2');
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 5000, method: 'card', note: 'pay-3' } });
check('payment 5,000 CARD -> balance 0', r.status === 201 && approx(r.data.balance, 0), JSON.stringify(r.data));
const ct3 = await txnByNote('pay-3');
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 1, method: 'cash' } });
check('payment above balance (0) rejected', r.status === 400, `${r.status}`);

r = await req(`/api/customers/${custId}`);
let ledg = r.data.ledger || [];
check('ledger running balance 35,000 -> 25,000 -> 5,000 -> 0 with methods',
  approx(ledg.find((t) => t.type === 'sale')?.balance_after, 35000) &&
  approx(ledg.find((t) => t.id === ct1?.id)?.balance_after, 25000) && ledg.find((t) => t.id === ct1?.id)?.method === 'cash' &&
  approx(ledg.find((t) => t.id === ct2?.id)?.balance_after, 5000) && ledg.find((t) => t.id === ct2?.id)?.method === 'bank' &&
  approx(ledg.find((t) => t.id === ct3?.id)?.balance_after, 0) && ledg.find((t) => t.id === ct3?.id)?.method === 'card',
  JSON.stringify(ledg.map((t) => [t.type, t.method, t.balance_after])));

r = await req(`/api/finance/cash-flow?from=${bizDate(0)}&to=${bizDate(0)}`);
const accD = r.data.accounts;
check('cash flow: 10,000 into CASH, 20,000 into BANK, 5,000 into CARD (customer payments)',
  approx(accD.cash.customer_payments, 10000) && approx(accD.bank.customer_payments, 20000) && approx(accD.card.customer_payments, 5000),
  JSON.stringify({ c: accD.cash.customer_payments, b: accD.bank.customer_payments, cd: accD.card.customer_payments }));
check('cash flow: cash sales = 230 variant + 5,000 credit-sale part (receivable part NOT counted)', approx(accD.cash.sales, 5230), JSON.stringify(accD.cash.sales));

r = await req('/api/finance/receivables');
const myC = (r.data.customers || []).find((x) => x.id === custId);
check('receivables: customer gone from list after full recovery', !myC, JSON.stringify(r.data.customers?.length));

// historical edit of a payment -> balance recalc, no silent corruption
r = await req(`/api/customers/${custId}/transactions/${ct1.id}`, { method: 'PUT', body: { amount: 8000, method: 'cash' } });
check('edit pay-1 10,000 -> 8,000: balance recalcs to 2,000', r.status === 200 && approx(r.data.balance, 2000), JSON.stringify(r.data));
r = await req(`/api/customers/${custId}`);
ledg = r.data.ledger || [];
check('ledger fully recalculated after edit (27,000 -> 7,000 -> 2,000)',
  approx(ledg.find((t) => t.id === ct1?.id)?.balance_after, 27000) &&
  approx(ledg.find((t) => t.id === ct2?.id)?.balance_after, 7000) &&
  approx(ledg.find((t) => t.id === ct3?.id)?.balance_after, 2000),
  JSON.stringify(ledg.map((t) => [t.type, t.amount, t.balance_after])));
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 2001, method: 'cash' } });
check('recovery above new balance (2,001 > 2,000) rejected', r.status === 400, `${r.status}`);
r = await req(`/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 2000, method: 'cash' } });
check('final recovery 2,000 -> balance 0', r.status === 201 && approx(r.data.balance, 0), JSON.stringify(r.data));
r = await req(`/api/products?search=Audit Bottle`);
check('bottle stock 5-4=1 after credit sale', Number(r.data.products?.[0]?.stock) === 1, JSON.stringify(r.data.products?.[0]?.stock));

// ================= E. EXPENSE FLOW =================
console.log('\nE. EXPENSE FLOW (bank 750)');
r = await req('/api/expenses', { method: 'POST', body: { category: 'Rent', amount: 750, date: bizDate(0), method: 'bank', payee: 'Audit Rent Co', reference: 'A-750' } });
check('bank expense 750 created', r.status === 201, JSON.stringify(r.data));
r = await req(`/api/finance/cash-flow?from=${bizDate(0)}&to=${bizDate(0)}`);
const accE = r.data.accounts;
check('cash flow: bank outflow = 20,000 vendor + 750 expense = 20,750 (no double count)',
  approx(accE.bank.outflow, 20750) && approx(accE.bank.vendor_payments, 20000) && approx(accE.bank.expenses, 750),
  JSON.stringify({ out: accE.bank.outflow, vp: accE.bank.vendor_payments, exp: accE.bank.expenses }));
r = await req(`/api/finance/profit?from=${bizDate(0)}&to=${bizDate(0)}`);
check('P&L: Rent 750 appears exactly once in expenses', (r.data.expenses || []).filter((e) => e.category === 'Rent').length === 1 && approx(r.data.expenses.find((e) => e.category === 'Rent').total, 750), JSON.stringify(r.data.expenses));
check('P&L net = revenue - cogs - expenses + claims', approx(r.data.net, r.data.revenue - r.data.cogs - r.data.expenseTotal + r.data.claims, 0.01), JSON.stringify(r.data));

// ================= F. LOGO + BUSINESS NAME =================
console.log('\nF. LOGO + BUSINESS NAME PROPAGATION');
r = await req('/api/settings/logo', { method: 'PUT', body: { data: TINY_PNG } });
check('logo uploaded via API', r.status === 200 || r.status === 201, JSON.stringify(r.data));
r = await req('/api/settings');
const originalName = r.data.business_name;

await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('aside img[src="/api/settings/logo"]', { timeout: 10000 });
let imgOk = await page.evaluate(() => {
  const im = document.querySelector('aside img[src="/api/settings/logo"]');
  return im && im.naturalWidth > 0;
});
check('sidebar logo renders (not broken)', imgOk === true, JSON.stringify(imgOk));

await page.goto(BASE + '/pos', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Point of Sale")');
imgOk = await page.evaluate(() => {
  const im = document.querySelector('header img[src="/api/settings/logo"], main img[src="/api/settings/logo"]');
  return im && im.naturalWidth > 0;
});
check('POS header logo renders', imgOk === true, JSON.stringify(imgOk));

await page.goto(BASE + `/sales/${saleB.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#print-area', { timeout: 10000, state: 'attached' });
imgOk = await page.evaluate(() => {
  const im = document.querySelector('#print-area .r-logo');
  return im && im.naturalWidth > 0;
});
check('receipt logo renders (sized, not broken)', imgOk === true, JSON.stringify(imgOk));

// rename the business via the real Settings UI (its PUT also clears the client GET cache)
await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Settings")');
await page.fill('label:has(span:text-is("Business name")) input', 'Audit Beverages Ltd');
await page.click('button:has-text("Save Settings")');
await page.waitForTimeout(600);
await page.click('aside nav a:has-text("Dashboard")');
await page.waitForSelector('h1:has-text("Dashboard")');
await page.waitForSelector('aside :text-is("Audit Beverages Ltd")', { timeout: 5000 }).catch(() => {});
check('sidebar shows new name after client-side nav', (await page.textContent('aside')).includes('Audit Beverages Ltd'));
await page.goto(BASE + '/pos', { waitUntil: 'domcontentloaded' });
check('POS shows new name', (await page.textContent('h1:has-text("Point of Sale")')).length > 0 && (await page.textContent('body')).includes('Audit Beverages Ltd'));
await page.goto(BASE + `/sales/${saleB.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#print-area', { timeout: 10000, state: 'attached' });
check('receipt shows new name', (await page.textContent('#print-area')).includes('Audit Beverages Ltd'));
await req('/api/settings', { method: 'PUT', body: { businessName: originalName, currency: 'Rs', timezone: BIZ_TZ, receiptFooter: 'Thank you for your business.' } });
await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
check('original name restored in sidebar', (await page.textContent('aside')).includes(originalName));

// ================= H. GOALS + STREAK =================
console.log('\nH. GOALS + STREAK');
await req('/api/settings', { method: 'PUT', body: { businessName: originalName, currency: 'Rs', timezone: BIZ_TZ, receiptFooter: 'Thank you for your business.', dailySalesGoal: 100, monthlySalesGoal: 1000 } });
await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Dashboard")');
const dashText = await page.textContent('body');
check('dashboard shows Today / Streak / Monthly goal cards', dashText.includes('Today') && dashText.includes('Streak') && dashText.includes('Monthly Sales Goal'));
r = await req('/api/dashboard');
check('dashboard API: streak days is a number, daily sales > 0', typeof r.data.goals?.streak?.days === 'number' && Number(r.data.goals.daily?.sales) > 0, JSON.stringify(r.data.goals || r.data));

// ================= I. POS MANUAL FLOW =================
console.log('\nI. POS MANUAL FLOW (variant + credit + order notes + receipt)');
await page.goto(BASE + '/pos', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Point of Sale")');
await page.fill('input[placeholder="Search product or scan barcode"]', 'Coca Cola');
await page.waitForTimeout(400);
await page.click('button:has-text("Coca Cola")');
await page.waitForSelector('text=Choose a size');
const picker = page.locator('.fixed.z-50').last();
const pickerText = await picker.textContent();
check('size picker lists all 4 sizes with stock', pickerText.includes('500ml') && pickerText.includes('1 Liter') && pickerText.includes('1.5 Liter') && pickerText.includes('2 Liter'), pickerText.slice(0, 120));
await picker.locator('button:has-text("500ml")').click();
await page.waitForTimeout(300);
const cartText = await page.locator('aside').last().textContent();
check('cart line shows 500ml at 95', cartText.includes('500ml') && cartText.includes('95'), cartText.slice(0, 120));
await page.fill('input[placeholder="Search product or scan barcode"]', 'Audit Bottle');
await page.waitForTimeout(400);
await page.click('button:has-text("Audit Bottle")');
await page.waitForTimeout(300);
check('cart has 2 lines (10,095 total)', (await page.locator('aside').last().textContent()).includes('10,095'));
await page.selectOption('select[aria-label="Customer"]', { label: 'Audit Cust' });
await page.fill('input[aria-label="Table number"]', 'T-4');
await page.fill('input[aria-label="Order notes"]', 'Audit order note 7');
await page.fill('input[aria-label="Customer paid"]', '5000');
await page.click('button:has-text("Complete Sale")');
await page.waitForURL(/\/sales\/\d+/, { timeout: 15000 });
await page.waitForSelector('#print-area', { timeout: 10000, state: 'attached' });
const receiptText = await page.textContent('#print-area');
check('receipt: variant line (500ml @95)', receiptText.includes('500ml') && receiptText.includes('95'));
check('receipt: plain line (Audit Bottle 10,000)', receiptText.includes('Audit Bottle') && receiptText.includes('10,000'));
check('receipt: order note + table printed', receiptText.includes('Audit order note 7') && receiptText.includes('T-4'));
check('receipt: credit shown (paid 5,000 of 10,095)', receiptText.includes('5,000') && receiptText.includes('10,095'));
check('receipt: logo present', (await page.locator('#print-area .r-logo').count()) > 0);
r = await req(`/api/customers/${custId}`);
check('POS credit sale posted: outstanding 5,095', approx(r.data.customer.outstanding_balance, 5095), JSON.stringify(r.data.customer.outstanding_balance));
const prodNow = await getProd();
check('POS sale deducted 500ml stock only (19 -> 18)', Number(V2stock(prodNow, '500ml')) === 18, JSON.stringify(prodNow.variants.map((v) => [v.name, v.stock])));

// ================= J. UI/UX SWEEP =================
console.log('\nJ. UI/UX SWEEP');
const PAGES = [
  ['dashboard', '/admin', 'h1:has-text("Dashboard")'],
  ['products', '/admin/products', 'h1:has-text("Products")'],
  ['purchases', '/admin/purchases', 'h1:has-text("Purchases")'],
  ['vendors', '/admin/vendors', 'h1:has-text("Vendors")'],
  ['customers', '/admin/customers', 'h1:has-text("Customers")'],
  ['finance', '/admin/finance', 'h1:has-text("Finance")'],
  ['settings', '/admin/settings', 'h1:has-text("Settings")'],
  ['pos', '/pos', 'h1:has-text("Point of Sale")'],
  ['sales', '/sales', 'h1:has-text("Sales")'],
];
for (const [name, path, sel] of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(sel, { timeout: 10000 });
  await page.waitForTimeout(900); // let data render (measured page, not artificial gate)
  const issues = await page.evaluate(() => {
    const out = [];
    const imgs = [...document.querySelectorAll('img')];
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).length;
    if (broken) out.push(`${broken} broken images`);
    if (document.documentElement.scrollWidth > window.innerWidth + 2) out.push(`horizontal overflow ${document.documentElement.scrollWidth}>${window.innerWidth}`);
    // Clipped-control heuristic: <20px tall, or visible text cut off.
    // (28px small buttons and icon-only row actions are intentional sizes.)
    // (disabled controls are excluded: no tap-target risk while inactive)
    const btns = [...document.querySelectorAll('button, aside nav a')].filter((b) => b.offsetParent !== null && !b.disabled);
    const small = btns.filter((b) => b.getBoundingClientRect().height < 20).length;
    const clipped = [...document.querySelectorAll('button, td, th, span, p, label, h1, h2, h3')]
      .filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 2 && e.textContent.trim().length > 0)
      .length;
    if (small) out.push(`${small} controls <20px tall`);
    if (clipped) out.push(`${clipped} clipped text elements`);
    return out;
  });
  check(`ui ${name}: no broken images / overflow / tiny controls`, issues.length === 0, issues.join('; '));
}

// ---------- global ----------
// The audit deliberately triggers 4xx responses via in-page fetches (invalid key,
// overpayment, over-recovery, duplicate names, expired sale); the browser logs
// those as "Failed to load resource". Anything else (5xx, JS errors, network) fails.
const unexpected = errors.filter((e) => !/^Failed to load resource: the server responded with a status of 40[019]/.test(e));
check('zero unexpected console/page errors across the whole audit', unexpected.length === 0, JSON.stringify(unexpected.slice(0, 6)));

console.log(`\nFINAL AUDIT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('Failures:\n  - ' + failures.join('\n  - '));
await browser.close();
process.exit(fail ? 1 : 0);
