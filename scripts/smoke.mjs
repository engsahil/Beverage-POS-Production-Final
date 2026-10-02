// End-to-end smoke test for the Beverage POS API.
// Run against a running dev server:  BASE_URL=http://127.0.0.1:3000 node scripts/smoke.mjs
import { loadEnv } from './env.mjs';
loadEnv();

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
let pass = 0;
let fail = 0;
const failures = [];

// The app buckets every business date in the configured business timezone
// (seed default: Asia/Karachi). Derive test dates in that timezone so the
// suite passes at any wall-clock hour (UTC "today" can differ from business
// "today" between 19:00 and 23:59 UTC).
const BIZ_TZ = 'Asia/Karachi';
function bizDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: BIZ_TZ });
}

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

// --- tiny cookie jar -------------------------------------------------
function makeJar() {
  return { cookies: [] };
}
function cookieHeader(jar) {
  return jar.cookies.map((c) => c.split(';')[0]).join('; ');
}
async function call(jar, path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && jar.cookies.length) headers.Cookie = cookieHeader(jar);
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    jar.cookies = jar.cookies.filter((x) => !x.startsWith(name + '='));
    const value = pair.split('=').slice(1).join('=');
    if (value !== '' && value !== 'deleted') jar.cookies.push(pair);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* html */
  }
  return { status: res.status, data, headers: res.headers };
}

function num(v) {
  return Number(v);
}

async function main() {
  console.log(`\nBeverage POS smoke test → ${BASE}\n`);

  const admin = makeJar();
  const cashier = makeJar();
  const nobody = makeJar();
  const anon = makeJar(); // stays unauthenticated

  // ============ AUTH ============
  console.log('AUTH');
  let r = await call(admin, '/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: 'admin', password: 'Admin123' },
  });
  check('admin login', r.status === 200 && r.data?.ok && r.data?.data?.role === 'admin');
  check('admin login sets session cookie', admin.cookies.length === 1);

  r = await call(cashier, '/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: 'cashier', password: 'Cashier123' },
  });
  check('cashier login', r.status === 200 && r.data?.ok && r.data?.data?.role === 'cashier');

  r = await call(nobody, '/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: 'admin', password: 'wrong' },
  });
  check('invalid password rejected with friendly message', r.status === 401 && r.data?.error === 'Invalid username or password.');

  r = await call(nobody, '/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: 'ghost', password: 'x' },
  });
  check('unknown user rejected', r.status === 401);

  r = await call(anon, '/api/sales');
  check('no session → 401 on protected API', r.status === 401);

  r = await call(cashier, '/api/users');
  check('cashier blocked from admin API (403)', r.status === 403);

  r = await call(anon, '/');
  check('GET / without session redirects to /login', r.status >= 300 && r.status < 400 && (r.headers.get('location') || '').includes('/login'));
  r = await call(admin, '/');
  check('GET / with admin session redirects to /admin', r.status >= 300 && r.status < 400 && (r.headers.get('location') || '').includes('/admin'));

  // The register cashier gets the discount permission (typical setup).
  // 'testcash' stays permission-free for negative tests.
  r = await call(admin, '/api/users');
  const cashierUserRow = (r.data?.data?.users || []).find((u) => u.username === 'cashier');
  r = await call(admin, `/api/users/${cashierUserRow?.id}`, { method: 'PUT', body: { permissions: ['discount'] } });
  check('admin grants cashier the discount permission', r.status === 200);

  // ============ CATALOG SETUP ============
  console.log('\nCATALOG');
  r = await call(admin, '/api/categories', { method: 'POST', body: { name: 'Soft Drinks' } });
  check('create category', r.status === 201 && r.data?.data?.id);
  const catId = r.data?.data?.id;

  r = await call(admin, '/api/categories', { method: 'POST', body: { name: 'Soft Drinks' } });
  check('duplicate category rejected (409)', r.status === 409);

  r = await call(admin, '/api/categories', { method: 'POST', body: { name: 'Water' } });
  check('create second category', r.status === 201);
  const catWater = r.data?.data?.id;

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Cola 1.5L', barcode: '8964000111111', categoryId: catId, price: 120, cost: 85, stock: 40, minStock: 10 },
  });
  check('create product', r.status === 201 && r.data?.data?.id);
  const colaId = r.data?.data?.id;

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Mineral Water 500ml', categoryId: catWater, price: 40, cost: 22, stock: 100, minStock: 24, barcode: '8964000222222' },
  });
  check('create second product', r.status === 201);
  const waterId = r.data?.data?.id;

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Lime Soda 300ml', categoryId: catId, price: 60, cost: 30, stock: 0, minStock: 5 },
  });
  check('create zero-stock product', r.status === 201);
  const limeId = r.data?.data?.id;

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Cola 1L', barcode: '8964000111111', price: 90 },
  });
  check('duplicate barcode rejected (409)', r.status === 409);

  r = await call(cashier, '/api/products', { method: 'POST', body: { name: 'Hack', price: 1 } });
  check('cashier cannot create product (403)', r.status === 403);

  r = await call(cashier, '/api/products?search=Cola');
  const cashProducts = r.data?.data?.products || [];
  check('cashier sees active products via search', r.status === 200 && cashProducts.some((p) => p.id === colaId));
  check('cashier product search returns only active', cashProducts.length >= 1 && cashProducts.every((p) => p.active));

  // ============ VENDORS + PURCHASE ============
  console.log('\nVENDORS + PURCHASE');
  r = await call(admin, '/api/vendors', { method: 'POST', body: { name: 'City Wholesale', phone: '021-1112223', notes: 'Test vendor' } });
  check('create vendor', r.status === 201);
  const vendorId = r.data?.data?.id;

  r = await call(admin, '/api/purchases', {
    method: 'POST',
    body: { vendorId, date: bizDate(0), notes: 'restock', items: [{ productId: colaId, qty: 24, cost: 80 }] },
  });
  check('record purchase', r.status === 201 && r.data?.data?.id);
  const purchaseId = r.data?.data?.id;

  r = await call(admin, '/api/products');
  let cola = (r.data?.data?.products || []).find((p) => p.id === colaId);
  let water;
  check('purchase increased stock (40 → 64)', num(cola?.stock) === 64, `stock=${cola?.stock}`);

  r = await call(admin, `/api/purchases/${purchaseId}`);
  check('purchase detail shows item', r.status === 200 && r.data?.data?.items?.length === 1 && num(r.data.data.items[0].qty) === 24);
  check('purchase total computed (24 × 80 = 1920)', num(r.data?.data?.purchase?.total) === 1920);

  r = await call(admin, `/api/stock-movements?productId=${colaId}`);
  check('stock history has initial + purchase movements', (r.data?.data?.movements || []).length === 2);

  // ============ SALES ============
  console.log('\nSALES');
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: {
      items: [
        { productId: colaId, qty: 3 },
        { productId: waterId, qty: 2 },
      ],
      discount: 10,
      paymentMethod: 'cash',
      paid: 500,
      customerName: 'Ali',
      customerPhone: '0300-1234567',
    },
  });
  check('cashier completes sale', r.status === 201 && r.data?.data?.id);
  const saleId = r.data?.data?.id;
  // subtotal = 3×120 + 2×40 = 440; total = 430; change = 70

  r = await call(cashier, `/api/sales/${saleId}`);
  const sale = r.data?.data?.sale;
  check('sale stored with correct subtotal (440)', num(sale?.subtotal) === 440, `subtotal=${sale?.subtotal}`);
  check('sale total after discount (430)', num(sale?.total) === 430);
  check('change computed (500 − 430 = 70)', num(sale?.change_due) === 70, `change=${sale?.change_due}`);
  check('sale number is sequential 5-digit (00001…)', typeof sale?.sale_no === 'string' && /^\d{5}$/.test(sale.sale_no), sale?.sale_no);

  r = await call(admin, '/api/products');
  cola = (r.data?.data?.products || []).find((p) => p.id === colaId);
  water = (r.data?.data?.products || []).find((p) => p.id === waterId);
  check('sale decreased cola stock (64 → 61)', num(cola?.stock) === 61, `stock=${cola?.stock}`);
  check('sale decreased water stock (100 → 98)', num(water?.stock) === 98, `stock=${water?.stock}`);

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: limeId, qty: 1 }], discount: 0, paymentMethod: 'card', paid: 60 },
  });
  check('out-of-stock product rejected (409)', r.status === 409 && /out of stock/i.test(r.data?.error || ''));

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: colaId, qty: 99999 }], discount: 0, paymentMethod: 'cash', paid: 9999999 },
  });
  check('overselling rejected (409)', r.status === 409);

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: colaId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 50 },
  });
  check('paid < total without customer rejected (400, credit needs customer)', r.status === 400 && /customer/i.test(r.data?.error || ''));

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: colaId, qty: 1 }], discount: 99999, paymentMethod: 'cash', paid: 999999 },
  });
  check('discount > subtotal rejected (400)', r.status === 400 && /discount/i.test(r.data?.error || ''));

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: 999999, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 100 },
  });
  check('unknown product in sale rejected (409)', r.status === 409);

  r = await call(cashier, '/api/sales');
  const cashierSales = r.data?.data?.sales || [];
  check('cashier sees own sales', cashierSales.length >= 1 && cashierSales.every((s) => s.cashier_name === 'Cashier'));

  r = await call(admin, `/api/sales?from=${bizDate(0)}&paymentMethod=cash`);
  const adminCashSales = r.data?.data?.sales || [];
  check('admin sales filter by date + method works', r.status === 200 && adminCashSales.length >= 1 && adminCashSales.every((s) => s.payment_method === 'cash'));

  // ============ ADMIN: DISABLED PRODUCT SALE ============
  r = await call(admin, `/api/products/${limeId}`, { method: 'PUT', body: { active: true, stock: '5' } });
  check('admin enables + restocks product', r.status === 200);
  r = await call(admin, `/api/products/${limeId}`, { method: 'PUT', body: { active: false } });
  check('admin disables product', r.status === 200);
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: limeId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 60 },
  });
  check('sale of disabled product rejected (409)', r.status === 409 && /disabled/i.test(r.data?.error || ''));
  r = await call(admin, `/api/products/${limeId}`, { method: 'PUT', body: { active: true } });

  // ============ INVENTORY ============
  console.log('\nINVENTORY');
  r = await call(admin, '/api/inventory/adjust', { method: 'POST', body: { productId: waterId, delta: -3, note: 'damaged' } });
  check('stock adjustment works', r.status === 200);
  r = await call(admin, '/api/products');
  water = (r.data?.data?.products || []).find((p) => p.id === waterId);
  check('adjustment applied (98 → 95)', num(water?.stock) === 95, `stock=${water?.stock}`);

  r = await call(admin, '/api/inventory/adjust', { method: 'POST', body: { productId: waterId, delta: -9999 } });
  check('adjustment below zero rejected (400)', r.status === 400 && /below zero/i.test(r.data?.error || ''));

  r = await call(admin, `/api/stock-movements?productId=${waterId}`);
  const moves = r.data?.data?.movements || [];
  check('movement history includes adjustment', moves.some((m) => m.reason === 'adjustment' && num(m.change) === -3));

  // ============ DASHBOARD / DAILY / REPORTS ============
  console.log('\nDASHBOARD + REPORTS');
  r = await call(admin, '/api/dashboard');
  const dash = r.data?.data;
  check('dashboard: today sales = 430', r.status === 200 && num(dash?.today?.sales) === 430, `sales=${dash?.today?.sales}`);
  check('dashboard: today orders = 1', num(dash?.today?.orders) === 1);
  check('dashboard: today purchases = 1920', num(dash?.todayPurchases?.total) === 1920);
  check('dashboard: low stock includes zero-stock lime', (dash?.lowStock || []).some((p) => p.id === limeId));
  check('dashboard: recent sales listed', (dash?.recentSales || []).length >= 1);

  const today = bizDate(0);
  r = await call(admin, `/api/daily?from=${today}&to=${today}`);
  const day = (r.data?.data?.days || []).find((d) => d.date === today);
  check('daily record: sales 430, cash 430, discount 10, purchases 1920', !!day && num(day.sales) === 430 && num(day.cash) === 430 && num(day.discount) === 10 && num(day.purchases) === 1920, JSON.stringify(day));

  for (const type of ['daily', 'range', 'cashiers', 'products', 'purchases', 'inventory']) {
    r = await call(admin, `/api/reports/${type}?from=${today}&to=${today}`);
    check(`report ${type} returns columns + rows`, r.status === 200 && Array.isArray(r.data?.data?.columns) && Array.isArray(r.data?.data?.rows));
  }
  r = await call(admin, '/api/reports/products?from=2000-01-01&to=2099-12-31');
  const colaRow = (r.data?.data?.rows || []).find((row) => row.product === 'Cola 1.5L');
  check('product sales report: cola qty = 3', colaRow && num(colaRow.qty_sold) === 3 && num(colaRow.revenue) === 360, JSON.stringify(colaRow));
  r = await call(admin, '/api/reports/bogus');
  check('unknown report type → 400', r.status === 400);

  // ============ USERS ============
  console.log('\nUSERS');
  r = await call(admin, '/api/users', { method: 'POST', body: { username: 'testcash', fullName: 'Test Cash', password: 'Test1234', role: 'cashier' } });
  check('admin creates user', r.status === 201);
  const testUserId = r.data?.data?.id;

  r = await call(admin, `/api/users/${testUserId}`, { method: 'PUT', body: { active: false } });
  check('admin deactivates user', r.status === 200);

  r = await call(nobody, '/api/auth/login', { method: 'POST', auth: false, body: { username: 'testcash', password: 'Test1234' } });
  check('deactivated user cannot log in (401)', r.status === 401);

  r = await call(admin, '/api/users');
  const self = (r.data?.data?.users || []).find((u) => u.username === 'admin');
  r = await call(admin, `/api/users/${self?.id}`, { method: 'PUT', body: { active: false } });
  check('admin cannot deactivate self', r.status === 400);
  r = await call(admin, `/api/users/${self?.id}`, { method: 'PUT', body: { role: 'cashier' } });
  check('admin cannot change own role', r.status === 400);

  // ============ ACCOUNT ============
  console.log('\nACCOUNT');
  r = await call(cashier, '/api/account', { method: 'POST', body: { currentPassword: 'wrong', newUsername: 'cashy' } });
  check('change requires correct current password', r.status === 400 && /current password/i.test(r.data?.error || ''));

  r = await call(cashier, '/api/account', { method: 'POST', body: { currentPassword: 'Cashier123', newUsername: 'admin' } });
  check('username uniqueness enforced (409)', r.status === 409);

  r = await call(cashier, '/api/account', { method: 'POST', body: { currentPassword: 'Cashier123', newUsername: 'cashier2', newPassword: 'Cashier456' } });
  check('cashier changes username + password', r.status === 200);

  r = await call(nobody, '/api/auth/login', { method: 'POST', auth: false, body: { username: 'cashier2', password: 'Cashier123' } });
  check('old password no longer works', r.status === 401);
  const cashier2 = makeJar();
  r = await call(cashier2, '/api/auth/login', { method: 'POST', auth: false, body: { username: 'cashier2', password: 'Cashier456' } });
  check('new username + password work', r.status === 200);
  // restore
  r = await call(cashier2, '/api/account', { method: 'POST', body: { currentPassword: 'Cashier456', newUsername: 'cashier', newPassword: 'Cashier123' } });
  check('username restored', r.status === 200);

  // new user's session still works after username change
  r = await call(cashier2, '/api/account');
  check('session survives username change', r.status === 200 && r.data?.data?.username === 'cashier');

  // ============ SETTINGS ============
  console.log('\nSETTINGS');
  r = await call(cashier2, '/api/settings', { method: 'PUT', body: { businessName: 'X', currency: 'Rs', timezone: 'Asia/Karachi', receiptFooter: 'x' } });
  check('cashier cannot update settings (403)', r.status === 403);

  r = await call(admin, '/api/settings', { method: 'PUT', body: { businessName: 'Test Beverages', currency: 'Rs', timezone: 'Asia/Karachi', receiptFooter: 'Thank you.' } });
  check('admin updates settings', r.status === 200 && r.data?.data?.business_name === 'Test Beverages');

  r = await call(admin, '/api/settings', { method: 'PUT', body: { businessName: 'Test Beverages', currency: 'Rs', timezone: 'Mars/Olympus', receiptFooter: 'Thank you.' } });
  check('invalid timezone rejected', r.status === 400);
  r = await call(admin, '/api/settings', { method: 'PUT', body: { businessName: 'Beverage Store', currency: 'Rs', timezone: 'Asia/Karachi', receiptFooter: 'Thank you for your business.' } });

  // ============ LOGOUT / SESSION ============
  console.log('\nSESSION');
  r = await call(nobody, '/api/auth/logout', { method: 'POST' });
  check('logout without session is safe (200)', r.status === 200);

  const c3 = makeJar();
  r = await call(c3, '/api/auth/login', { method: 'POST', auth: false, body: { username: 'cashier', password: 'Cashier123' } });
  check('fresh cashier login', r.status === 200);
  r = await call(c3, '/api/auth/logout', { method: 'POST' });
  check('logout succeeds', r.status === 200);
  check('logout cleared cookie', c3.cookies.length === 0);
  r = await call(c3, '/api/sales');
  check('session invalid after logout (401)', r.status === 401);

  // ============ PAGES (HTML) ============
  console.log('\nPAGES');
  r = await call(nobody, '/login');
  check('login page renders (200 + html)', r.status === 200);
  r = await call(admin, '/admin');
  check('admin dashboard page renders for admin', r.status === 200);
  r = await call(c3, '/pos', { auth: true }); // c3 logged out
  check('pos page requires session (redirect)', r.status >= 300 && r.status < 400);
  r = await call(cashier2, '/pos');
  check('pos page renders for cashier', r.status === 200);
  r = await call(admin, '/admin/products');
  check('products page renders for admin', r.status === 200);
  r = await call(cashier2, '/admin/products');
  check('cashier redirected away from admin page', r.status >= 300 && r.status < 400);
  r = await call(cashier2, `/sales/${saleId}`);
  check('cashier can open own sale receipt page', r.status === 200);

  // ============ PWA ============
  console.log('\nPWA');
  const manRes = await fetch(BASE + '/manifest.webmanifest');
  const man = await manRes.json();
  check('manifest served + installable fields', manRes.status === 200 && man.display === 'standalone' && Array.isArray(man.icons) && man.icons.length >= 2);
  const swRes = await fetch(BASE + '/sw.js');
  check('service worker served', swRes.status === 200 && (await swRes.text()).includes('fetch'));
  const iconRes = await fetch(BASE + '/icon-192.png');
  check('icon served', iconRes.status === 200);

  // ============ SIMULTANEOUS WORK ============
  console.log('\nSIMULTANEOUS ADMIN + CASHIER');
  // Cashier sells, admin (already logged in) then reads fresh data.
  r = await call(cashier2, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'card', paid: 40 },
  });
  check('cashier sale while admin session active', r.status === 201);
  r = await call(admin, '/api/dashboard');
  check('admin immediately sees updated sales (430 → 470)', num(r.data?.data?.today?.sales) === 470, `sales=${r.data?.data?.today?.sales}`);
  r = await call(admin, '/api/sales');
  check('admin sales list includes new sale', (r.data?.data?.sales || []).some((s) => s.payment_method === 'card'));

  // ============ MIN SELLING PRICE ============
  console.log('\nMIN PRICE');
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Premium Juice 1L', price: 120, cost: 70, stock: 50, minStock: 5, minPrice: 100, barcode: '8964000444444' },
  });
  check('create product with min price', r.status === 201);
  const juiceId = r.data?.data?.id;

  // cashier has discount permission but NOT price_override
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: juiceId, qty: 1 }], discount: 15, paymentMethod: 'cash', paid: 120 },
  });
  check('discount within min-price floor allowed (120−100=20 max, 15 ok)', r.status === 201, r.data?.error);

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: juiceId, qty: 1 }], discount: 25, paymentMethod: 'cash', paid: 120 },
  });
  check('discount below min price blocked without override (400)', r.status === 400 && /minimum selling price/i.test(r.data?.error || ''));

  r = await call(admin, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: juiceId, qty: 1 }], discount: 25, paymentMethod: 'cash', paid: 120 },
  });
  check('admin override below min price allowed', r.status === 201, r.data?.error);

  // ============ EXPIRY ============
  console.log('\nEXPIRY');
  const yesterday = bizDate(-1);
  const in10Days = bizDate(10);
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Expired Milk 250ml', price: 80, stock: 10, expiryDate: yesterday },
  });
  check('create product with past expiry', r.status === 201);
  const expiredId = r.data?.data?.id;

  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: expiredId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 80 },
  });
  check('expired product blocked from sale (409)', r.status === 409 && /expired/i.test(r.data?.error || ''));

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Fresh Yogurt 100g', price: 50, stock: 10, expiryDate: in10Days },
  });
  const nearId = r.data?.data?.id;
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: nearId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 50 },
  });
  check('near-expiry (not expired) product sellable', r.status === 201);

  // ============ CUSTOMERS + CREDIT + RECOVERY ============
  console.log('\nCUSTOMERS + CREDIT');
  r = await call(admin, '/api/customers', { method: 'POST', body: { name: 'Ahmed Traders', phone: '0300-9998887', notes: 'regular' } });
  check('create customer', r.status === 201);
  const custId = r.data?.data?.id;

  r = await call(cashier, '/api/customers', { method: 'POST', body: { name: 'Nope Shop' } });
  check('cashier without customer_management cannot create customer (403)', r.status === 403);

  r = await call(cashier, '/api/customers');
  check('customer list available to cashier (POS selector)', r.status === 200 && (r.data?.data?.customers || []).some((c) => c.id === custId));

  // credit sale: cashier has NO customer_credit permission
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 10, customerId: custId },
  });
  check('credit sale without permission blocked (400)', r.status === 400 && /permission/i.test(r.data?.error || ''));

  // credit sale: admin (implicit permission), water 40, pay 15 → credit 25
  r = await call(admin, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 15, customerId: custId },
  });
  check('credit sale allowed for admin (paid 15 of 40)', r.status === 201, r.data?.error);
  const creditSaleId = r.data?.data?.id;

  r = await call(admin, `/api/customers/${custId}`);
  let cust = r.data?.data?.customer;
  check('customer balance = 25 after credit sale', num(cust?.outstanding_balance) === 25, `balance=${cust?.outstanding_balance}`);
  check('ledger has the credit entry (ref = sale)', (r.data?.data?.ledger || []).some((t) => t.type === 'sale' && num(t.amount) === 25 && t.ref_id === creditSaleId));

  // recovery: full and partial, invalid amounts
  r = await call(admin, `/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 50, method: 'cash' } });
  check('recovery above balance rejected (400)', r.status === 400 && /exceeds/i.test(r.data?.error || ''));

  r = await call(cashier, `/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 5 } });
  check('recovery without customer_credit blocked (403)', r.status === 403);

  r = await call(admin, `/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 10, note: 'partial', method: 'bank' } });
  check('partial recovery allowed (25 → 15)', r.status === 201 && num(r.data?.data?.balance) === 15);
  r = await call(admin, `/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 15, method: 'cash' } });
  check('final recovery to zero (15 → 0)', r.status === 201 && num(r.data?.data?.balance) === 0);
  r = await call(admin, `/api/customers/${custId}/payments`, { method: 'POST', body: { amount: 0 } });
  check('zero recovery rejected', r.status === 400);
  r = await call(admin, `/api/customers/${custId}`);
  check('ledger shows payment entries with running balance', (r.data?.data?.ledger || []).filter((t) => t.type === 'payment').length === 2);

  // ============ INVOICE NUMBERING ============
  console.log('\nINVOICE NUMBERING');
  r = await call(admin, '/api/sales');
  let allSales = r.data?.data?.sales || [];
  const firstNo = Number(allSales[0]?.sale_no);
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'card', paid: 40 } });
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 40 } });
  r = await call(admin, '/api/sales');
  allSales = r.data?.data?.sales || [];
  const three = allSales.slice(0, 3).map((s) => Number(s.sale_no));
  check('invoice numbers sequential (n, n+1, n+2)', three[0] === firstNo + 2 && three[1] === firstNo + 1 && three[2] === firstNo, `got ${three}`);
  check('invoice numbers unique + 5-digit', new Set(allSales.map((s) => s.sale_no)).size === allSales.length && allSales.every((s) => /^\d{5}$/.test(s.sale_no)));

  // concurrency: 10 parallel sales must yield 10 unique numbers, no stock corruption
  const parallelResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: colaId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 120 } })
    )
  );
  check('10 concurrent sales all succeed', parallelResults.every((x) => x.status === 201));
  r = await call(admin, '/api/sales');
  const afterParallel = (r.data?.data?.sales || []).slice(0, 10);
  check('10 concurrent sales → 10 unique invoice numbers', new Set(afterParallel.map((s) => s.sale_no)).size === 10);
  r = await call(admin, '/api/products');
  cola = (r.data?.data?.products || []).find((p) => p.id === colaId);
  check('concurrent sales deducted stock exactly (−10)', num(cola?.stock) === 51, `stock=${cola?.stock}`); // 61 − 10

  // ============ SHIFTS ============
  console.log('\nSHIFTS');
  r = await call(cashier2, '/api/shifts', { method: 'POST', body: { openingCash: 500 } });
  check('open shift (cashier, opening 500)', r.status === 201 && r.data?.data?.id);
  const shiftId = r.data?.data?.id;

  r = await call(cashier2, '/api/shifts', { method: 'POST', body: { openingCash: 100 } });
  check('second open shift for same cashier rejected (409)', r.status === 409);

  r = await call(cashier2, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: limeId, qty: 1 }, { productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 100 },
  });
  check('cash sale of exactly 100 during shift', r.status === 201);

  r = await call(cashier2, `/api/shifts/${shiftId}`, { method: 'POST', body: { closingCash: 600 } });
  check('close shift: expected 500+100=600, diff 0', r.status === 200 && num(r.data?.data?.closing?.expectedCash) === 600 && num(r.data?.data?.closing?.difference) === 0, JSON.stringify(r.data?.data?.closing));

  r = await call(cashier2, `/api/shifts/${shiftId}`, { method: 'POST', body: { closingCash: 600 } });
  check('closing an already-closed shift rejected (409)', r.status === 409);

  r = await call(admin, `/api/shifts/${shiftId}`);
  const shiftDetail = r.data?.data;
  check('shift detail: closed, expected 600, 1 cash sale', shiftDetail?.shift?.status === 'closed' && num(shiftDetail.shift.expected_cash) === 600 && shiftDetail.summary?.sales?.cash_count === 1);

  // admin can close another cashier's shift
  r = await call(cashier2, '/api/shifts', { method: 'POST', body: { openingCash: 200 } });
  const shift2Id = r.data?.data?.id;
  r = await call(cashier2, `/api/shifts/${shift2Id}`, { method: 'POST', body: { closingCash: 199 } });
  check('close own shift with diff −1', r.status === 200 && num(r.data?.data?.closing?.difference) === -1);
  r = await call(cashier2, '/api/shifts', { method: 'POST', body: { openingCash: 100 } });
  const shift3Id = r.data?.data?.id;
  r = await call(admin, `/api/shifts/${shift3Id}`, { method: 'POST', body: { closingCash: 100 } });
  check('admin closes another cashier’s shift', r.status === 200);

  r = await call(cashier, '/api/shifts');
  check('cashier sees own shifts', r.status === 200 && (r.data?.data?.shifts || []).every((s) => s.cashier_name === 'Cashier'));

  // ============ CLAIMS ============
  console.log('\nCLAIMS');
  r = await call(admin, '/api/claims', {
    method: 'POST',
    body: { vendorId, productId: colaId, qty: 2, amount: 160, reason: 'arrived damaged', date: bizDate(0) },
  });
  check('record vendor claim', r.status === 201);
  const claimId = r.data?.data?.id;

  r = await call(cashier, '/api/claims', { method: 'POST', body: { vendorId, amount: 10, reason: 'x' } });
  check('cashier cannot create claims (403)', r.status === 403);

  r = await call(admin, `/api/claims/${claimId}`, { method: 'PUT', body: { adjustmentRef: 'ADJ-001', note: 'credited' } });
  check('settle claim with reference', r.status === 200);
  r = await call(admin, `/api/claims/${claimId}`, { method: 'PUT', body: {} });
  check('settling again rejected (409)', r.status === 409);
  r = await call(admin, '/api/claims?status=pending');
  check('claim filter works (not in pending anymore)', r.status === 200 && !(r.data?.data?.claims || []).some((c) => c.id === claimId));

  // ============ EXPENSES ============
  console.log('\nEXPENSES');
  r = await call(admin, '/api/expenses', { method: 'POST', body: { category: 'Rent', amount: 150, date: bizDate(0), note: 'monthly' } });
  check('record expense', r.status === 201);
  r = await call(admin, '/api/expenses', { method: 'POST', body: { category: 'Bogus', amount: 10 } });
  check('unknown expense category rejected', r.status === 400);
  r = await call(cashier, '/api/expenses', { method: 'POST', body: { category: 'Rent', amount: 10 } });
  check('cashier cannot record expenses (403)', r.status === 403);
  r = await call(admin, `/api/daily?from=${bizDate(0)}&to=${bizDate(0)}`);
  const dayWithExp = (r.data?.data?.days || []).find((d) => d.date === bizDate(0));
  check('daily record includes expenses (150)', num(dayWithExp?.expenses) === 150, JSON.stringify(dayWithExp?.expenses));

  // ============ IMPORT / EXPORT ============
  console.log('\nIMPORT / EXPORT');
  const productCsv = [
    'name,barcode,category,price,cost,stock,min_stock,min_price,expiry_date',
    'Cola 1.5L,8964000111111,Soft Drinks,120,85,10,,',
    'Imported Juice,8964000555555,Imported Category,100,50,5,,',
  ].join('\n');
  r = await call(admin, '/api/import/preview', { method: 'POST', body: { entity: 'products', content: productCsv } });
  check('import preview: 2 rows, 1 duplicate, 1 to insert', r.status === 200 && num(r.data?.data?.totalRows) === 2 && num(r.data?.data?.duplicates) === 1 && num(r.data?.data?.willInsert) === 1, JSON.stringify(r.data?.data));

  r = await call(cashier2, '/api/import/preview', { method: 'POST', body: { entity: 'products', content: productCsv } });
  check('import blocked without customer_management (403)', r.status === 403);

  r = await call(admin, '/api/import/apply', { method: 'POST', body: { entity: 'products', content: productCsv } });
  check('import apply: inserted 1, skipped 1', r.status === 201 && num(r.data?.data?.inserted) === 1 && num(r.data?.data?.skipped) === 1, JSON.stringify(r.data?.data));
  r = await call(admin, '/api/products?search=Imported');
  const imported = (r.data?.data?.products || []).find((p) => p.name === 'Imported Juice');
  check('imported product exists with new category', imported && imported.category_name === 'Imported Category', JSON.stringify(imported));

  const badCsv = ['name,barcode,price', 'Bad Price No,abc,not-a-number'].join('\n');
  r = await call(admin, '/api/import/preview', { method: 'POST', body: { entity: 'products', content: badCsv } });
  check('invalid row reported in preview', r.status === 200 && (r.data?.data?.errors || []).length === 1, JSON.stringify(r.data?.data?.errors));
  r = await call(admin, '/api/import/apply', { method: 'POST', body: { entity: 'products', content: badCsv } });
  check('invalid import rejected with row errors (400)', r.status === 400 && (r.data?.data?.errors || []).length === 1);
  r = await call(admin, '/api/products?search=Bad Price');
  check('failed import rolled back (nothing inserted)', (r.data?.data?.products || []).length === 0);

  const custCsv = ['name,phone,address,notes', 'Imported Customer,0300-5556667,Karachi,from csv', 'Ahmed Traders,0300-9998887,,dup'].join('\n');
  r = await call(admin, '/api/import/apply', { method: 'POST', body: { entity: 'customers', content: custCsv } });
  check('customer import: 1 inserted, 1 duplicate skipped', r.status === 201 && num(r.data?.data?.inserted) === 1 && num(r.data?.data?.skipped) === 1, JSON.stringify(r.data?.data));

  const vendorCsv = ['name', 'City Wholesale', 'Imported Vendor'].join('\n');
  r = await call(admin, '/api/import/apply', { method: 'POST', body: { entity: 'vendors', content: vendorCsv } });
  check('vendor import: 1 inserted, 1 duplicate skipped', r.status === 201 && num(r.data?.data?.inserted) === 1 && num(r.data?.data?.skipped) === 1, JSON.stringify(r.data?.data));

  // exports exist for all 7 entities
  for (const [kind, url, key] of [
    ['categories', '/api/categories', 'categories'],
    ['customers', '/api/customers', 'customers'],
    ['vendors', '/api/vendors', 'vendors'],
  ]) {
    r = await call(admin, url);
    check(`export source for ${kind} available`, r.status === 200 && Array.isArray(r.data?.data?.[key]) && r.data.data[key].length >= 1);
  }

  // ============ PRODUCT IMAGE ============
  console.log('\nPRODUCT IMAGE');
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIgAAAABJRU5ErkJggg==';
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Image Cola 330ml', price: 45, stock: 5, imageData: `data:image/png;base64,${tinyPng}` },
  });
  check('create product with photo', r.status === 201);
  const imgProductId = r.data?.data?.id;
  r = await call(admin, '/api/products?search=Image Cola');
  check('product list flags has_image (without bytes)', (r.data?.data?.products || []).some((p) => p.id === imgProductId && p.has_image === true));
  r = await call(admin, `/api/products/${imgProductId}/image`);
  check('image endpoint serves stored photo', r.status === 200 && (r.headers.get('content-type') || '').includes('image/png'));
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Bad Image', price: 5, imageData: 'data:text/plain;base64,SGVsbG8=' },
  });
  check('non-image mime rejected (400)', r.status === 400 && /(JPG, PNG|invalid image)/i.test(r.data?.error || ''));
  const big = Buffer.alloc(520 * 1024, 1).toString('base64');
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Huge Image', price: 5, imageData: `data:image/jpeg;base64,${big}` },
  });
  check('oversized image rejected (400)', r.status === 400 && /too large/i.test(r.data?.error || ''));
  r = await call(admin, `/api/products/${imgProductId}`, { method: 'PUT', body: { clearImage: true } });
  r = await call(admin, '/api/products?search=Image Cola');
  check('photo removal clears has_image', (r.data?.data?.products || []).every((p) => !(p.id === imgProductId && p.has_image)));
  r = await call(admin, `/api/products/${imgProductId}/image`);
  check('image endpoint 404 after removal', r.status === 404);

  // ============ PERMISSION GATES ============
  console.log('\nPERMISSION GATES');
  r = await call(cashier2, '/api/reports/daily?from=2020-01-01&to=2099-12-31');
  check('reports blocked without reports permission (403)', r.status === 403);
  r = await call(admin, `/api/users/${cashierUserRow?.id}`, { method: 'PUT', body: { permissions: ['discount', 'reports'] } });
  check('admin adds reports permission', r.status === 200);
  r = await call(cashier2, '/api/reports/daily?from=2020-01-01&to=2099-12-31');
  check('reports allowed after granting (200)', r.status === 200 && Array.isArray(r.data?.data?.columns));

  r = await call(cashier2, '/api/inventory/adjust', { method: 'POST', body: { productId: waterId, delta: 1 } });
  check('stock adjustment blocked without permission (403)', r.status === 403);
  r = await call(admin, `/api/users/${cashierUserRow?.id}`, { method: 'PUT', body: { permissions: ['discount', 'reports', 'stock_adjustment'] } });
  r = await call(cashier2, '/api/inventory/adjust', { method: 'POST', body: { productId: waterId, delta: -1, note: 'smoke' } });
  check('stock adjustment allowed after granting', r.status === 200);

  r = await call(cashier, '/api/sales');
  const otherSale = (r.data?.data?.sales || []).find((s) => s.cashier_name !== 'Cashier');
  r = await call(cashier2, `/api/sales/${otherSale?.id}`);
  check('cashier cannot open another cashier’s sale (404)', r.status === 404);
  r = await call(cashier2, '/api/sales');
  check('reprint-less cashier sees only own sales', (r.data?.data?.sales || []).every((s) => s.cashier_name === 'Cashier'));

  // login response includes permissions
  const relog = makeJar();
  r = await call(relog, '/api/auth/login', { method: 'POST', auth: false, body: { username: 'cashier', password: 'Cashier123' } });
  check('login response includes permissions array', Array.isArray(r.data?.data?.permissions) && r.data.data.permissions.includes('stock_adjustment'));
  r = await call(relog, '/api/account');
  check('account endpoint returns permissions', Array.isArray(r.data?.data?.permissions) && r.data.data.permissions.includes('discount'));

  // ============ VARIANTS + DUAL RECEIPT DATA ============
  console.log('\nVARIANTS + DUAL RECEIPT');
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: {
      name: 'Cold Drink',
      price: 50,
      stock: 30,
      variants: [
        { name: '50 ml', price: 50, stock: 10 },
        { name: '100 ml', price: 80, stock: 10 },
        { name: '150 ml', price: 120, stock: 10 },
      ],
    },
  });
  check('create product with variants', r.status === 201 && r.data?.data?.id, r.data?.error);
  const coldId = r.data?.data?.id;

  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Dup Size', price: 10, variants: [{ name: 'Small', price: 10 }, { name: 'small', price: 12 }] },
  });
  check('duplicate variant names rejected (400)', r.status === 400);
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Bad Size', price: 10, variants: [{ name: 'Small', price: 'x' }] },
  });
  check('invalid variant price rejected (400)', r.status === 400);
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Too Many', price: 10, variants: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, price: 1 })) },
  });
  check('more than 10 variants rejected (400)', r.status === 400);
  r = await call(admin, '/api/products', {
    method: 'POST',
    body: { name: 'Nameless Size', price: 10, variants: [{ name: '  ', price: 5 }] },
  });
  check('empty variant name rejected (400)', r.status === 400);

  r = await call(admin, '/api/products?search=Cold Drink');
  const cold = (r.data?.data?.products || []).find((p) => p.id === coldId);
  check('product list carries variant data (no extra query needed on POS)', Array.isArray(cold?.variants) && cold.variants.length === 3);

  // Selling rules
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: coldId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 200 } });
  check('variant product sold without size rejected (400)', r.status === 400);
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: colaId, qty: 1, variant: '100 ml' }], discount: 0, paymentMethod: 'cash', paid: 120 } });
  check('non-variant product sold with size rejected (400)', r.status === 400);
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: coldId, qty: 1, variant: '500 ml' }], discount: 0, paymentMethod: 'cash', paid: 200 } });
  check('unknown size rejected (400)', r.status === 400);

  // Valid variant sale: 2× 100 ml + 1× 50 ml + 1× Cola, table 07, kitchen notes
  // Total = 2×80 + 1×50 + 120 = 330
  r = await call(cashier, '/api/sales', {
    method: 'POST',
    body: {
      items: [
        { productId: coldId, qty: 2, variant: '100 ml' },
        { productId: coldId, qty: 1, variant: '50 ml' },
        { productId: colaId, qty: 1 },
      ],
      discount: 0,
      paymentMethod: 'cash',
      paid: 400,
      tableNo: '07',
      notes: 'No ice on the cold drinks',
    },
  });
  check('variant sale with table + notes completes (201)', r.status === 201, r.data?.error);
  const vSaleId = r.data?.data?.id;

  r = await call(cashier, `/api/sales/${vSaleId}`);
  const vd = r.data?.data;
  check('sale stores the real table number', vd?.sale?.table_no === '07', JSON.stringify(vd?.sale?.table_no));
  check('sale stores the kitchen notes', vd?.sale?.notes === 'No ice on the cold drinks');
  const vItems = vd?.items || [];
  check('same product, different sizes → separate item lines', vItems.filter((i) => i.name === 'Cold Drink').length === 2);
  const v100 = vItems.find((i) => i.variant === '100 ml');
  const v50 = vItems.find((i) => i.variant === '50 ml');
  check('100 ml line uses variant price (80)', v100 && num(v100.unit_price) === 80, JSON.stringify(v100));
  check('50 ml line uses variant price (50)', v50 && num(v50.unit_price) === 50);
  check('variant sale total = 330, change = 70', num(vd?.sale?.total) === 330 && num(vd?.sale?.change_due) === 70, `total=${vd?.sale?.total}`);
  check('sale has exactly one sale number (shared by both slips)', typeof vd?.sale?.sale_no === 'string' && /^\d{5}$/.test(vd.sale.sale_no));

  r = await call(admin, '/api/products');
  const coldAfter = (r.data?.data?.products || []).find((p) => p.id === coldId);
  const colaAfter = (r.data?.data?.products || []).find((p) => p.id === colaId);
  check('variant sale deducted stock once (30 → 27)', num(coldAfter?.stock) === 27, `stock=${coldAfter?.stock}`);
  check('plain product in same sale deducted (cola 51 → 50)', num(colaAfter?.stock) === 50, `stock=${colaAfter?.stock}`);
  r = await call(admin, `/api/stock-movements?productId=${coldId}`);
  check('one stock movement for the whole sale (not per line)', (r.data?.data?.movements || []).filter((m) => m.reason === 'sale').length === 1);

  // Legacy behaviour intact
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: waterId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 40 } });
  check('sale without variants still works', r.status === 201);

  // Variant CRUD via PUT: update, clear, restore
  r = await call(admin, `/api/products/${coldId}`, { method: 'PUT', body: { variants: [{ name: '50 ml', price: 55 }, { name: '100 ml', price: 85 }] } });
  check('update variants via PUT', r.status === 200);
  r = await call(admin, '/api/products?search=Cold Drink');
  let coldNow = (r.data?.data?.products || []).find((p) => p.id === coldId);
  check('variant prices updated (untouched size kept, its stock intact)',
    coldNow?.variants?.length === 3 &&
    num(coldNow.variants.find((v) => v.name === '50 ml')?.price) === 55 &&
    num(coldNow.variants.find((v) => v.name === '100 ml')?.price) === 85 &&
    num(coldNow.variants.find((v) => v.name === '150 ml')?.stock) === 10);
  const v150 = coldNow?.variants?.find((v) => v.name === '150 ml');
  r = await call(admin, `/api/products/${coldId}/variants/${v150?.id}`, { method: 'DELETE' });
  check('explicit variant delete works', r.status === 200);
  r = await call(admin, '/api/products?search=Cold Drink');
  coldNow = (r.data?.data?.products || []).find((p) => p.id === coldId);
  check('deleted size gone, product stock = sum of sizes',
    coldNow?.variants?.length === 2 && num(coldNow.stock) === num((coldNow.variants || []).reduce((t, v) => t + num(v.stock), 0)));
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: coldId, qty: 1, variant: '100 ml' }], discount: 0, paymentMethod: 'cash', paid: 85 } });
  check('updated variant price charged (85)', r.status === 201, r.data?.error);
  r = await call(admin, `/api/products/${coldId}`, { method: 'PUT', body: { variants: null } });
  check('clear variants via PUT', r.status === 200);
  r = await call(cashier, '/api/sales', { method: 'POST', body: { items: [{ productId: coldId, qty: 1 }], discount: 0, paymentMethod: 'cash', paid: 50 } });
  check('after clearing, base price applies again (50)', r.status === 201, r.data?.error);
  r = await call(admin, `/api/products/${coldId}`, { method: 'PUT', body: { variants: [{ name: '50 ml', price: 50 }, { name: '100 ml', price: 80 }] } });

  // ============ CLEAR TEST DATA ============
  console.log('\nCLEAR DATA');
  const tomorrow = bizDate(1);
  r = await call(admin, '/api/data/clear', { method: 'POST', body: { operation: 'sales', before: tomorrow, confirm: 'NOPE' } });
  check('clear requires DELETE confirmation', r.status === 400 && /DELETE/i.test(r.data?.error || ''));
  r = await call(cashier, '/api/data/clear', { method: 'POST', body: { operation: 'sales', before: tomorrow, confirm: 'DELETE' } });
  check('clear is admin-only (403)', r.status === 403);

  r = await call(admin, '/api/sales');
  const salesBeforeClear = (r.data?.data?.sales || []).length;
  const clearRes = await call(admin, '/api/data/clear', { method: 'POST', body: { operation: 'sales', before: tomorrow, confirm: 'DELETE' } });
  check('clear sales: deleted most, skipped credit sale', clearRes.status === 200 && num(clearRes.data?.data?.deleted) >= 5 && num(clearRes.data?.data?.skipped) >= 1, JSON.stringify(clearRes.data?.data));

  r = await call(admin, '/api/sales');
  const salesAfterClear = r.data?.data?.sales || [];
  check('credit sale survived the clear (ledger integrity)', salesAfterClear.some((s) => s.id === creditSaleId));
  check('non-credit sales removed', salesAfterClear.length === salesBeforeClear - num(clearRes.data?.data?.deleted));

  r = await call(admin, `/api/stock-movements?productId=${waterId}`);
  check('stock restored with a visible adjustment entry', (r.data?.data?.movements || []).some((m) => m.reason === 'adjustment' && /cleared/i.test(m.note || '')));

  r = await call(admin, '/api/customers', { method: 'POST', body: { name: 'Temp Clear Me' } });
  const tempCustId = r.data?.data?.id;
  r = await call(admin, '/api/data/clear', { method: 'POST', body: { operation: 'customers', confirm: 'DELETE' } });
  check('clear customers: only the no-activity one deleted', r.status === 200 && num(r.data?.data?.deleted) >= 1);
  r = await call(admin, `/api/customers/${custId}`);
  check('customer with credit ledger survived', r.status === 200);
  r = await call(admin, `/api/customers/${tempCustId}`);
  check('empty customer removed', r.status === 404);

  r = await call(admin, '/api/data/clear', { method: 'POST', body: { operation: 'expenses', before: tomorrow, confirm: 'DELETE' } });
  check('clear expenses before tomorrow', r.status === 200 && num(r.data?.data?.deleted) === 1);

  // ============ SUMMARY ============
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
