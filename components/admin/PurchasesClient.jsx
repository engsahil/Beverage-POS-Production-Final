'use client';
// Purchases: list + record new purchase (increases stock, transactional).
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import {  formatMoney, formatDate, localDateStr , storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, Badge, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select } from '@/components/ui';
import { IconPlus, IconTrash, IconChevronRight } from '@/components/icons';

const STATUS = {
  paid: { label: 'Paid', tone: 'ok' },
  partially_paid: { label: 'Partially Paid', tone: 'warn' },
  unpaid: { label: 'Unpaid', tone: 'muted' },
  overdue: { label: 'Overdue', tone: 'bad' },
};

export default function PurchasesClient({ settings }) {
  const router = useRouter();
  const toast = useToast();
  const currency = settings?.currency || 'Rs';

  const [purchases, setPurchases] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(() => storeDateStr(settings?.timezone));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]); // { productId, variantId, qty, cost, batchNo, expiryDate }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/purchases');
      setPurchases(d.purchases);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openForm() {
    try {
      const [v, p] = await Promise.all([api('/api/vendors'), api('/api/products')]);
      setVendors(v.vendors.filter((x) => x.active));
      setProducts(p.products.filter((x) => x.active));
      setVendorId('');
      setDate(storeDateStr(settings?.timezone));
      setNotes('');
      setLines([{ productId: '', variantId: '', qty: '', cost: '', batchNo: '', expiryDate: '' }]);
      setShowForm(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function setLine(i, key, value) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, [key]: value };
        // switching product resets the size (sizes belong to a product)
        if (key === 'productId') next.variantId = '';
        return next;
      })
    );
  }
  function addLine() {
    setLines((prev) => [...prev, { productId: '', variantId: '', qty: '', cost: '', batchNo: '', expiryDate: '' }]);
  }
  function removeLine(i) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  async function save() {
    if (saving) return;
    if (!vendorId) {
      toast('Select a vendor.', 'error');
      return;
    }
    const used = lines.filter((l) => l.productId);
    if (used.length === 0) {
      toast('Add at least one product line.', 'error');
      return;
    }
    for (const l of used) {
      const prod = products.find((x) => String(x.id) === String(l.productId));
      const sized = (prod?.variants || []).filter((v) => v.active).length > 0;
      if (sized && !l.variantId) {
        toast(`Select a size for "${prod?.name}".`, 'error');
        return;
      }
      if (!Number(l.qty) || Number(l.qty) <= 0) {
        toast('Every line needs a quantity above zero.', 'error');
        return;
      }
      if (Number(l.cost) === null || Number.isNaN(Number(l.cost)) || Number(l.cost) < 0) {
        toast('Every line needs a valid cost.', 'error');
        return;
      }
    }
    const items = used.map((l) => ({
      productId: Number(l.productId),
      variantId: l.variantId ? Number(l.variantId) : null,
      qty: Number(l.qty),
      cost: Number(l.cost),
      batchNo: l.batchNo?.trim() || null,
      expiryDate: l.expiryDate || null,
    }));
    setSaving(true);
    try {
      const data = await api('/api/purchases', {
        method: 'POST',
        body: { vendorId: Number(vendorId), date, notes: notes.trim(), items },
      });
      toast('Purchase saved. Stock updated.');
      setShowForm(false);
      router.push(`/admin/purchases/${data.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deletePurchaseRow(e, r) {
    e.stopPropagation();
    if (!window.confirm(`Delete Purchase #${r.id} from ${r.vendor_name}? This reverses the stock received.`)) return;
    try {
      await api(`/api/purchases/${r.id}`, { method: 'DELETE' });
      toast('Purchase deleted and stock reconciled.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const columns = [
    {
      key: 'purchase_date',
      label: 'Date',
      render: (r) => <span className="text-stone-600">{formatDate(r.purchase_date, settings?.timezone)}</span>,
    },
    { key: 'vendor_name', label: 'Vendor', render: (r) => <span className="font-medium text-stone-800">{r.vendor_name}</span> },
    { key: 'item_count', label: 'Lines', align: 'right' },
    { key: 'total', label: 'Total', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.total, currency) },
    {
      key: 'paid',
      label: 'Paid / Remaining',
      align: 'right',
      className: 'tabular-nums',
      render: (r) => (
        <span className="text-sm">
          <span className="text-emerald-700 font-medium">{formatMoney(r.paid ?? 0, currency)}</span>
          <span className="text-stone-400"> / </span>
          <span className={Number(r.outstanding ?? 0) > 0.005 ? 'text-amber-600 font-medium' : 'text-stone-400'}>
            {formatMoney(r.outstanding ?? 0, currency)}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const s = STATUS[r.status] || STATUS.unpaid;
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: 'go',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => deletePurchaseRow(e, r)}
            className="p-1.5 rounded text-stone-400 hover:text-red-600 hover:bg-red-50"
            aria-label={`Delete purchase ${r.id}`}
          >
            <IconTrash className="w-4 h-4" />
          </button>
          <IconChevronRight className="w-4 h-4 text-stone-400" />
        </div>
      ),
    },
  ];

  const filtered = purchases && statusFilter !== 'all' ? purchases.filter((p) => p.status === statusFilter) : purchases;

  const FILTERS = [
    ['all', 'All'],
    ['unpaid', 'Unpaid'],
    ['partially_paid', 'Partially Paid'],
    ['overdue', 'Overdue'],
    ['paid', 'Paid'],
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Purchases"
        sub="Stock purchases from vendors — completed purchases increase inventory"
        actions={
          <Button onClick={openForm} disabled={showForm}>
            <IconPlus className="w-4 h-4" /> New Purchase
          </Button>
        }
      />

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {FILTERS.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              statusFilter === val
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !purchases ? (
          <Loading />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            empty={statusFilter === 'all' ? 'No purchases recorded yet.' : `No ${STATUS[statusFilter]?.label || statusFilter} purchases.`}
            onRowClick={(r) => router.push(`/admin/purchases/${r.id}`)}
          />
        )}
      </div>

      {showForm && (
        <Modal
          title="New Purchase"
          wide
          onClose={() => setShowForm(false)}
          footer={
            <>
              <div className="flex-1 text-sm text-stone-600">
                Total: <span className="font-semibold text-stone-900 tabular-nums">{formatMoney(total, currency)}</span>
              </div>
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={save}>
                Save Purchase
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Select label="Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
              <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-stone-600">Products</span>
                <button onClick={addLine} className="text-xs font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1">
                  <IconPlus className="w-3.5 h-3.5" /> Add line
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const prod = products.find((x) => String(x.id) === String(l.productId));
                  const sizedVariants = (prod?.variants || []).filter((v) => v.active);
                  return (
                    <div key={i} className="border border-line rounded-md p-2 space-y-2">
                      <div className="grid grid-cols-[1fr_70px_90px_32px] gap-2 items-center">
                        <select
                          value={l.productId}
                          onChange={(e) => setLine(i, 'productId', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        >
                          <option value="">Select product</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          placeholder="Qty"
                          value={l.qty}
                          onChange={(e) => setLine(i, 'qty', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        />
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-stone-400">{currency}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Cost"
                            value={l.cost}
                            onChange={(e) => setLine(i, 'cost', e.target.value)}
                            className="w-full rounded-md border border-stone-300 bg-white py-1.5 pl-7 pr-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                          />
                        </div>
                        <button
                          onClick={() => removeLine(i)}
                          disabled={lines.length === 1}
                          className="p-1.5 rounded text-stone-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-30"
                          aria-label="Remove line"
                        >
                          <IconTrash className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_130px] gap-2 items-center">
                        {sizedVariants.length > 0 ? (
                          <select
                            value={l.variantId}
                            onChange={(e) => setLine(i, 'variantId', e.target.value)}
                            className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                          >
                            <option value="">Select size…</option>
                            {sizedVariants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] text-stone-400">Stock goes to the product</span>
                        )}
                        <input
                          type="text"
                          placeholder="Batch no. (optional)"
                          value={l.batchNo || ''}
                          onChange={(e) => setLine(i, 'batchNo', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        />
                        <input
                          type="date"
                          title="Batch expiry (optional)"
                          value={l.expiryDate || ''}
                          onChange={(e) => setLine(i, 'expiryDate', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Optional" />
          </div>
        </Modal>
      )}
    </div>
  );
}
