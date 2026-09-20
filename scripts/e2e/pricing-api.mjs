// Pricing-mode + cashier-min-price API checks (F1/F2/F3/F4).
// Requires the prod server on :3001 and a clean-ish DB.
const BASE = 'http://127.0.0.1:3001';
let pass = 0, fail = 0; const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name} ${extra}`); }
};

function makeJar() {
  const jar = { cookie: null };
  async function req(path, { method = 'GET', body } = {}) {
    const headers = { ...(jar.cookie ? { cookie: jar.cookie } : {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const setc = res.headers.get('set-cookie');
    if (setc) jar.cookie = setc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data: data && data.ok === true ? data.data : data };
  }
  return req;
}

// The sales API requires the full POS payload; this mirrors what the POS sends.
function saleBody(extra) {
  return { paymentMethod: 'cash', paid: 1000000, discount: 0, ...extra };
}

// POST /api/sales returns only { id, sale_no } — fetch the detail for totals.
async function saleTotal(req, id) {
  const d = await req(`/api/sales/${id}`);
  return d.data && d.data.sale ? Number(d.data.sale.total) : null;
}

// UTC epoch for HH:MM on a calendar date (YYYY-MM-DD) in an IANA timezone.
function tzInstant(dateStr, hhmm, tz) {
  let ts = Date.parse(dateStr + 'T' + hhmm + ':00Z');
  for (let i = 0; i < 4; i++) {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d);
    const g = {};
    for (const p of parts) g[p.type] = p.value;
    const asUTC = Date.UTC(g.year, g.month - 1, g.day, g.hour % 24, g.minute, g.second);
    const nowUTCsec = Math.floor(d.getTime() / 1000);
    const offMs = asUTC - nowUTCsec * 1000;
    ts = Date.parse(dateStr + 'T' + hhmm + ':00Z') - offMs;
  }
  return new Date(ts);
}

const admin = makeJar();
const cashier = makeJar();

let r = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin' + '123' } });
check('admin login', r.status === 200);
r = await cashier('/api/auth/login', { method: 'POST', body: { username: 'cashier', password: 'Cashier' + '123' } });
check('cashier login', r.status === 200);

const S = `PR${Date.now().toString().slice(-6)}`;

// ============================================================ A. products mode prices
console.log('\nA. Products API — wholesale / special prices');
let p1 = await admin('/api/products', { method: 'POST', body: {
  name: `${S} Water 500ml`, price: 100, cost: 60, stock: 50, wholesalePrice: 85.5, specialPrice: 70,
}});
check('POST with wholesale+special -> 201', p1.status === 201, JSON.stringify(p1.data));
const P1 = p1.data.id;

let list = await admin('/api/products');
const l1 = list.data.products.find((p) => p.id === P1);
check('GET list returns wholesale_price', l1 && Math.abs(Number(l1.wholesale_price) - 85.5) < 0.001, JSON.stringify(l1 && l1.wholesale_price));
check('GET list returns special_price', l1 && Math.abs(Number(l1.special_price) - 70) < 0.001, JSON.stringify(l1 && l1.special_price));

let p2 = await admin('/api/products', { method: 'POST', body: { name: `${S} Juice`, price: 120, stock: 20 } });
check('POST without mode prices -> 201', p2.status === 201);
const P2 = p2.data.id;
list = await admin('/api/products');
const l2 = list.data.products.find((p) => p.id === P2);
check('unset mode prices are null', l2 && l2.wholesale_price === null && l2.special_price === null, JSON.stringify(l2 && { w: l2.wholesale_price, s: l2.special_price }));

let bad = await admin('/api/products', { method: 'POST', body: { name: `${S} Bad`, price: 10, stock: 1, wholesalePrice: 'abc' } });
check('POST invalid wholesale -> 400', bad.status === 400, JSON.stringify(bad.data));
bad = await admin('/api/products', { method: 'POST', body: { name: `${S} Bad2`, price: 10, stock: 1, specialPrice: -5 } });
check('POST negative special -> 400', bad.status === 400, JSON.stringify(bad.data));
bad = await admin('/api/products', { method: 'POST', body: { name: `${S} Bad3`, price: 10, stock: 1, specialPrice: 1e15 } });
check('POST huge special (1e15) -> 400', bad.status === 400, JSON.stringify(bad.data));
bad = await admin('/api/products', { method: 'POST', body: { name: `${S} Bad4`, price: 1e15, stock: 1 } });
check('POST huge selling price -> 400', bad.status === 400, JSON.stringify(bad.data));

let up = await admin(`/api/products/${P2}`, { method: 'PUT', body: { wholesalePrice: 99 } });
check('PUT set wholesale only -> 200', up.status === 200, JSON.stringify(up.data));
list = await admin('/api/products');
const l2b = list.data.products.find((p) => p.id === P2);
check('PUT wholesale applied, special untouched (null)', Math.abs(Number(l2b.wholesale_price) - 99) < 0.001 && l2b.special_price === null, JSON.stringify(l2b && { w: l2b.wholesale_price, s: l2b.special_price }));
up = await admin(`/api/products/${P2}`, { method: 'PUT', body: { wholesalePrice: null } });
check('PUT null wholesale -> 200 (clear)', up.status === 200);
list = await admin('/api/products');
const l2c = list.data.products.find((p) => p.id === P2);
check('cleared wholesale is null', l2c.wholesale_price === null);
up = await admin(`/api/products/${P1}`, { method: 'PUT', body: { wholesalePrice: 'x' } });
check('PUT invalid wholesale -> 400', up.status === 400, JSON.stringify(up.data));

// variant special price
let pv = await admin('/api/products', { method: 'POST', body: {
  name: `${S} Milk`, price: 0, stock: 0,
  variants: [
    { name: '1L', price: 200, wholesalePrice: 170, specialPrice: 150, stock: 10 },
    { name: '2L', price: 350, stock: 5 },
  ],
}});
check('POST variant product with special -> 201', pv.status === 201, JSON.stringify(pv.data));
const PV = pv.data.id;
list = await admin('/api/products');
const lv = list.data.products.find((p) => p.id === PV);
const v1 = lv.variants.find((v) => v.name === '1L');
const v2 = lv.variants.find((v) => v.name === '2L');
check('variant 1L special_price = 150', v1 && Math.abs(Number(v1.special_price) - 150) < 0.001, JSON.stringify(v1));
check('variant 2L special_price = 0 (blank -> 0)', v2 && Number(v2.special_price) === 0, JSON.stringify(v2));

up = await admin(`/api/products/${PV}`, { method: 'PUT', body: {
  variants: [
    { id: v1.id, name: '1L', price: 200, wholesalePrice: 170, specialPrice: 160, stock: 10 },
    { id: v2.id, name: '2L', price: 350, specialPrice: 300, stock: 5 },
  ],
}});
check('PUT variants update special -> 200', up.status === 200, JSON.stringify(up.data));
list = await admin('/api/products');
const lv2 = list.data.products.find((p) => p.id === PV);
const v1b = lv2.variants.find((v) => v.name === '1L');
const v2b = lv2.variants.find((v) => v.name === '2L');
check('variant 1L special now 160', Math.abs(Number(v1b.special_price) - 160) < 0.001, JSON.stringify(v1b));
check('variant 2L special now 300', Math.abs(Number(v2b.special_price) - 300) < 0.001, JSON.stringify(v2b));
up = await admin(`/api/products/${PV}`, { method: 'PUT', body: { variants: [{ id: v1.id, name: '1L', price: 200, specialPrice: -1, stock: 10 }] } });
check('PUT variant invalid special -> 400', up.status === 400, JSON.stringify(up.data));

// ============================================================ B. price limits RBAC
console.log('\nB. Cashier price limits — admin-only');
let me = await cashier('/api/users'); // cashier can't list users
check('cashier cannot list users (403)', me.status === 403, `status=${me.status}`);

let gl = await cashier(`/api/users/2/price-limits`);
check('cashier GET own limits -> 403', gl.status === 403, `status=${gl.status}`);
let pl = await cashier(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: 1 } });
check('cashier PUT own limits -> 403', pl.status === 403, `status=${pl.status}`);

gl = await admin(`/api/users/2/price-limits`);
check('admin GET limits (none yet) -> all null', gl.status === 200 && gl.data.retailMin === null && gl.data.wholesaleMin === null && gl.data.specialMin === null, JSON.stringify(gl.data));

pl = await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: 90, wholesaleMin: null, specialMin: 140 } });
check('admin PUT limits -> 200', pl.status === 200 && pl.data.retailMin === 90 && pl.data.wholesaleMin === null && pl.data.specialMin === 140, JSON.stringify(pl.data));
gl = await admin(`/api/users/2/price-limits`);
check('GET reflects stored limits', gl.data.retailMin === 90 && gl.data.specialMin === 140, JSON.stringify(gl.data));

// PATCH semantics: only update one field
pl = await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: 88 } });
check('PUT single field keeps others', pl.status === 200 && pl.data.retailMin === 88 && pl.data.specialMin === 140, JSON.stringify(pl.data));

pl = await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: -1 } });
check('PUT negative limit -> 400', pl.status === 400, JSON.stringify(pl.data));
pl = await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: 'abc' } });
check('PUT non-numeric limit -> 400', pl.status === 400, JSON.stringify(pl.data));

pl = await admin(`/api/users/1/price-limits`, { method: 'PUT', body: { retailMin: 5 } });
check('PUT limits on admin user -> 400 (cashiers only)', pl.status === 400, JSON.stringify(pl.data));
gl = await admin(`/api/users/999999/price-limits`);
check('GET limits unknown user -> 404', gl.status === 404, `status=${gl.status}`);

// ============================================================ C. sales pricing enforcement
console.log('\nC. Sales — mode pricing + cashier minimums (server-side)');
// P1: price 100, wholesale 85.5, special 70, min_price 0, stock 50
// P2: price 120, no mode prices (falls back to retail)
// Limits for cashier now: retail 88, wholesale null, special 140

let s1 = await cashier('/api/sales', { method: 'POST', body: saleBody({ pricingMode: 'retail', items: [{ productId: P1, qty: 2 }] }) });
check('retail sale ok', s1.status === 201, JSON.stringify(s1.data));
const S1 = s1.data.id;
check('retail total = 200', Math.abs((await saleTotal(admin, S1)) - 200) < 0.001);

let d1 = await admin(`/api/sales/${S1}`);
check('sale detail pricing_mode = retail', d1.data.sale.pricing_mode === 'retail', JSON.stringify(d1.data.sale.pricing_mode));
check('sale items carry pricing_mode', d1.data.items.every((i) => i.pricing_mode === 'retail'));
check('sale item unit_price snapshot = 100', d1.data.items[0] && Math.abs(Number(d1.data.items[0].unit_price) - 100) < 0.001, JSON.stringify(d1.data.items[0]));

let s2 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'wholesale' }] }) });
check('wholesale sale ok (per-line mode, no wholesale limit)', s2.status === 201, JSON.stringify(s2.data));
const S2 = s2.data.id;
check('wholesale total = 85.50', Math.abs((await saleTotal(admin, S2)) - 85.5) < 0.001);

// fallback: P2 has no wholesale price -> retail 120
let s3 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P2, qty: 1, mode: 'wholesale' }] }) });
check('wholesale fallback to retail ok', s3.status === 201 && Math.abs((await saleTotal(admin, s3.data.id)) - 120) < 0.001, JSON.stringify(s3.data));

// MIXED sale: P1 wholesale (85.50) + P2 retail (120) in one sale
let sm = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'wholesale' }, { productId: P2, qty: 1, mode: 'retail' }] }) });
check('mixed sale ok (per-line modes)', sm.status === 201, JSON.stringify(sm.data));
const SM = sm.data.id;
check('mixed total = 205.50', Math.abs((await saleTotal(admin, SM)) - 205.5) < 0.001);
let dm = await admin(`/api/sales/${SM}`);
check('mixed sale-level pricing_mode = mixed', dm.data.sale.pricing_mode === 'mixed', JSON.stringify(dm.data.sale.pricing_mode));
check('mixed: per-line modes stored', dm.data.items.find((i) => i.pricing_mode === 'wholesale') && dm.data.items.find((i) => i.pricing_mode === 'retail'), JSON.stringify(dm.data.items));
check('mixed: line prices 85.50 / 120.00', dm.data.items.some((i) => Math.abs(Number(i.unit_price) - 85.5) < 0.001) && dm.data.items.some((i) => Math.abs(Number(i.unit_price) - 120) < 0.001), JSON.stringify(dm.data.items));

// invalid mode (sale-level, legacy) and per-line
let s4 = await cashier('/api/sales', { method: 'POST', body: saleBody({ pricingMode: 'bulk', items: [{ productId: P1, qty: 1 }] }) });
check('invalid sale-level mode -> 400', s4.status === 400 && /pricing mode/i.test(String(s4.data.error || s4.data)), JSON.stringify(s4.data));
let s4b = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'bulk' }] }) });
check('invalid per-line mode -> 400', s4b.status === 400 && /pricing mode/i.test(String(s4b.data.error || s4b.data)), JSON.stringify(s4b.data));

// special below cashier special_min (140) -> special_price 70 < 140 => blocked
let s5 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'special' }] }) });
check('special below min blocked (400)', s5.status === 400, JSON.stringify(s5.data));
check('special block message is clear', /minimum allowed/i.test(String(s5.data.error || '')) && String(s5.data.error).includes('70.00'), JSON.stringify(s5.data));

// variant sale in special: 1L special 160 >= 140 ok
let s6 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: PV, qty: 1, variantId: v1.id, variant: '1L', mode: 'special' }] }) });
check('variant special sale ok (160 >= 140)', s6.status === 201, JSON.stringify(s6.data));
const S6 = s6.data.id;
check('variant special total = 160', Math.abs((await saleTotal(admin, S6)) - 160) < 0.001);
let d6 = await admin(`/api/sales/${S6}`);
check('variant sale item unit_price 160', d6.data.items[0] && Math.abs(Number(d6.data.items[0].unit_price) - 160) < 0.001, JSON.stringify(d6.data.items[0]));
check('variant sale item pricing_mode special', d6.data.items[0] && d6.data.items[0].pricing_mode === 'special');

// now raise special limit above 160 -> same variant line must be blocked
await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { specialMin: 165 } });
let s7 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: PV, qty: 1, variantId: v1.id, variant: '1L', mode: 'special' }] }) });
check('limit change takes effect immediately (160 < 165 blocked)', s7.status === 400, JSON.stringify(s7.data));
await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { specialMin: 140 } });

// discount floor: P1 retail 100, retail_min 88 -> discount > 12 blocked (100-88)
const origPerms = ((await admin('/api/users')).data.users.find((u) => u.id === 2).permissions) || [];
const hadDiscount = origPerms.includes('discount');
if (!hadDiscount) await admin(`/api/users/2`, { method: 'PUT', body: { permissions: [...origPerms, 'discount'] } });

let s8 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'retail' }], discount: 15 }) });
check('discount crossing cashier min blocked', s8.status === 400, JSON.stringify(s8.data));
check('discount floor message mentions minimum', /minimum allowed/i.test(String(s8.data.error || '')), JSON.stringify(s8.data));
let s9 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'retail' }], discount: 12 }) });
check('discount exactly at floor ok (total 88)', s9.status === 201 && Math.abs((await saleTotal(admin, s9.data.id)) - 88) < 0.001, JSON.stringify(s9.data));

// price_override must NOT lift the cashier's min
await admin(`/api/users/2`, { method: 'PUT', body: { permissions: ['discount', 'price_override', 'customer_credit', 'customer_management'] } });
let s10 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'retail' }], discount: 50 }) });
check('price_override does NOT cross cashier min', s10.status === 400, JSON.stringify(s10.data));
await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: null } });
let s11 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'retail' }], discount: 50 }) });
check('price_override lifts product min_price (no limit set)', s11.status === 201 && Math.abs((await saleTotal(admin, s11.data.id)) - 50) < 0.001, JSON.stringify(s11.data));
await admin(`/api/users/2`, { method: 'PUT', body: { permissions: origPerms } });

// client cannot inject prices / manipulated fields
let s12 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'wholesale', price: 5, unitPrice: 5, unit_price: 5 }], total: 5 }) });
check('client-injected prices ignored (billed 85.50)', s12.status === 201 && Math.abs((await saleTotal(admin, s12.data.id)) - 85.5) < 0.001);

// admin is never limited: P1 special 70 is below cashier's 140, admin can still sell
let sa = await admin('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'special' }] }) });
check('admin sale at price below cashier min ok', sa.status === 201 && Math.abs((await saleTotal(admin, sa.data.id)) - 70) < 0.001, JSON.stringify(sa.data));

// historical accuracy: change wholesale price AFTER the sale
await admin(`/api/products/${P1}`, { method: 'PUT', body: { wholesalePrice: 95 } });
let d2 = await admin(`/api/sales/${S2}`);
check('OLD wholesale sale keeps 85.50 after price change', d2.data && Math.abs(Number(d2.data.sale.total) - 85.5) < 0.001 && d2.data.items[0] && Math.abs(Number(d2.data.items[0].unit_price) - 85.5) < 0.001, JSON.stringify(d2.data && d2.data.items[0]));
let s13 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 1, mode: 'wholesale' }] }) });
check('NEW wholesale sale uses updated 95', s13.status === 201 && Math.abs((await saleTotal(admin, s13.data.id)) - 95) < 0.001, JSON.stringify(s13.data));

// malformed qty from crafted request
let s14 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: P1, qty: 'abc', mode: 'retail' }] }) });
check('malformed qty rejected', s14.status === 400, JSON.stringify(s14.data));
let s15 = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: 9999999, qty: 1, mode: 'retail' }] }) });
check('unknown product rejected', s15.status >= 400, `status=${s15.status}`);

// sales list exposes pricing_mode
let sl = await admin('/api/sales');
const ls1 = sl.data.sales.find((x) => x.id === S2);
check('sales list row has pricing_mode wholesale', ls1 && ls1.pricing_mode === 'wholesale', JSON.stringify(ls1));

// ============================================================ D. optional fields lifecycle (F3)
console.log('\nD. Optional product fields — blank/NULL lifecycle');
let op = await admin('/api/products', { method: 'POST', body: {
  name: `${S} Optional`, price: 55, stock: 10,
  barcode: '', categoryId: null, cost: '', minStock: '', minPrice: '', expiryDate: '',
  wholesalePrice: '', specialPrice: '',
}});
check('POST all-optional-blank -> 201', op.status === 201, JSON.stringify(op.data));
const OP = op.data.id;
list = await admin('/api/products');
const lo = list.data.products.find((p) => p.id === OP);
check('GET: blanks stored as null/0', lo && lo.barcode === null && Number(lo.cost) === 0 && Number(lo.min_stock) === 0 && Number(lo.min_price) === 0 && lo.expiry_date === null && lo.wholesale_price === null && lo.special_price === null, JSON.stringify(lo));

let od = await admin(`/api/products/${OP}`, { method: 'PUT', body: { barcode: null, expiryDate: null, cost: '', minStock: '', minPrice: '' } });
check('PUT blanks -> 200 (no crash)', od.status === 200, JSON.stringify(od.data));

// clear any remaining limits so fallback pricing is unobstructed
await admin(`/api/users/2/price-limits`, { method: 'PUT', body: { retailMin: null, wholesaleMin: null, specialMin: null } });
// sell the all-optional product in every mode (fallback = retail)
for (const m of ['retail', 'wholesale', 'special']) {
  const so = await cashier('/api/sales', { method: 'POST', body: saleBody({ items: [{ productId: OP, qty: 1, mode: m }] }) });
  check(`sale in ${m} ok (fallback 55)`, so.status === 201 && Math.abs((await saleTotal(admin, so.data.id)) - 55) < 0.001, JSON.stringify(so.data));
}
// (last sale belongs to OP; re-fetch detail to ensure no serialization crash)
const lastSale = (await admin('/api/sales')).data.sales[0];
let sod = await admin(`/api/sales/${lastSale.id}`);
check('sale detail serializes ok', sod.status === 200 && Array.isArray(sod.data.items));

// POS-facing endpoints see it without 500
let pos = await cashier('/api/products');
check('POS product list ok with optional product', pos.status === 200);

// ============================================================ E. vendor ledger claim date in store tz (F4)
console.log('\nE. Vendor ledger — claim settled_at in store timezone');
let settings = await admin('/api/settings');
const tz = settings.data.timezone;
check('store timezone set', typeof tz === 'string' && tz.length > 0, String(tz));

let vend = await admin('/api/vendors');
const V = vend.data.vendors[0] ? vend.data.vendors[0].id : (await admin('/api/vendors', { method: 'POST', body: { name: `${S} Vendor` } })).data.id;

// Craft a claim settled at 03:00 on the store's TODAY. For a timezone east
// of UTC (e.g. Asia/Karachi +5) that instant is the PREVIOUS day in UTC —
// the exact case that used to render the ledger row with the wrong date.
const utcNow = new Date();
const todayStore = utcNow.toLocaleDateString('sv-SE', { timeZone: tz });
const settledAt = tzInstant(todayStore, '03:00', tz);
const utcDate = settledAt.toISOString().slice(0, 10);
const db = await import('file:///home/user/beverage-pos/lib/db.js');
await db.query(
  `INSERT INTO vendor_claims (vendor_id, amount, status, settled_at, reason)
   VALUES ($1, 25.50, 'settled', $2, 'e2e tz test')`,
  [V, settledAt]
);
let ledger = await admin(`/api/vendors/${V}/ledger`);
const claimRow = ledger.data.rows.filter((x) => x.type === 'adjustments').pop();
check('claim row present', Boolean(claimRow), JSON.stringify(claimRow));
check(`claim row date = store today ${todayStore}`, claimRow && claimRow.date === todayStore, JSON.stringify({ claimRowDate: claimRow && claimRow.date, todayStore }));
if (claimRow && utcDate !== todayStore) {
  check(`UTC date (${utcDate}) differs from store date — tz-aware fix verified`, claimRow.date !== utcDate);
} else {
  console.log(`  NOTE  tz ${tz} does not cross midnight here (utc=${utcDate}); date equality still verified`);
}

// regression: opening balance + running balance still consistent
const first = ledger.data.rows[0];
const last = ledger.data.rows[ledger.data.rows.length - 1];
check('running balance starts at opening', first && Math.abs(first.balance - (Number(ledger.data.opening) + first.credit - first.debit)) < 0.01, JSON.stringify({ opening: ledger.data.opening, first }));
check('closing = last row balance', last && Math.abs(ledger.data.closing - last.balance) < 0.01, JSON.stringify({ closing: ledger.data.closing, last }));

// clean up the crafted claim
await db.query(`DELETE FROM vendor_claims WHERE vendor_id = $1 AND reason = 'e2e tz test'`, [V]);

// ============================================================
console.log(`\n==== pricing-api: ${pass} passed, ${fail} failed ====`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
