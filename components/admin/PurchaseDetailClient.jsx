'use client';
// Purchase detail: invoice + edit purchase + delete purchase + payment history + attachment.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, formatQty, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, Card, DataTable, ErrorBox, Loading, Modal, PageHeader, Badge, Input, Select } from '@/components/ui';
import { IconPlus, IconUpload, IconTrash, IconDownload, IconPencil } from '@/components/icons';

const STATUS = {
  paid: { label: 'Paid', tone: 'ok' },
  partially_paid: { label: 'Partially Paid', tone: 'warn' },
  unpaid: { label: 'Unpaid', tone: 'muted' },
  overdue: { label: 'Overdue', tone: 'bad' },
};

const iso = (d) => (d ? String(d).slice(0, 10) : '');

export default function PurchaseDetailClient({ purchaseId, settings }) {
  const router = useRouter();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: '',
    method: 'cash',
    paymentDate: storeDateStr(tz),
    reference: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [attBusy, setAttBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef(null);

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [editVendorId, setEditVendorId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editLines, setEditLines] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/purchases/${purchaseId}`));
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [purchaseId]);

  useEffect(() => {
    load();
  }, [load]);

  function populateEditFromCurrent(purchase, items) {
    setEditVendorId(String(purchase.vendor_id));
    setEditDate(iso(purchase.purchase_date) || storeDateStr(tz));
    setEditNotes(purchase.notes || '');
    setEditLines(
      (items || []).map((it) => ({
        productId: String(it.product_id),
        variantId: it.variant_id ? String(it.variant_id) : '',
        qty: String(it.qty),
        cost: String(it.cost),
        batchNo: it.batch_no || '',
        expiryDate: iso(it.expiry_date),
      }))
    );
  }

  async function openEditModal() {
    if (!data) return;
    try {
      const [vRes, pRes] = await Promise.all([api('/api/vendors'), api('/api/products')]);
      setVendors((vRes.vendors || []).filter((v) => v.active || v.id === data.purchase.vendor_id));
      setProducts(pRes.products || []);
      populateEditFromCurrent(data.purchase, data.items);
      setShowEdit(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function setEditLine(i, key, value) {
    setEditLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, [key]: value };
        if (key === 'productId') next.variantId = '';
        return next;
      })
    );
  }

  function addEditLine() {
    setEditLines((prev) => [
      ...prev,
      { productId: '', variantId: '', qty: '', cost: '', batchNo: '', expiryDate: '' },
    ]);
  }

  function removeEditLine(i) {
    setEditLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function saveEdit() {
    if (editSaving) return;
    if (!editVendorId) return toast('Select a vendor.', 'error');
    if (!editDate) return toast('Select a valid purchase date.', 'error');
    const used = editLines.filter((l) => l.productId);
    if (used.length === 0) return toast('Add at least one product line.', 'error');

    for (const l of used) {
      const prod = products.find((x) => String(x.id) === String(l.productId));
      const sized = (prod?.variants || []).filter((v) => v.active).length > 0;
      if (sized && !l.variantId) {
        return toast(`Select a size for "${prod?.name}".`, 'error');
      }
      if (!Number(l.qty) || Number(l.qty) <= 0) {
        return toast('Every line needs a quantity above zero.', 'error');
      }
      if (l.cost === '' || Number.isNaN(Number(l.cost)) || Number(l.cost) < 0) {
        return toast('Every line needs a valid cost.', 'error');
      }
    }

    const payloadItems = used.map((l) => ({
      productId: Number(l.productId),
      variantId: l.variantId ? Number(l.variantId) : null,
      qty: Number(l.qty),
      cost: Number(l.cost),
      batchNo: l.batchNo?.trim() || null,
      expiryDate: l.expiryDate || null,
    }));

    setEditSaving(true);
    try {
      const updated = await api(`/api/purchases/${purchaseId}`, {
        method: 'PUT',
        body: {
          vendorId: Number(editVendorId),
          date: editDate,
          notes: editNotes.trim(),
          items: payloadItems,
        },
      });
      setData(updated);
      setShowEdit(false);
      toast('Purchase updated. Inventory and vendor balance reconciled.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeletePurchase() {
    if (deleting) return;
    if (
      !window.confirm(
        `Delete Purchase #${purchaseId}? This reverses the stock received from this purchase and updates the vendor balance.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/api/purchases/${purchaseId}`, { method: 'DELETE' });
      toast('Purchase deleted and inventory reconciled.');
      router.push('/admin/purchases');
    } catch (err) {
      toast(err.message, 'error');
      setDeleting(false);
    }
  }

  if (error)
    return (
      <div className="p-6 max-w-4xl">
        <ErrorBox message={error} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    );

  const { purchase, items, payments, remaining } = data;
  const st = STATUS[purchase.status] || STATUS.unpaid;
  const editTotal = editLines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0),
    0
  );

  async function addPayment(e) {
    if (e) e.preventDefault();
    if (saving) return;
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) return toast('Enter an amount above zero.', 'error');
    if (amount > Number(remaining) + 0.001) {
      return toast(`Amount exceeds the remaining balance (${formatMoney(remaining, currency)}).`, 'error');
    }
    setSaving(true);
    try {
      await api(`/api/purchases/${purchaseId}/payments`, {
        method: 'POST',
        body: {
          amount,
          method: payForm.method,
          paymentDate: payForm.paymentDate || null,
          reference: payForm.reference.trim(),
          note: payForm.note.trim(),
        },
      });
      toast('Payment recorded.');
      setPayForm({ amount: '', method: 'cash', paymentDate: storeDateStr(tz), reference: '', note: '' });
      setShowPay(false);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removePayment(p) {
    if (!window.confirm(`Remove this ${formatMoney(p.amount, currency)} payment? The amount becomes due again.`)) return;
    try {
      await api(`/api/purchases/${purchaseId}/payments/${p.id}`, { method: 'DELETE' });
      toast('Payment removed.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function uploadAttachment() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast('File is too large (max 4 MB).', 'error');
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      return toast('Attach a JPG, PNG, WebP or PDF file.', 'error');
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) return toast('Could not read the file.', 'error');
    setAttBusy(true);
    try {
      await api(`/api/purchases/${purchaseId}/attachment`, {
        method: 'PUT',
        body: { data: dataUrl, name: file.name },
      });
      toast('Attachment saved.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAttBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeAttachment() {
    if (!window.confirm('Remove the invoice attachment?')) return;
    try {
      await api(`/api/purchases/${purchaseId}/attachment`, { method: 'DELETE' });
      toast('Attachment removed.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const itemColumns = [
    {
      key: 'product_name',
      label: 'Product',
      render: (r) => (
        <span>
          <span className="font-medium">{r.product_name}</span>
          {r.variant_name && <span className="text-stone-500"> · {r.variant_name}</span>}
          {r.batch_no && <span className="text-stone-400"> · batch {r.batch_no}</span>}
        </span>
      ),
    },
    { key: 'qty', label: 'Qty', align: 'right', className: 'tabular-nums', render: (r) => formatQty(r.qty) },
    { key: 'cost', label: 'Unit Cost', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.cost, currency) },
    {
      key: 'expiry_date',
      label: 'Batch Expiry',
      render: (r) => (r.expiry_date ? String(r.expiry_date).slice(0, 10) : <span className="text-stone-400">—</span>),
    },
    {
      key: 'line',
      label: 'Line Total',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => formatMoney(Number(r.qty) * Number(r.cost), currency),
    },
  ];

  const payColumns = [
    { key: 'payment_date', label: 'Date', render: (r) => <span className="text-stone-600">{String(r.payment_date).slice(0, 10)}</span> },
    { key: 'method', label: 'Method', render: (r) => <Badge tone={r.method === 'cash' ? 'ok' : r.method === 'bank' ? 'muted' : 'warn'}>{r.method}</Badge> },
    { key: 'reference', label: 'Reference', render: (r) => <span className="text-stone-600">{r.reference || '—'}</span> },
    { key: 'note', label: 'Notes', render: (r) => <span className="text-stone-500">{r.note || '—'}</span> },
    { key: 'amount', label: 'Amount', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatMoney(r.amount, currency) },
    {
      key: 'del',
      label: '',
      align: 'right',
      render: (r) => (
        <button
          onClick={() => removePayment(r)}
          className="p-1.5 rounded text-stone-400 hover:text-red-600 hover:bg-red-50"
          aria-label="Remove payment"
        >
          <IconTrash className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        back={{ href: '/admin/purchases', label: 'Purchases' }}
        title={`Purchase #${purchase.id}`}
        sub={`${purchase.vendor_name} · ${formatDate(purchase.purchase_date, tz)} · due ${formatDate(purchase.due_date, tz)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Button variant="secondary" size="sm" onClick={openEditModal}>
              <IconPencil className="w-3.5 h-3.5" /> Edit Purchase
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDeletePurchase}>
              <IconTrash className="w-3.5 h-3.5" /> Delete Purchase
            </Button>
          </div>
        }
      />

      {/* Money summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Invoice total</div>
          <div className="text-2xl font-bold tabular-nums text-stone-900">{formatMoney(purchase.total, currency)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Paid</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-700">{formatMoney(purchase.paid, currency)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Remaining</div>
          <div className={`text-2xl font-bold tabular-nums ${Number(remaining) > 0 ? 'text-amber-600' : 'text-stone-400'}`}>
            {formatMoney(remaining, currency)}
          </div>
        </Card>
      </div>

      <Card title="Items" className="mb-4 overflow-hidden">
        <DataTable columns={itemColumns} rows={items} empty="No items." />
        <div className="px-4 py-3 border-t border-line flex items-center justify-between bg-cream/50">
          <span className="text-sm text-stone-600">{purchase.notes ? `Notes: ${purchase.notes}` : ''}</span>
          <span className="text-sm text-stone-600">
            Total: <span className="font-bold text-stone-900 tabular-nums">{formatMoney(purchase.total, currency)}</span>
          </span>
        </div>
      </Card>

      {/* Payments */}
      <Card
        title={`Payments (${payments.length})`}
        className="mb-4 overflow-hidden"
        actions={
          Number(remaining) > 0.005 ? (
            <Button size="sm" onClick={() => setShowPay((v) => !v)}>
              <IconPlus className="w-3.5 h-3.5" /> {showPay ? 'Close' : 'Add Payment'}
            </Button>
          ) : null
        }
      >
        {showPay && (
          <form onSubmit={addPayment} className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-4 py-3 border-b border-line bg-cream/40">
            <Input
              label={`Amount (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder={`Max ${Number(remaining).toFixed(2)}`}
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
            />
            <Select label="Method" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="card">Card</option>
            </Select>
            <Input
              label="Date"
              type="date"
              value={payForm.paymentDate}
              onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
            />
            <Input
              label="Reference"
              placeholder="Cheque / TT no."
              value={payForm.reference}
              onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
            />
            <Input label="Notes" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
            <div className="col-span-2 sm:col-span-5 flex justify-end">
              <Button type="submit" loading={saving}>
                Record Payment
              </Button>
            </div>
          </form>
        )}
        <DataTable columns={payColumns} rows={payments} empty="No payments yet." />
      </Card>

      {/* Attachment */}
      <Card
        title="Invoice Attachment"
        className="overflow-hidden"
        actions={
          <div className="flex items-center gap-2">
            {purchase.has_attachment && (
              <>
                <a
                  href={`/api/purchases/${purchaseId}/attachment`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-cream"
                >
                  <IconDownload className="w-3.5 h-3.5" /> {purchase.attachment_name || 'Download'}
                </a>
                <button
                  onClick={removeAttachment}
                  className="p-1.5 rounded text-stone-400 hover:text-red-600 hover:bg-red-50"
                  aria-label="Remove attachment"
                >
                  <IconTrash className="w-4 h-4" />
                </button>
              </>
            )}
            <label className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-cream cursor-pointer">
              <IconUpload className="w-3.5 h-3.5" /> {purchase.has_attachment ? 'Replace' : 'Attach file'}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={uploadAttachment}
              />
            </label>
          </div>
        }
      >
        <div className="px-4 py-3 text-sm text-stone-500">
          {attBusy
            ? 'Saving…'
            : purchase.has_attachment
              ? `Attached: ${purchase.attachment_name}. The file is stored with the purchase and survives payment edits.`
              : 'Attach the vendor invoice (JPG, PNG, WebP or PDF, max 4 MB).'}
        </div>
      </Card>

      <p className="mt-3 text-xs text-stone-400">
        Recorded {formatDate(purchase.created_at, tz)} at {formatTime(purchase.created_at, tz)} by {purchase.created_by_name || '—'}.
        Stock was increased when this purchase was saved.
      </p>

      {/* Edit Purchase Modal */}
      {showEdit && (
        <Modal
          title={`Edit Purchase #${purchase.id}`}
          wide
          onClose={() => setShowEdit(false)}
          footer={
            <>
              <div className="flex-1 text-sm text-stone-600">
                Original: <span className="tabular-nums font-medium">{formatMoney(purchase.total, currency)}</span>
                <span className="mx-2 text-stone-300">→</span>
                New Total:{' '}
                <span className="font-semibold text-stone-900 tabular-nums">{formatMoney(editTotal, currency)}</span>
              </div>
              <Button
                variant="secondary"
                onClick={() => populateEditFromCurrent(purchase, items)}
              >
                Reset Form
              </Button>
              <Button variant="secondary" onClick={() => setShowEdit(false)}>
                Cancel
              </Button>
              <Button loading={editSaving} onClick={saveEdit}>
                Save Changes
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Select label="Vendor" value={editVendorId} onChange={(e) => setEditVendorId(e.target.value)} required>
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-stone-600">Products</span>
                <button
                  type="button"
                  onClick={addEditLine}
                  className="text-xs font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1"
                >
                  <IconPlus className="w-3.5 h-3.5" /> Add line
                </button>
              </div>
              <div className="space-y-2">
                {editLines.map((l, i) => {
                  const prod = products.find((x) => String(x.id) === String(l.productId));
                  const sizedVariants = (prod?.variants || []).filter(
                    (v) => v.active || String(v.id) === String(l.variantId)
                  );
                  return (
                    <div key={i} className="border border-line rounded-md p-2 space-y-2">
                      <div className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-center">
                        <select
                          value={l.productId}
                          onChange={(e) => setEditLine(i, 'productId', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
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
                          onChange={(e) => setEditLine(i, 'qty', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-right tabular-nums"
                        />
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-stone-400">
                            {currency}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Cost"
                            value={l.cost}
                            onChange={(e) => setEditLine(i, 'cost', e.target.value)}
                            className="w-full rounded-md border border-stone-300 bg-white py-1.5 pl-7 pr-2 text-sm text-right tabular-nums"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeEditLine(i)}
                          disabled={editLines.length === 1}
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
                            onChange={(e) => setEditLine(i, 'variantId', e.target.value)}
                            className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
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
                          onChange={(e) => setEditLine(i, 'batchNo', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                        <input
                          type="date"
                          title="Batch expiry (optional)"
                          value={l.expiryDate || ''}
                          onChange={(e) => setEditLine(i, 'expiryDate', e.target.value)}
                          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <Input
              label="Notes"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              maxLength={300}
              placeholder="Optional"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
