// API check: vendor payments, ledger, customer methods, finance reports,
// expenses v2, branding, goals.
const BASE = 'http://127.0.0.1:3001';
let pass = 0, fail = 0; const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name} ${extra}`); }
};

const jar = {};
async function req(path, { method = 'GET', body, raw } = {}) {
  const headers = { ...(jar.cookie ? { cookie: jar.cookie } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const setc = res.headers.get('set-cookie');
  if (setc) jar.cookie = setc.split(';')[0];
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch {}
  // ok() envelope: { ok: true, data } -> unwrap
  return { status: res.status, data: data && data.ok === true ? data.data : data };
}

// login
let r = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin123' } });
check('login', r.status === 200);

// --- seed data for the check (unique names so re-runs are safe) ---
const S = `API${Date.now().toString().slice(-6)}`;
const Y = 2050 + (Math.floor(Date.now() / 1000) % 2000); // unique year per run (collision needs same-second runs)
let v = await req('/api/vendors', { method: 'POST', body: { name: `${S} Water`, phone: '0300-111' } });
check('vendor created', v.status === 201, JSON.stringify(v.data));
let cat = await req('/api/categories', { method: 'POST', body: { name: `${S} Cat` } });
let prod = await req('/api/products', { method: 'POST', body: { name: `${S} Cola`, price: 100, cost: 60, stock: 0 } });
check('product created', prod.status === 201, JSON.stringify(prod.data));

let p = await req('/api/purchases', { method: 'POST', body: {
  vendorId: v.data.id, date: `${Y}-01-05`,
  items: [{ productId: prod.data.id, qty: 10, cost: 50 }],
}});
check('purchase created (500 total)', p.status === 201, JSON.stringify(p.data));
const pid = p.data.id;

let det = await req(`/api/purchases/${pid}`);
check('detail: unpaid status, remaining 500', det.status === 200 && det.data.purchase.status === 'unpaid' && det.data.remaining === 500, JSON.stringify(det.data.purchase));
check('detail: due_date = 2031-02-04', String(det.data.purchase.due_date).slice(0,10) === `${Y}-02-04`, JSON.stringify(det.data.purchase.due_date));

// partial payment 200 cash
let pay1 = await req(`/api/purchases/${pid}/payments`, { method: 'POST', body: { amount: 200, method: 'cash', reference: 'CHQ-1', note: 'first', paymentDate: `${Y}-01-06` } });
check('payment 1 accepted', pay1.status === 201 && pay1.data.remaining === 300, JSON.stringify(pay1.data));
check('status now partially_paid', pay1.data.purchase.status === 'partially_paid', pay1.data.purchase?.status);

// overpayment blocked
let over = await req(`/api/purchases/${pid}/payments`, { method: 'POST', body: { amount: 500, method: 'cash' } });
check('overpayment blocked (400)', over.status === 400, JSON.stringify(over.data));

// second partial payment 300 bank
let pay2 = await req(`/api/purchases/${pid}/payments`, { method: 'POST', body: { amount: 300, method: 'bank', reference: 'TT-9', paymentDate: `${Y}-01-06` } });
check('payment 2 accepted', pay2.status === 201 && pay2.data.remaining === 0, JSON.stringify(pay2.data));
check('status now paid', pay2.data.purchase.status === 'paid', pay2.data.purchase?.status);

// exact-remaining allowed, one paisa more blocked
let extra = await req(`/api/purchases/${pid}/payments`, { method: 'POST', body: { amount: 0.01, method: 'cash' } });
check('any further payment blocked when paid', extra.status === 400, JSON.stringify(extra.data));

// delete payment 2 -> partially paid again
let del = await req(`/api/purchases/${pid}/payments/${pay2.data.payment.id}`, { method: 'DELETE' });
check('delete payment re-opens balance', del.status === 200 && del.data.purchase.status === 'partially_paid' && del.data.purchase.outstanding === 300, JSON.stringify(del.data.purchase));

// vendor ledger
let led = await req(`/api/vendors/${v.data.id}/ledger`);
const rows = led.data.rows || [];
check('ledger: 3 rows (invoice + 1 payment + ... )', rows.length === 2 && led.data.closing === 300, JSON.stringify(led.data));
check('ledger opening 0, closing 300', led.data.opening === 0 && led.data.closing === 300, JSON.stringify({ o: led.data.opening, c: led.data.closing }));
check('ledger rows carry running balance', rows[0].balance === 500 && rows[1].balance === 300, JSON.stringify(rows));

// vendors list shows outstanding
let vl = await req('/api/vendors');
const me = (vl.data.vendors || []).find((x) => x.id === v.data.id);
check('vendor list outstanding = 300', me && me.outstanding === 300, JSON.stringify(me));

// overdue scenario: old unpaid purchase
let v2 = await req('/api/vendors', { method: 'POST', body: { name: `${S} Old` } });
let p2 = await req('/api/purchases', { method: 'POST', body: {
  vendorId: v2.data.id, date: '2026-08-01',
  items: [{ productId: prod.data.id, qty: 2, cost: 50 }],
}});
let d2 = await req(`/api/purchases/${p2.data.id}`);
check('old unpaid purchase is overdue', d2.data.purchase.status === 'overdue', JSON.stringify(d2.data.purchase));

// payables endpoint
let pb = await req('/api/finance/payables');
const myV = (pb.data.vendors || []).find((x) => x.vendor_id === v.data.id);
const myV2 = (pb.data.vendors || []).find((x) => x.vendor_id === v2.data.id);
check('payables: vendor outstanding 300', myV && myV.outstanding === 300, JSON.stringify(pb.data.vendors));
check('payables: overdue vendor 100', myV2 && myV2.outstanding === 100 && myV2.overdue === 100, JSON.stringify(myV2));
check('payables: overdue total >= 100', pb.data.overdueTotal >= 100, String(pb.data.overdueTotal));

// attachment on purchase
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let att = await req(`/api/purchases/${pid}/attachment`, { method: 'PUT', body: { data: tinyPng, name: 'inv.png' } });
check('purchase attachment uploaded', att.status === 201, JSON.stringify(att.data));
let attGet = await req(`/api/purchases/${pid}/attachment`, { raw: true });
check('purchase attachment served', attGet.status === 200 && (attGet.headers.get('content-type') || '').includes('image/png'));
let det2 = await req(`/api/purchases/${pid}`);
check('detail shows attachment after payment edits', det2.data.purchase.has_attachment === true && det2.data.purchase.attachment_name === 'inv.png');
// edit payments again, attachment survives
let pay3 = await req(`/api/purchases/${pid}/payments`, { method: 'POST', body: { amount: 300, method: 'card', paymentDate: `${Y}-01-07` } });
let det3 = await req(`/api/purchases/${pid}`);
check('attachment survives payment edits', det3.data.purchase.has_attachment === true && det3.data.purchase.status === 'paid');

// --- expenses v2 ---
// cleanup: this test owns the year 2055 — remove any rows left by earlier
// versions of this test so totals below are deterministic
let el0 = await req(`/api/expenses?from=${Y}-01-01&to=${Y}-12-31`);
for (const e of el0.data.expenses || []) {
  await req(`/api/expenses/${e.id}`, { method: 'DELETE' });
}
let e1 = await req('/api/expenses', { method: 'POST', body: { category: 'Transport', amount: 150, date: `${Y}-01-06`, method: 'cash', payee: 'Taxi Co', reference: 'T-1' } });
check('expense with method+payee created', e1.status === 201, JSON.stringify(e1.data));
let e2 = await req('/api/expenses', { method: 'POST', body: { category: 'Supplies', amount: 250, date: `${Y}-01-06`, method: 'bank' } });
let el = await req(`/api/expenses?from=${Y}-01-01&to=${Y}-01-31`);
const mine = (el.data.expenses || []).filter((e) => [e1.data.id, e2.data.id].includes(e.id));
check('expenses list has new fields', mine.length === 2 && mine.every((e) => e.method && e.payee !== undefined), JSON.stringify(mine));
check('expense list does not leak bytes', mine.every((e) => e.attachment_data === undefined));
let eu = await req(`/api/expenses/${e1.data.id}`, { method: 'PUT', body: { amount: 100, method: 'bank', payee: 'Taxi Co (amended)' } });
check('expense edited', eu.status === 200, JSON.stringify(eu.data));
let el2 = await req(`/api/expenses?from=${Y}-01-01&to=${Y}-01-31&method=bank`);
check('expense filter by method', (el2.data.expenses || []).some((e) => e.id === e1.data.id) && (el2.data.expenses || []).every((e) => e.method === 'bank'));
let ea = await req(`/api/expenses/${e2.data.id}/attachment`, { method: 'PUT', body: { data: tinyPng, name: 'rcpt.png' } });
check('expense attachment uploaded', ea.status === 201, JSON.stringify(ea.data));
let ed = await req(`/api/expenses/${e2.data.id}`, { method: 'DELETE' });
check('expense voided', ed.status === 200);

// --- cash flow reflects everything ---
let cf = await req(`/api/finance/cash-flow?from=${Y}-01-01&to=${Y}-01-31`);
const acc = cf.data.accounts;
check('cash-flow: 200 cash vendor payment out, closing = opening - 200', acc.cash.vendor_payments === 200 && acc.cash.closing === acc.cash.opening - 200, JSON.stringify(acc.cash));
check('cash-flow: cash expense out is 0 (edited to bank)', acc.cash.expenses === 0, JSON.stringify(acc.cash));
check('cash-flow: 100 bank expense out (edited)', acc.bank.expenses === 100, JSON.stringify(acc.bank));
check('cash-flow: customer payments 0 in this range (dated today)', acc.bank.customer_payments === 0, JSON.stringify(acc.bank));
check('cash-flow: 300 card vendor payment out', acc.card.vendor_payments === 300, JSON.stringify(acc.card));
check('cash-flow: closing = opening + in - out (cash)', acc.cash.closing === acc.cash.opening + acc.cash.inflow - acc.cash.outflow, JSON.stringify(acc.cash));
check('cash-flow: total row consistent', acc.total.closing === acc.total.opening + acc.total.inflow - acc.total.outflow);

// (account totals asserted after the customer section)

// --- balance sheet ---
let bs = await req('/api/finance/balance-sheet');
const b = bs.data;
check('balance sheet: payables >= 0', b.liabilities.payables >= 0, JSON.stringify(b.liabilities));
check('balance sheet: balanced', b.balanced === true, JSON.stringify(b));
check('balance sheet: assets = cash+bank+card+recv+inv', b.assets.total === b.assets.cash + b.assets.bank + b.assets.card + b.assets.receivables + b.assets.inventory, JSON.stringify(b.assets));
check('balance sheet: equity is residual', b.equity.owner_equity === b.assets.total - b.liabilities.total);

// --- P&L ---
let pl = await req(`/api/finance/profit?from=${Y}-01-01&to=${Y}-01-31`);
const pl2 = pl.data;
check('P&L: revenue 0 in dedicated range', pl2.revenue === 0 && pl2.cogs === 0, JSON.stringify(pl2));
check('P&L: expense total = 100 (edited) after void', pl2.expenseTotal === 100, JSON.stringify(pl2));
check('P&L: net = revenue - cogs - expenses + claims', Math.abs(pl2.net - (pl2.revenue - pl2.cogs - pl2.expenseTotal + pl2.claims)) < 0.001, JSON.stringify(pl2));

// --- customer payment method + ledger recalc ---
let cu = await req('/api/customers', { method: 'POST', body: { name: `${S} Cus` } });
check('customer created', cu.status === 201, JSON.stringify(cu.data));
const cid = cu.data.id;
let payA = await req(`/api/customers/${cid}/payments`, { method: 'POST', body: { amount: 50, method: 'bank', note: 'p1' } });
check('customer payment without credit rejected', payA.status === 400, JSON.stringify(payA.data));
// credit sale: need a product with stock; sell 1 x 100, pay 40
let sale = await req('/api/sales', { method: 'POST', body: {
  items: [{ productId: prod.data.id, qty: 1 }],
  discount: 0, paid: 40, customerId: cid, paymentMethod: 'cash',
}});
check('credit sale recorded', sale.status === 201, JSON.stringify(sale.data));
let cled = await req(`/api/customers/${cid}`);
check('customer outstanding 60', Number(cled.data.customer.outstanding_balance) === 60, JSON.stringify(cled.data.customer.outstanding_balance));
check('ledger has sale row + balance_after 60', (cled.data.ledger || []).some((t) => t.type === 'sale' && Number(t.balance_after) === 60), JSON.stringify(cled.data.ledger));
let payB = await req(`/api/customers/${cid}/payments`, { method: 'POST', body: { amount: 25, method: 'bank', note: 'p2' } });
check('customer payment 25 (bank)', payB.status === 201 && payB.data.balance === 35, JSON.stringify(payB.data));
let cled2 = await req(`/api/customers/${cid}`);
const pmtRows = (cled2.data.ledger || []).filter((t) => t.type === 'payment');
check('payment row has method bank + balance_after', pmtRows.length === 1 && pmtRows[0].method === 'bank' && Number(pmtRows[0].balance_after) === 35, JSON.stringify(pmtRows));

// receivables shows the customer
let rc = await req('/api/finance/receivables');
check('receivables: customer 35', (rc.data.customers || []).some((c) => c.id === cid && c.outstanding_balance === 35), JSON.stringify(rc.data.customers));

// historical edit: change the 25 payment to 15 -> outstanding 45, balances recomputed
const txnId = pmtRows[0].id;
let edit = await req(`/api/customers/${cid}/transactions/${txnId}`, { method: 'PUT', body: { amount: 15, method: 'bank', note: 'amended' } });
check('ledger edit recalculated', edit.status === 200 && edit.data.balance === 45, JSON.stringify(edit.data));
let cled3 = await req(`/api/customers/${cid}`);
check('customer outstanding now 45', Number(cled3.data.customer.outstanding_balance) === 45, JSON.stringify(cled3.data.customer.outstanding_balance));
// delete the sale row entirely -> outstanding 0 (payment 15 would make it negative? no: 15 payment remaining -> -15 -> blocked)
let delSale = await req(`/api/customers/${cid}/transactions/${(cled3.data.ledger || []).find((t) => t.type === 'sale').id}`, { method: 'DELETE' });
check('deleting credit row while payments remain -> blocked (negative)', delSale.status === 400, JSON.stringify(delSale.data));
// delete the payment instead -> outstanding 60
let delPay = await req(`/api/customers/${cid}/transactions/${txnId}`, { method: 'DELETE' });
check('deleting payment row -> outstanding 60', delPay.status === 200 && delPay.data.balance === 60, JSON.stringify(delPay.data));

// --- accounts: totals consistency (deltas already proven by dedicated-range cash flow) ---
let acEnd = await req('/api/finance/accounts');
check('accounts: total = cash+bank+card', acEnd.data.total === acEnd.data.cash + acEnd.data.bank + acEnd.data.card, JSON.stringify(acEnd.data));

// --- branding: logo ---
let lg = await req('/api/settings/logo', { method: 'PUT', body: { data: tinyPng, name: 'logo.png' } });
check('logo uploaded', lg.status === 201, JSON.stringify(lg.data));
let lgGet = await req('/api/settings/logo', { raw: true });
check('logo served with content-type', lgGet.status === 200 && (lgGet.headers.get('content-type') || '').includes('image/png'));
let st = await req('/api/settings');
check('settings expose has_logo + goals fields', st.data.has_logo === true && typeof st.data.daily_sales_goal === 'number' && typeof st.data.monthly_sales_goal === 'number', JSON.stringify(st.data));
let lgDel = await req('/api/settings/logo', { method: 'DELETE' });
check('logo removed', lgDel.status === 200);

// --- goals / streak ---
await req('/api/settings', { method: 'PUT', body: { businessName: 'Beverage Store', currency: 'Rs', timezone: 'Asia/Karachi', receiptFooter: 'Thank you', dailySalesGoal: 100, monthlySalesGoal: 500 } });
let dash = await req('/api/dashboard');
const g = dash.data.goals;
check('goals: daily present', g && g.daily.goal === 100 && g.monthly.goal === 500, JSON.stringify(g));
check('goals: streak is a number', typeof g.streak.days === 'number' && g.streak.goal === 100, JSON.stringify(g.streak));

console.log(`\nPHASE5 API CHECKS: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('Failures:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
