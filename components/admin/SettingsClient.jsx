'use client';
// Settings: business profile, my account, local CSV export/import and
// scoped test-data clearing. All data operations are explicit and
// transactional on the server side.
import { useRef, useState } from 'react';
import { api, downloadCsv } from '@/lib/api-client';
import { formatMoney, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, Card, Input, Select, PageHeader } from '@/components/ui';
import { IconUpload, IconTrash } from '@/components/icons';

const TIMEZONES = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Europe/London',
  'UTC',
];

const IMPORT_ENTITIES = [
  { key: 'products', label: 'Products', headers: 'name, price (required) + barcode, category, cost, stock, min_stock, min_price, expiry_date' },
  { key: 'customers', label: 'Customers', headers: 'name (required) + phone, address, notes' },
  { key: 'vendors', label: 'Vendors', headers: 'name (required)' },
];

export default function SettingsClient({ user, initial }) {
  const toast = useToast();

  const [bizName, setBizName] = useState(initial?.business_name || '');
  const [currency, setCurrency] = useState(initial?.currency || 'Rs');
  const [timezone, setTimezone] = useState(initial?.timezone || 'Asia/Karachi');
  const [footer, setFooter] = useState(initial?.receipt_footer || '');
  const [savingBiz, setSavingBiz] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(String(initial?.daily_sales_goal ?? 0));
  const [monthlyGoal, setMonthlyGoal] = useState(String(initial?.monthly_sales_goal ?? 0));

  // Branding
  const [hasLogo, setHasLogo] = useState(Boolean(initial?.has_logo));
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef(null);

  const [fullName, setFullName] = useState(user.full_name || '');
  const [newUsername, setNewUsername] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingAcc, setSavingAcc] = useState(false);

  const [exporting, setExporting] = useState('');

  // Import
  const importFileRef = useRef(null);
  const [impEntity, setImpEntity] = useState('products');
  const [impContent, setImpContent] = useState('');
  const [impFileName, setImpFileName] = useState('');
  const [impPreview, setImpPreview] = useState(null);
  const [impBusy, setImpBusy] = useState('');

  // Clear
  const [clearOp, setClearOp] = useState('sales');
  // Default "clear before" = business today in the store timezone, matching
  // how the server interprets the date (not the machine's local date).
  const [clearBefore, setClearBefore] = useState(() => storeDateStr(initial?.timezone));
  const [clearConfirm, setClearConfirm] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [clearResult, setClearResult] = useState(null);

  async function saveBusiness(e) {
    e.preventDefault();
    if (savingBiz) return;
    setSavingBiz(true);
    try {
      const d = await api('/api/settings', {
        method: 'PUT',
        body: {
          businessName: bizName.trim(),
          currency: currency.trim(),
          timezone,
          receiptFooter: footer,
          dailySalesGoal: dailyGoal === '' ? 0 : Number(dailyGoal),
          monthlySalesGoal: monthlyGoal === '' ? 0 : Number(monthlyGoal),
        },
      });
      if (d) {
        setDailyGoal(String(d.daily_sales_goal ?? ''));
        setMonthlyGoal(String(d.monthly_sales_goal ?? ''));
      }
      toast('Settings saved.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingBiz(false);
    }
  }

  async function onLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Logo must be a JPG, PNG or WebP image.', 'error');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast('Image is too large (max 4 MB). Choose a smaller image.', 'error');
      return;
    }
    setLogoBusy(true);
    try {
      // Downscale to 512px so the stored logo stays small and crisp on
      // receipts. Re-encoded as JPEG (transparent PNG becomes white).
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => {
            const max = 512;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
          };
          img.onerror = reject;
          img.src = fr.result;
        };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      await api('/api/settings/logo', { method: 'PUT', body: { data: dataUrl } });
      setHasLogo(true);
      toast('Logo updated. It now appears on the app, POS header and receipts.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm('Remove the business logo?')) return;
    setLogoBusy(true);
    try {
      await api('/api/settings/logo', { method: 'DELETE' });
      setHasLogo(false);
      toast('Logo removed.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLogoBusy(false);
    }
  }

  async function saveAccount(e) {
    e.preventDefault();
    if (savingAcc) return;
    setSavingAcc(true);
    try {
      const body = { currentPassword: currentPw };
      if (fullName !== (user.full_name || '')) body.fullName = fullName;
      if (newUsername.trim()) body.newUsername = newUsername.trim();
      if (newPw) body.newPassword = newPw;
      await api('/api/account', { method: 'POST', body });
      toast('Account updated.');
      setCurrentPw('');
      setNewPw('');
      setNewUsername('');
      window.location.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingAcc(false);
    }
  }

  async function exportData(kind) {
    if (exporting) return;
    setExporting(kind);
    try {
      if (kind === 'sales') {
        const d = await api('/api/sales');
        downloadCsv('export_sales.csv', [
          { key: 'sale_no', label: 'Sale No' },
          { key: 'created_at', label: 'Date' },
          { key: 'cashier_name', label: 'Cashier' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'subtotal', label: 'Subtotal' },
          { key: 'discount', label: 'Discount' },
          { key: 'total', label: 'Total' },
          { key: 'payment_method', label: 'Payment' },
          { key: 'paid', label: 'Paid' },
          { key: 'change_due', label: 'Change' },
        ], d.sales);
      } else if (kind === 'products') {
        const d = await api('/api/products');
        downloadCsv('export_products.csv', [
          { key: 'name', label: 'name' },
          { key: 'barcode', label: 'barcode' },
          { key: 'category_name', label: 'category' },
          { key: 'price', label: 'price' },
          { key: 'cost', label: 'cost' },
          { key: 'stock', label: 'stock' },
          { key: 'min_stock', label: 'min_stock' },
          { key: 'min_price', label: 'min_price' },
          { key: 'expiry_date', label: 'expiry_date' },
          { key: 'active', label: 'active' },
        ], d.products);
      } else if (kind === 'categories') {
        const d = await api('/api/categories');
        downloadCsv('export_categories.csv', [
          { key: 'name', label: 'name' },
          { key: 'active', label: 'active' },
        ], d.categories);
      } else if (kind === 'customers') {
        const d = await api('/api/customers');
        downloadCsv('export_customers.csv', [
          { key: 'name', label: 'name' },
          { key: 'phone', label: 'phone' },
          { key: 'address', label: 'address' },
          { key: 'notes', label: 'notes' },
        ], d.customers);
      } else if (kind === 'vendors') {
        const d = await api('/api/vendors');
        downloadCsv('export_vendors.csv', [{ key: 'name', label: 'name' }], d.vendors);
      } else if (kind === 'purchases') {
        const d = await api('/api/purchases');
        downloadCsv('export_purchases.csv', [
          { key: 'purchase_date', label: 'Date' },
          { key: 'vendor_name', label: 'Vendor' },
          { key: 'total', label: 'Total' },
          { key: 'notes', label: 'Notes' },
          { key: 'created_by_name', label: 'By' },
        ], d.purchases);
      } else if (kind === 'inventory') {
        const d = await api('/api/reports/inventory');
        downloadCsv('export_inventory.csv', d.columns, d.rows);
      }
      toast('CSV exported (local download).');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExporting('');
    }
  }

  // ---- import ----
  function onPickImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('File is too large (max 2 MB).', 'error');
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      setImpContent(String(fr.result));
      setImpFileName(file.name);
      setImpPreview(null);
    };
    fr.onerror = () => toast('Could not read that file.', 'error');
    fr.readAsText(file);
  }

  async function runPreview() {
    if (impBusy) return;
    if (!impContent.trim()) {
      toast('Choose a CSV file first.', 'error');
      return;
    }
    setImpBusy('preview');
    setImpPreview(null);
    try {
      const d = await api('/api/import/preview', { method: 'POST', body: { entity: impEntity, content: impContent } });
      setImpPreview(d);
      if (d.errors.length > 0) toast(`${d.errors.length} rows have problems. Fix them and preview again.`, 'error');
      else if (d.willInsert === 0) toast('Nothing to import — every row is a duplicate.', 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImpBusy('');
    }
  }

  async function applyImport() {
    if (impBusy) return;
    if (!impPreview || impPreview.willInsert === 0) return;
    setImpBusy('apply');
    try {
      const d = await api('/api/import/apply', { method: 'POST', body: { entity: impEntity, content: impContent } });
      toast(`Imported ${d.inserted} rows${d.skipped ? `, skipped ${d.skipped} duplicates` : ''}.`);
      setImpContent('');
      setImpFileName('');
      setImpPreview(null);
    } catch (err) {
      if (err.data?.errors?.length) {
        toast(err.message + ' Nothing was changed (rolled back).', 'error');
      } else {
        toast(err.message, 'error');
      }
      setImpPreview(null);
    } finally {
      setImpBusy('');
    }
  }

  // ---- clear ----
  async function runClear() {
    if (clearBusy) return;
    if (clearConfirm !== 'DELETE') {
      toast('Type DELETE in the confirmation box.', 'error');
      return;
    }
    setClearBusy(true);
    setClearResult(null);
    try {
      const d = await api('/api/data/clear', {
        method: 'POST',
        body: { operation: clearOp, before: clearBefore, confirm: 'DELETE' },
      });
      setClearResult(d);
      setClearConfirm('');
      toast('Operation completed.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Settings" sub="Business profile, your account, local data import/export and test-data clearing" />

      <Card title="Business Profile" className="mb-4">
        <form onSubmit={saveBusiness} className="p-4 space-y-3.5">
          <Input label="Business name" value={bizName} onChange={(e) => setBizName(e.target.value)} required maxLength={80} hint="Shown on the login screen and receipts." />
          <div className="grid grid-cols-2 gap-3.5">
            <Input label="Currency label" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} hint="e.g. Rs" />
            <Select label="Business timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <Input label="Receipt footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={160} />
          <div className="grid grid-cols-2 gap-3.5">
            <Input label="Daily sales goal" type="number" min="0" step="0.01" value={dailyGoal} onChange={(e) => setDailyGoal(e.target.value)} placeholder="0" hint="Drives the Streak counter on the dashboard. 0 = off." />
            <Input label="Monthly sales goal" type="number" min="0" step="0.01" value={monthlyGoal} onChange={(e) => setMonthlyGoal(e.target.value)} placeholder="0" hint="Month-to-date target. 0 = off." />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={savingBiz}>
              Save Settings
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Branding — Logo" className="mb-4">
        <div className="p-4">
          <div className="flex items-center gap-4">
            {hasLogo ? (
              <img src="/api/settings/logo" alt="Business logo" className="w-16 h-16 rounded-md object-contain bg-cream border border-line" />
            ) : (
              <div className="w-16 h-16 rounded-md bg-cream border border-dashed border-stone-300 flex items-center justify-center text-stone-300 text-xs">No logo</div>
            )}
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => logoFileRef.current?.click()} loading={logoBusy}>
                  <IconUpload className="w-3.5 h-3.5" /> {hasLogo ? 'Replace logo' : 'Upload logo'}
                </Button>
                {hasLogo && (
                  <Button variant="ghost" size="sm" onClick={removeLogo} disabled={logoBusy}>
                    <IconTrash className="w-3.5 h-3.5" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-stone-500 leading-relaxed max-w-md">
                Shown in the app header, the POS header and printed receipts (sized so it never breaks the
                thermal layout). JPG, PNG or WebP, max 4 MB — stored in the database with your other data.
              </p>
            </div>
            <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onLogoFile} />
          </div>
        </div>
      </Card>


      <Card title="My Account" className="mb-4">
        <form onSubmit={saveAccount} className="p-4 space-y-3.5">
          <Input label="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
          <Input label="New username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={user.username} hint="Leave empty to keep the current username." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input label="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" required />
            <Input label="New password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Leave empty to keep current" autoComplete="new-password" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={savingAcc}>
              Update Account
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Local Backup — CSV Export" className="mb-4">
        <div className="p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={() => exportData('products')} loading={exporting === 'products'}>Products</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('categories')} loading={exporting === 'categories'}>Categories</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('customers')} loading={exporting === 'customers'}>Customers</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('vendors')} loading={exporting === 'vendors'}>Vendors</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('sales')} loading={exporting === 'sales'}>Sales</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('purchases')} loading={exporting === 'purchases'}>Purchases</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('inventory')} loading={exporting === 'inventory'}>Inventory</Button>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed">
            LOCAL BACKUP: these files are downloaded to your device only — nothing is uploaded anywhere.
            They are working copies, not a full disaster-recovery backup: for a true backup, dump the
            PostgreSQL database (e.g. from Neon) and keep it somewhere safe.
          </p>
        </div>
      </Card>

      <Card title="CSV Import" className="mb-4">
        <div className="p-4 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select label="What to import" value={impEntity} onChange={(e) => { setImpEntity(e.target.value); setImpPreview(null); }}>
              {IMPORT_ENTITIES.map((i) => (
                <option key={i.key} value={i.key}>{i.label}</option>
              ))}
            </Select>
            <div>
              <span className="block text-xs font-medium text-stone-600 mb-1.5">CSV file</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-cream"
                >
                  Choose file
                </button>
                <span className="text-xs text-stone-500 truncate flex-1">{impFileName || 'No file selected'}</span>
              </div>
              <input ref={importFileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onPickImportFile} />
            </div>
          </div>
          <p className="text-xs text-stone-500">
            Expected columns: {IMPORT_ENTITIES.find((i) => i.key === impEntity).headers}.
            First row must be the header. Duplicates (same barcode/name, or phone for customers) are skipped, never overwritten.
            The whole import is one transaction: if any row fails, nothing is changed.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={runPreview} loading={impBusy === 'preview'} disabled={!impContent}>
              Preview
            </Button>
            <Button size="sm" onClick={applyImport} loading={impBusy === 'apply'} disabled={!impPreview || impPreview.willInsert === 0}>
              Apply Import
            </Button>
          </div>
          {impPreview && (
            <div className="border border-line rounded-md p-3 text-sm space-y-1.5 bg-cream/50">
              <div>
                Rows: {impPreview.totalRows} · Valid: {impPreview.validRows} · Duplicates skipped: {impPreview.duplicates} ·{' '}
                <span className="font-semibold">Will import: {impPreview.willInsert}</span>
              </div>
              {impPreview.errors.length > 0 && (
                <ul className="text-xs text-red-700 space-y-0.5 max-h-32 overflow-y-auto">
                  {impPreview.errors.slice(0, 20).map((er, i) => (
                    <li key={i}>Row {er.row}: {er.message}</li>
                  ))}
                  {impPreview.errors.length > 20 && <li>…and {impPreview.errors.length - 20} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Clear Test Data (destructive)" className="mb-4">
        <div className="p-4 space-y-3.5">
          <p className="text-xs text-stone-500 leading-relaxed">
            Scoped cleanup for test data only. Every operation is transactional and never touches
            products, categories, settings, users or shifts.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select label="Operation" value={clearOp} onChange={(e) => setClearOp(e.target.value)}>
              <option value="sales">Delete test sales (before a date) + restore their stock</option>
              <option value="customers">Delete customers with no sales and no ledger entries</option>
              <option value="expenses">Delete expenses (before a date)</option>
            </Select>
            {clearOp !== 'customers' && (
              <Input label="Before date" type="date" value={clearBefore} onChange={(e) => setClearBefore(e.target.value)} hint="Only data strictly before this date is affected." />
            )}
          </div>
          <Input
            label="Type DELETE to confirm"
            value={clearConfirm}
            onChange={(e) => setClearConfirm(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex items-center gap-3">
            <Button variant="danger" size="sm" loading={clearBusy} onClick={runClear}>
              Run Operation
            </Button>
            {clearResult && (
              <span className="text-sm text-stone-600">
                Deleted: {clearResult.deleted}
                {clearResult.skipped > 0 ? ` · Skipped (has credit ledger): ${clearResult.skipped}` : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] text-stone-400">
            Sales that created customer credit are skipped so the ledger stays consistent.
            Deleting sales restores the stock those sales removed, and the movement history records it.
          </p>
        </div>
      </Card>

      <Card title="Getting Started Guide">
        <div className="p-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent('bevpos:open-guide'))}
          >
            Show the first-time guide again
          </Button>
        </div>
      </Card>
    </div>
  );
}
