// Product/Variant minimum selling price (per mode, ON/OFF) API checks.
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

function saleBody(items, extra = {}) {
  return { items, paymentMethod: 'cash', paid: 1000000, discount: 0, ...extra };
}
const num = (v) => (v === null || v === undefined ? null : Number(v));

const admin = makeJar();
const cashier = makeJar();

let r = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin' + '123' } });
check('admin login', r.status === 200);
r = await cashier('/api/auth/login', { method: 'POST', body: { username: 'cashier', password: 'Cashier' + '123' } });
check('cashier login', r.status === 200);

const S = `MN${Date.now().toString().slice(-6)}`;

// Find the seeded cashier id.
let users = await admin('/api/users');
const CASH_ID = (users.data.users || []).find((u) => u.username === 'cashier')?.id;
const origPerms = (users.data.users || []).find((u) => u.id === CASH_ID)?.permissions || [];

async function getProduct(id) {
  const d = await admin(`/api/products?search=`);
  return (d.data.products || []).find((p) => p.id === id);
}
async function setCashierLimits(body) {
  return admin(`/api/users/${CASH_ID}/price-limits`, { method: 'PUT', body });
}

// ============================================================ A. product-level CRUD + validation
console.log('\nA. Product minimums — CRUD + validation');
let p1 = await admin('/api/products', {
  method: 'POST',
  body: {
    name: `${S} Cola 330`, price: 100, cost: 60, stock: 200,
    wholesalePrice: 90, specialPrice: 80,
    minPriceEnabled: true, minRetail: 95, minWholesale: 85, minSpecial: 75,
  },
});
check('POST product with min protection ON + 3 minimums -> 201', p1.status === 201, JSON.stringify(p1.data));
const P = p1.data.id;

let got = await getProduct(P);
check('GET returns min_price_enabled=true', got?.min_price_enabled === true, JSON.stringify(got && { e: got.min_price_enabled }));
check('GET returns min 95/85/75', got && num(got.min_retail) === 95 && num(got.min_wholesale) === 85 && num(got.min_special) === 75,
  JSON.stringify({ r: got?.min_retail, w: got?.min_wholesale, s: got?.min_special }));

r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minWholesale: 88 } });
got = await getProduct(P);
check('PATCH updates only the sent minimum (88)', r.status === 200 && num(got.min_wholesale) === 88 && num(got.min_retail) === 95,
  JSON.stringify({ w: got?.min_wholesale, r: got?.min_retail }));

r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: false } });
got = await getProduct(P);
check('protection OFF persists (values kept)', r.status === 200 && got.min_price_enabled === false && num(got.min_wholesale) === 88);

r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: true, minRetail: null } });
got = await getProduct(P);
check('clearing a minimum (null) persists', r.status === 200 && got.min_price_enabled === true && (got.min_retail === null || got.min_retail === undefined));
r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minRetail: 95, minWholesale: 85 } }); // restore clean state
check('P restored to 95/85/75 enabled', r.status === 200);

// validation matrix
r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minRetail: -5 } });
check('negative minimum rejected (400)', r.status === 400, JSON.stringify(r.data));
r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minWholesale: 'abc' } });
check('malformed minimum rejected (400)', r.status === 400, JSON.stringify(r.data));
r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minSpecial: 1e15 } });
check('huge minimum rejected (400)', r.status === 400, JSON.stringify(r.data));
r = await admin(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: 'yes' } });
check('non-boolean protection flag rejected (400)', r.status === 400, JSON.stringify(r.data));

// cashier cannot configure product minimums
r = await cashier(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: false } });
check('cashier cannot modify product minimums (403)', r.status === 403, String(r.status));

// ============================================================ B. variant-level CRUD + independence
console.log('\nB. Variant minimums — CRUD + independence');
let p2 = await admin('/api/products', {
  method: 'POST',
  body: {
    name: `${S} Juice`, price: 0, cost: 0,
    variants: [
      { name: '250ml', price: 100, wholesalePrice: 90, specialPrice: 80, stock: 100,
        minPriceEnabled: true, minRetail: 95, minWholesale: 85, minSpecial: 75 },
      { name: '500ml', price: 140, wholesalePrice: 125, specialPrice: 110, stock: 100,
        minPriceEnabled: true, minRetail: 140, minWholesale: 125, minSpecial: 110 },
    ],
  },
});
check('POST product with 2 sized variants + per-variant minimums -> 201', p2.status === 201, JSON.stringify(p2.data));
const Q = p2.data.id;
got = await getProduct(Q);
const v250 = (got?.variants || []).find((v) => v.name === '250ml');
const v500 = (got?.variants || []).find((v) => v.name === '500ml');
check('250ml min 95/85/75 stored', v250 && v250.min_price_enabled === true && num(v250.min_retail) === 95 && num(v250.min_wholesale) === 85 && num(v250.min_special) === 75,
  JSON.stringify(v250 && { r: v250.min_retail, w: v250.min_wholesale, s: v250.min_special }));
check('500ml min 140/125/110 stored', v500 && num(v500.min_retail) === 140 && num(v500.min_wholesale) === 125 && num(v500.min_special) === 110);

// independence: changing 250ml must not touch 500ml
r = await admin(`/api/products/${Q}`, {
  method: 'PUT',
  body: {
    variants: [
      { id: v250.id, name: '250ml', price: 100, minRetail: 94 },
      { id: v500.id, name: '500ml', price: 140 },
    ],
  },
});
got = await getProduct(Q);
const v250b = (got.variants || []).find((v) => v.name === '250ml');
const v500b = (got.variants || []).find((v) => v.name === '500ml');
check('250ml min changed to 94', r.status === 200 && num(v250b.min_retail) === 94, JSON.stringify({ r: v250b?.min_retail }));
check('500ml min untouched (140)', num(v500b.min_retail) === 140, JSON.stringify({ r: v500b?.min_retail }));

// variant validation
r = await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v250.id, name: '250ml', price: 100, minWholesale: -1 }] } });
check('variant negative minimum rejected (400)', r.status === 400, JSON.stringify(r.data));
r = await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v250.id, name: '250ml', price: 100, minSpecial: 'xyz' }] } });
check('variant malformed minimum rejected (400)', r.status === 400, JSON.stringify(r.data));
r = await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v250.id, name: '250ml', price: 100, minPriceEnabled: 'maybe' }] } });
check('variant non-boolean protection rejected (400)', r.status === 400, JSON.stringify(r.data));

// ============================================================ C. sale enforcement (cashier, item mins only)
console.log('\nC. Sale enforcement — product + variant minimums');
// discount-based tests need the discount permission (grant temporarily, restore at the end)
if (!origPerms.includes('discount')) {
  await admin(`/api/users/${CASH_ID}`, { method: 'PUT', body: { permissions: [...origPerms, 'discount'] } });
}
await setCashierLimits({ retailMin: null, wholesaleMin: null, specialMin: null }); // isolate item mins

const L = (productId, qty = 1, extra = {}) => ({ productId, qty, ...extra });

let s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)]) });
check('retail at 100 (min 95) allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)], { discount: 5 }) });
check('retail to exactly 95 (min 95) allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)], { discount: 6 }) });
check('retail to 94 (min 95) blocked', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));

s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 5 }) });
check('wholesale to exactly 85 (min 85) allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 6 }) });
check('wholesale to 84 (min 85) blocked', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));

s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'special' })], { discount: 5 }) });
check('special to exactly 75 (min 75) allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'special' })], { discount: 6 }) });
check('special to 74 (min 75) blocked', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));

// Variant-level enforcement. Note: for sized lines the EXISTING rule makes
// the variant's own mode price the discount floor, so the variant minimum
// binds on the mode PRICE (a price set below the protected minimum cannot be
// sold) — and hard-blocks any override.
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v250.id, variant: '250ml', mode: 'wholesale' })]) });
check('250ml wholesale at 90 (min 85) allowed', s.status === 201, JSON.stringify(s.data));
await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v250.id, name: '250ml', price: 100, wholesalePrice: 84 }] } });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v250.id, variant: '250ml', mode: 'wholesale' })]) });
check('250ml wholesale price 84 (< min 85) blocked on the price itself', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));
await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v250.id, name: '250ml', price: 100, wholesalePrice: 90 }] } });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v250.id, variant: '250ml', mode: 'wholesale' })]) });
check('250ml wholesale restored to 90 -> allowed again', s.status === 201, JSON.stringify(s.data));

// 500ml keeps its own independent minimums (250ml untouched)
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v500.id, variant: '500ml', mode: 'special' })]) });
check('500ml special at 110 (min 110) allowed', s.status === 201, JSON.stringify(s.data));
await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v500.id, name: '500ml', price: 140, specialPrice: 109 }] } });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v500.id, variant: '500ml', mode: 'special' })]) });
check('500ml special price 109 (< min 110) blocked — independent of 250ml', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(Q, 1, { variantId: v250.id, variant: '250ml', mode: 'wholesale' })]) });
check('250ml still sellable while 500ml is blocked (independence)', s.status === 201, JSON.stringify(s.data));
await admin(`/api/products/${Q}`, { method: 'PUT', body: { variants: [{ id: v500.id, name: '500ml', price: 140, specialPrice: 110 }] } });

// mixed sizes: each line at its own (allowed) price
s = await cashier('/api/sales', { method: 'POST', body: saleBody([
  L(Q, 1, { variantId: v250.id, variant: '250ml' }),
  L(Q, 1, { variantId: v500.id, variant: '500ml' }),
]) });
{
  const d = await cashier(`/api/sales/${s.data.id}`);
  const items = d.data.items || [];
  check('mixed-size sale stores each line at its own price', s.status === 201 && num(items.find((i) => i.variant === '250ml')?.unit_price) === 100 && num(items.find((i) => i.variant === '500ml')?.unit_price) === 140, JSON.stringify(items));
}

// qty-aware: 2 x 100, floor 2 x 95 = 190
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 2)], { discount: 10 }) });
check('qty 2: discount to floor (190) allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 2)], { discount: 11 }) });
check('qty 2: discount below floor (189) blocked', s.status === 400, JSON.stringify(s.data));

// ============================================================ D. protection OFF + user-level interaction
console.log('\nD. ON/OFF + interaction with user-level limits');
await admin(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: false } });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)], { discount: 20 }) });
check('protection OFF: below-minimum sale allowed again (80)', s.status === 201, JSON.stringify(s.data));
await admin(`/api/products/${P}`, { method: 'PUT', body: { minPriceEnabled: true } });

// user limit STRICTER than item min: cashier wholesale min 88 > item 85
await setCashierLimits({ wholesaleMin: 88 });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 2 }) });
check('user limit 88 binds: wholesale to 88 allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 3 }) });
check('user limit 88 binds: wholesale to 87 blocked (user message)', s.status === 400 && /your minimum allowed price/.test(s.data?.error || ''), JSON.stringify(s.data));

// user limit LOOSER than item min: cashier wholesale min 80 < item 85
await setCashierLimits({ wholesaleMin: 80 });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 5 }) });
check('item min 85 binds: wholesale to 85 allowed', s.status === 201, JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 6 }) });
check('item min 85 binds: wholesale to 84 blocked (item message)', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));

// admin: never subject to USER limits, but the item minimum protects the business
s = await admin('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })]) });
check('admin wholesale at 90 (user limit 80 irrelevant) allowed', s.status === 201, JSON.stringify(s.data));
s = await admin('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'wholesale' })], { discount: 10 }) });
check('admin still blocked below the item minimum (80 < 85)', s.status === 400 && /minimum selling price for this item/.test(s.data?.error || ''), JSON.stringify(s.data));

// price_override cannot cross a hard item minimum
r = await admin(`/api/users/${CASH_ID}`, { method: 'PUT', body: { permissions: [...new Set([...origPerms, 'discount', 'price_override'])] } });
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)], { discount: 6 }) });
check('price_override does NOT cross the hard item minimum', s.status === 400, JSON.stringify(s.data));
// (restore original permissions for later suites)
r = await admin(`/api/users/${CASH_ID}`, { method: 'PUT', body: { permissions: origPerms } });
check('original permissions restored', r.status === 200, JSON.stringify(r.data));

// ============================================================ E. security / crafted requests + historical snapshot
console.log('\nE. Crafted requests + historical accuracy');
// client-provided price is ignored (server re-derives from the DB)
s = await cashier('/api/sales', { method: 'POST', body: saleBody([{ productId: P, qty: 1, price: 1 }]) });
{
  const d = await cashier(`/api/sales/${s.data.id}`);
  const it = (d.data.items || [])[0];
  check('crafted price:1 ignored, stored at DB price 100', s.status === 201 && num(it?.unit_price) === 100, JSON.stringify(it));
}
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P, 1, { mode: 'bulk' })]) });
check('invalid mode in crafted request rejected', s.status === 400 && /invalid pricing mode/.test(s.data?.error || ''), JSON.stringify(s.data));
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(999999)]) });
check('invalid product id rejected', s.status === 409, JSON.stringify(s.data));

// historical snapshot: changing minimums/prices later must not rewrite the sale
s = await cashier('/api/sales', { method: 'POST', body: saleBody([L(P)]) });
const histId = s.data.id;
let hist = (await cashier(`/api/sales/${histId}`)).data.items[0];
check('sale stored unit 100, mode retail', num(hist.unit_price) === 100 && hist.pricing_mode === 'retail', JSON.stringify(hist));
await admin(`/api/products/${P}`, { method: 'PUT', body: { price: 120, minPriceEnabled: true, minRetail: 101 } });
await setCashierLimits({ retailMin: 110 });
hist = (await cashier(`/api/sales/${histId}`)).data.items[0];
check('historical sale unchanged after min/price/limit changes', num(hist.unit_price) === 100 && hist.pricing_mode === 'retail', JSON.stringify(hist));
// restore
await admin(`/api/products/${P}`, { method: 'PUT', body: { price: 100, minRetail: 95 } });
await setCashierLimits({ retailMin: null, wholesaleMin: null, specialMin: null });

// ============================================================ F. bug-3 regression: user list permissions
console.log('\nF. Users list permissions (bug 3 regression)');
users = await admin('/api/users');
const cashRow = (users.data.users || []).find((u) => u.id === CASH_ID);
check('permissionless cashier returns [] (not [null])', Array.isArray(cashRow.permissions) && cashRow.permissions.length === 0, JSON.stringify(cashRow.permissions));

console.log(`\n==== minprice-api: ${pass} passed, ${fail} failed ====`);
if (fail > 0) { console.log('Failures:'); failures.forEach((f) => console.log(' -', f)); process.exit(1); }
