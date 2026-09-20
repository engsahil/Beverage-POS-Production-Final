'use client';
// Vendor claims: simple internal records with a pending/settled workflow.
// No automatic stock or accounting changes — settle = record the outcome
// (with an optional reference to the inventory adjustment you made).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import {  formatMoney, formatDate, localDateStr , storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select } from '@/components/ui';
import { IconPlus } from '@/components/icons';

export default function ClaimsClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';

  const [claims, setClaims] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    vendorId: '',
    productId: '',
    qty: '',
    amount: '',
    reason: '',
    date: storeDateStr(settings?.timezone),
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(null); // claim
  const [settleRef, setSettleRef] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/claims?${status ? `status=${status}` : ''}`);
      setClaims(d.claims);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  // Vendor/product options are only needed in the claim form — fetch on
  // first open, not on every page load.
  const formMetaPromise = useRef(null);
  function loadFormMeta() {
    if (!formMetaPromise.current) {
      formMetaPromise.current = Promise.all([
        api('/api/vendors').catch(() => ({ vendors: [] })),
        api('/api/products').catch(() => ({ products: [] })),
      ]).then(([v, p]) => {
        setVendors(v.vendors);
        setProducts(p.products.filter((x) => x.active));
      });
    }
    return formMetaPromise.current;
  }

  function openModal() {
    loadFormMeta();
    setForm({ vendorId: '', productId: '', qty: '', amount: '', reason: '', date: storeDateStr(settings?.timezone), note: '' });
    setShowModal(true);
  }

  async function save(e) {
    if (e) e.preventDefault();
    if (saving) return;
    if (!form.vendorId) return toast('Select a vendor.', 'error');
    if (!form.reason.trim()) return toast('Enter a reason.', 'error');
    if (!Number(form.amount) || Number(form.amount) <= 0) return toast('Enter the claim amount.', 'error');
    setSaving(true);
    try {
      await api('/api/claims', {
        method: 'POST',
        body: {
          vendorId: Number(form.vendorId),
          productId: form.productId ? Number(form.productId) : null,
          qty: form.qty === '' ? null : Number(form.qty),
          amount: Number(form.amount),
          reason: form.reason.trim(),
          date: form.date || null,
          note: form.note.trim(),
        },
      });
      toast('Claim recorded.');
      setShowModal(false);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function settle() {
    if (settleBusy) return;
    setSettleBusy(true);
    try {
      await api(`/api/claims/${settling.id}`, {
        method: 'PUT',
        body: { adjustmentRef: settleRef.trim(), note: settleNote.trim() },
      });
      toast('Claim settled.');
      setSettling(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSettleBusy(false);
    }
  }

  const columns = [
    { key: 'id', label: 'Claim', render: (r) => <span className="font-medium text-stone-800">#{r.id}</span> },
    { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'product_name', label: 'Product', render: (r) => r.product_name || '—' },
    { key: 'qty', label: 'Qty', align: 'right', className: 'tabular-nums', render: (r) => (r.qty !== null && r.qty !== undefined ? r.qty : '—') },
    { key: 'amount', label: 'Amount', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatMoney(r.amount, currency) },
    { key: 'reason', label: 'Reason', render: (r) => <span className="text-stone-600">{r.reason}</span> },
    { key: 'claim_date', label: 'Date', render: (r) => <span className="text-stone-500">{String(r.claim_date).slice(0, 10)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'pending' ? 'warn' : 'ok'}>{r.status}</Badge> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) =>
        r.status === 'pending' ? (
          <button
            onClick={() => {
              setSettling(r);
              setSettleRef('');
              setSettleNote(r.note || '');
            }}
            className="px-2 py-1 rounded text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            Mark settled
          </button>
        ) : (
          <span className="text-xs text-stone-400">
            {r.adjustment_ref ? `Ref: ${r.adjustment_ref}` : 'Settled'}
          </span>
        ),
    },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Vendor Claims"
        sub="Record what you claim back from a vendor (damaged goods, replacements). Settling is an internal note — it never changes stock automatically."
        actions={
          <Button onClick={openModal}>
            <IconPlus className="w-4 h-4" /> New Claim
          </Button>
        }
      />

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs font-medium text-stone-600">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="settled">Settled</option>
        </select>
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !claims ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={claims} empty="No claims recorded." />
        )}
      </div>

      {showModal && (
        <Modal
          title="New Vendor Claim"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button loading={saving} onClick={save}>Record Claim</Button>
            </>
          }
        >
          <form onSubmit={save} className="space-y-3.5">
            <Select label="Vendor" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required>
              <option value="">Select vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
            <Select label="Product (optional)" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">No specific product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3.5">
              <Input label="Quantity (optional)" type="number" min="0" step="0.5" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              <Input label={`Amount (${currency})`} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <Input label="Claim date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <Input label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. arrived damaged" required maxLength={200} />
            </div>
            <Input label="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {settling && (
        <Modal
          title={`Settle claim #${settling.id}`}
          onClose={() => setSettling(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSettling(null)}>Cancel</Button>
              <Button loading={settleBusy} onClick={settle}>Mark Settled</Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="text-sm text-stone-600">
              {settling.vendor_name} · {formatMoney(settling.amount, currency)} — {settling.reason}
            </div>
            <Input
              label="Adjustment reference (optional)"
              value={settleRef}
              onChange={(e) => setSettleRef(e.target.value)}
              placeholder="e.g. INV-1042 or adjustment note"
              maxLength={120}
              hint="Optional link to the inventory adjustment or vendor credit note you created for this."
            />
            <Input label="Note (optional)" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} maxLength={300} />
          </div>
        </Modal>
      )}
    </div>
  );
}
