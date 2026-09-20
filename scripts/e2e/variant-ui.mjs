// Browser verification of the full variant-level UI (Phase 5).
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const NAME = `VC Juice ${Date.now().toString().slice(-6)}`;
let pass = 0, fail = 0; const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name} ${extra}`); }
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

// Field component: <label><span>Label</span><input|select></label>
const fieldInput = (scope, labelText) => scope.locator(`label:has-text("${labelText}") input`).first();
const fieldSelect = (scope, labelText) => scope.locator(`label:has-text("${labelText}") select`).first();
// The Sizes section (direct child of the modal body)
const sizesSection = page.locator('div:has(> div:has-text("Sizes (optional)"))').first();
const sizeCards = () => sizesSection.locator('.space-y-2 > div');

// login
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[placeholder="Enter username"]', 'admin');
await page.fill('input[placeholder="Enter password"]', 'Admin123');
await Promise.all([page.waitForURL('**/admin', { timeout: 15000 }), page.click('button[type="submit"]')]);
await page.waitForSelector('h1');
await page.waitForTimeout(900);
const skip = page.locator('div.fixed.inset-0.z-50 button:has-text("Skip")');
if (await skip.count()) await skip.first().click();

// ---------- 1) Products: create with sizes ----------
await page.click('aside nav a:has-text("Products")');
await page.waitForSelector('h1:has-text("Products")');
await page.click('button:has-text("Add product")');
await page.waitForSelector('label:has-text("Selling price") input');
await page.fill('input[placeholder="e.g. Lemon Iced Tea"]', NAME);
await page.locator('label:has(span:text-is("Selling price")) input').first().fill('50');
await page.click('button:has-text("Add size")');
await page.waitForTimeout(150);
let card0 = sizeCards().first();
await fieldInput(card0, 'Size name').fill('250 ml');
await fieldInput(card0, 'Selling price').fill('60');
await fieldInput(card0, 'Stock').fill('12');
await fieldInput(card0, 'Batch no.').fill('B-100');
await page.click('button:has-text("Add size")');
await page.waitForTimeout(150);
const card1 = sizeCards().nth(1);
await fieldInput(card1, 'Size name').fill('500 ml');
await fieldInput(card1, 'Selling price').fill('90');
await fieldInput(card1, 'Stock').fill('8');
await page.click('button:has-text("Save product")');
await page.waitForTimeout(500);
check('product created with 2 sizes', (await page.locator(`tr:has-text("${NAME}")`).count()) === 1);
const rowBadge = await page.locator(`tr:has-text("${NAME}")`).textContent();
check('list shows 2 sizes badge + stock 20', /20/.test(rowBadge));

// ---------- 2) POS: picker + sale ----------
await page.click('aside nav a:has-text("POS")');
await page.waitForSelector('h1:has-text("Point of Sale")');
await page.waitForTimeout(500);
await page.fill('input[placeholder="Search product or scan barcode"]', NAME);
await page.waitForTimeout(400);
await page.click(`button:has-text("${NAME}")`);
await page.waitForSelector('text=Choose a size');
const picker = page.locator('.fixed.z-50').last();
const pickerText = await picker.textContent();
check('picker shows both sizes', pickerText.includes('250 ml') && pickerText.includes('500 ml'));
check('picker shows per-size stock', pickerText.includes('12 in stock') && pickerText.includes('8 in stock'));
await picker.locator('button:has-text("250 ml")').click();
await page.waitForTimeout(300);
const cartText = await page.locator('aside').last().textContent(); // cart panel (Sidebar is the first aside)
check('cart line shows size + price', cartText.includes('250 ml') && cartText.includes('60'));
await page.locator('button[aria-label="Increase"]').first().click();
await page.fill('input[aria-label="Customer paid"]', '120');
await page.click('button:has-text("Complete Sale")');
await page.waitForURL(/\/sales\/\d+/, { timeout: 15000 });
await page.waitForSelector('#print-area .r-item-variant', { timeout: 10000, state: 'attached' });
const salePage = await page.textContent('body');
check('receipt shows size line', salePage.includes('250 ml'));

// ---------- 2b) Create a vendor (needed for purchases; seed has none) ----------
await page.click('aside nav a:has-text("Vendors")');
await page.waitForSelector('h1:has-text("Vendors")');
if ((await page.locator('tr:has-text("City Water Co")').count()) === 0) {
  await page.click('button:has-text("Add Vendor")');
  await page.waitForSelector('label:has-text("Name") input');
  await page.locator('label:has-text("Name") input').first().fill('City Water Co');
  await page.locator('label:has-text("Phone") input').fill('0300-1112223');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('tr:has-text("City Water Co")', { timeout: 10000 });
  check('vendor created via UI', true);
} else {
  check('vendor created via UI (already present)', true);
}

// ---------- 3) Purchases: receive into a size with batch ----------
await page.click('aside nav a:has-text("Purchases")');
await page.waitForSelector('h1:has-text("Purchases")');
await page.click('button:has-text("New Purchase")');
await page.waitForSelector('label:has-text("Vendor") select');
await fieldSelect(page, 'Vendor').selectOption({ label: 'City Water Co' });
await page.click('button:has-text("Add line")');
await page.waitForTimeout(150);
const lastProductSelect = page.locator('select', { hasText: 'Select product' }).last();
await lastProductSelect.selectOption({ label: NAME });
await page.waitForTimeout(150);
const sizeSelect = page.locator('select', { hasText: 'Select size' }).last();
check('size select appears for sized product', (await sizeSelect.count()) === 1);
await sizeSelect.selectOption({ label: '500 ml' });
const qtyInputs = page.locator('input[placeholder="Qty"]');
await qtyInputs.last().fill('3');
const costInputs = page.locator('input[placeholder="Cost"]');
await costInputs.last().fill('40');
await page.locator('input[placeholder="Batch no. (optional)"]').last().fill('B-200');
await page.click('button:has-text("Save Purchase")');
await page.waitForTimeout(800);
check('purchase saved (detail page)', page.url().includes('/admin/purchases/'));

// inventory: size breakdown + batch
await page.click('aside nav a:has-text("Inventory")');
await page.waitForSelector('h1:has-text("Inventory")');
const showBtn = page.locator(`tr:has-text("${NAME}") button[aria-label="Show sizes"]`);
await showBtn.first().click();
await page.waitForTimeout(300);
const invText = await page.textContent('body');
check('inventory shows size breakdown', invText.includes('250 ml') && invText.includes('500 ml'));
check('inventory shows batch B-200', invText.includes('B-200'));

// ---------- 4) Products edit: price update, duplicate, remove ----------
await page.click('aside nav a:has-text("Products")');
await page.waitForSelector('h1:has-text("Products")');
await page.locator(`tr:has-text("${NAME}") button[title="Edit"]`).click();
await page.waitForSelector('button:has-text("Save product")');
await page.locator('button:has-text("Edit")').first().click();
await page.waitForTimeout(150);
await fieldInput(sizeCards().first(), 'Selling price').fill('65');
await page.click('button:has-text("Save product")');
await page.waitForTimeout(500);
const afterEdit = await page.locator(`tr:has-text("${NAME}")`).textContent();
check('edited size price persisted (from Rs 65)', afterEdit.includes('65'));

await page.locator(`tr:has-text("${NAME}") button[title="Edit"]`).click();
await page.waitForSelector('button:has-text("Save product")');
await page.click('button:has-text("Duplicate")');
await page.waitForTimeout(150);
await page.click('button:has-text("Save product")');
await page.waitForTimeout(500);

await page.locator(`tr:has-text("${NAME}") button[title="Edit"]`).click();
await page.waitForSelector('button:has-text("Save product")');
const sizeCount = await sizeCards().count();
check('duplicate added a 3rd size', sizeCount === 3, `cards=${sizeCount}`);
await sizeCards().locator('button:has-text("Remove")').last().click();
await page.waitForTimeout(400);
await page.click('button:has-text("Save product")');
await page.waitForTimeout(500);

await page.locator(`tr:has-text("${NAME}") button[title="Edit"]`).click();
await page.waitForSelector('button:has-text("Save product")');
const sizeCount2 = await sizeCards().count();
check('remove reverted to 2 sizes', sizeCount2 === 2, `cards=${sizeCount2}`);
await page.click('button:has-text("Cancel")');

console.log(`\nUI VARIANT CHECKS: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('Failures:\n  - ' + failures.join('\n  - '));
console.log(`Console/page errors: ${errors.length ? JSON.stringify(errors.slice(0, 6)) : '0'}`);
await browser.close();
process.exit(fail ? 1 : 0);
