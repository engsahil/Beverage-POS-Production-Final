'use client';
// Vendors: add, edit (including Opening Balance with Payable/Receivable direction),
// enable/disable + accounting-style ledger per vendor.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, daysAgoStr, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, Modal, PageHeader, Input } from '@/components/ui';
import { IconPencil, IconPlus, IconScale } from '@/components/icons';

const EMPTY = {
  name: '',
  phone: '',
  notes: '',
  openingBalance: '0',
  openingBalanceType: 'payable',
  openingBalanceDate: '',
  openingBalanceNote: '',
};

function formatSignedBalance(val, currency) {
  const n = Number(val || 0);
  if (n > 0.005) return `Payable ${formatMoney(n, currency)}`;
  if (n < -0.005) return `Receivable ${formatMoney(Math.abs(n), currency)}`;
  return formatMoney(0, currency);
}

export default function VendorsClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const toast = useToast();
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit', vendor? }
  const [form, setForm] = useState(EMPTY);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Ledger modal state
  const [ledgerVendor, setLedgerVendor] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState('');
  const [lf, setLf] = useState({
    from: daysAgoStr(89),
    to: storeDateStr(settings?.timezone),
    type: 'all',
    method: '',
  });

  // Payment modal state
  const [payVendor, setPayVendor] = useState(null);
  const [payForm, setPayForm] = useState({
    amount: '',
    method: 'cash',
    paymentDate: storeDateStr(settings?.timezone),
    reference: '',
    note: '',
  });
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/vendors');
      setVendors(d.vendors);
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

  function openCreate() {
    setForm({
      ...EMPTY,
      openingBalanceDate: storeDateStr(settings?.timezone),
    });
    setActive(true);
    setModal({ mode: 'create' });
  }

  function openEdit(v) {
    setForm({
      name: v.name || '',
      phone: v.phone || '',
      notes: v.notes || '',
      openingBalance: String(Number(v.opening_balance || 0)),
      openingBalanceType: v.opening_balance_type === 'receivable' ? 'receivable' : 'payable',
      openingBalanceDate: v.opening_balance_date ? String(v.opening_balance_date).slice(0, 10) : '',
      openingBalanceNote: v.opening_balance_note || '',
    });
    setActive(Boolean(v.active));
    setModal({ mode: 'edit', vendor: v });
  }

  async function save(e) {
    if (e) e.preventDefault();
    if (saving) return;
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast('Vendor name is required.', 'error');
      return;
    }
    const rawOb = String(form.openingBalance ?? '').trim();
    const obNum = rawOb === '' ? 0 : Number(rawOb);
    if (Number.isNaN(obNum) || obNum < 0) {
      toast('Opening balance must be 0 or a positive amount.', 'error');
      return;
    }
    if (obNum > 999999999.99) {
      toast('Opening balance is too large (max 999,999,999.99).', 'error');
      return;
    }

    setSaving(true);
    const body = {
      name: trimmedName,
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      opening_balance: obNum,
      opening_balance_type: form.openingBalanceType === 'receivable' ? 'receivable' : 'payable',
      opening_balance_date: obNum > 0 && form.openingBalanceDate ? form.openingBalanceDate : null,
      opening_balance_note: obNum > 0 ? form.openingBalanceNote.trim() : '',
    };
    try {
      if (modal.mode === 'create') {
        await api('/api/vendors', { method: 'POST', body });
        toast('Vendor added.');
      } else {
        body.active = active;
        await api(`/api/vendors/${modal.vendor.id}`, { method: 'PUT', body });
        toast('Vendor updated.');
      }
      setModal(null);
      await load();
      if (ledgerVendor && modal.vendor && ledgerVendor.id === modal.vendor.id) {
        loadLedger();
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const loadLedger = useCallback(async () => {
    if (!ledgerVendor) return;
    setLedger(null);
    setLedgerError('');
    try {
      const sp = new URLSearchParams();
      if (lf.from) sp.set('from', lf.from);
      if (lf.to) sp.set('to', lf.to);
      if (lf.type !== 'all') sp.set('type', lf.type);
      if (lf.method) sp.set('method', lf.method);
      const d = await api(`/api/vendors/${ledgerVendor.id}/ledger?${sp.toString()}`);
      setLedger(d);
    } catch (err) {
      setLedgerError(err.message);
    }
  }, [ledgerVendor, lf]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  async function savePayment(e) {
    if (e) e.preventDefault();
    if (paying || !payVendor) return;
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter a payment amount above zero.', 'error');
      return;
    }
    const maxPayable = Number(payVendor.payable ?? Math.max(0, Number(payVendor.outstanding || 0)));
    if (amount > maxPayable + 0.005) {
      toast(`Amount exceeds the vendor payable balance (${formatMoney(maxPayable, currency)}).`, 'error');
      return;
    }
    setPaying(true);
    try {
      const d = await api(`/api/vendors/${payVendor.id}/payments`, {
        method: 'POST',
        body: {
          amount,
          method: payForm.method,
          paymentDate: payForm.paymentDate || null,
          reference: payForm.reference.trim(),
          note: payForm.note.trim(),
        },
      });
      toast(`Payment recorded. Remaining payable: ${formatMoney(d.vendor.payable, currency)}.`);
      setPayVendor(null);
      await load();
      if (ledgerVendor && ledgerVendor.id === payVendor.id) loadLedger();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPaying(false);
    }
  }

  const totalPayable = (vendors || []).reduce((s, v) => s + Number(v.payable || Math.max(0, Number(v.outstanding || 0))), 0);
  const totalReceivable = (vendors || []).reduce((s, v) => s + Number(v.receivable || Math.max(0, -Number(v.outstanding || 0))), 0);

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    {
      key: 'opening_balance',
      label: 'Opening Balance',
      align: 'right',
      className: 'tabular-nums',
      render: (r) => {
        const ob = Number(r.opening_balance || 0);
        if (ob <= 0.005) return <span className="text-stone-300">—</span>;
        const isRec = r.opening_balance_type === 'receivable';
        return (
          <span className={isRec ? 'text-blue-700 font-medium' : 'text-amber-700 font-medium'}>
            {isRec ? 'Receivable ' : 'Payable '}
            {formatMoney(ob, currency)}
          </span>
        );
      },
    },
    {
      key: 'payable',
      label: 'Payable',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => {
        const p = Number(r.payable ?? Math.max(0, Number(r.outstanding || 0)));
        return p > 0.005 ? <span className="text-amber-600">{formatMoney(p, currency)}</span> : <span className="text-stone-300">—</span>;
      },
    },
    {
      key: 'receivable',
      label: 'Receivable',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => {
        const rec = Number(r.receivable ?? Math.max(0, -Number(r.outstanding || 0)));
        return rec > 0.005 ? <span className="text-blue-600">{formatMoney(rec, currency)}</span> : <span className="text-stone-300">—</span>;
      },
    },
    { key: 'notes', label: 'Notes', render: (r) => <span className="text-stone-500">{r.notes || '—'}</span> },
    {
      key: 'active',
      label: 'Status',
      render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Disabled'}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {Number(r.payable ?? Math.max(0, Number(r.outstanding || 0))) > 0.005 && (
            <button
              onClick={() => {
                setPayForm({
                  amount: '',
                  method: 'cash',
                  paymentDate: storeDateStr(settings?.timezone),
                  reference: '',
                  note: '',
                });
                setPayVendor(r);
              }}
              className="px-2 py-1 rounded text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Pay
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLf({ from: daysAgoStr(89), to: storeDateStr(settings?.timezone), type: 'all', method: '' });
              setLedgerVendor(r);
            }}
          >
            <IconScale className="w-3.5 h-3.5" /> Ledger
          </Button>
          <button
            onClick={() => openEdit(r)}
            className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800"
            aria-label={`Edit ${r.name}`}
          >
            <IconPencil className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const previewObAmt = Number(form.openingBalance) > 0 ? Number(form.openingBalance) : 0;

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Vendors"
        sub="Suppliers you purchase stock from — manage opening balances, payables, receivables, and ledgers"
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add Vendor
          </Button>
        }
      />

      {vendors && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Card className="p-4">
            <div className="text-xs font-medium text-stone-500">Total Vendors</div>
            <div className="mt-1 text-xl font-bold text-stone-900 tabular-nums">{vendors.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-stone-500">Total Payable (We Owe Vendors)</div>
            <div className="mt-1 text-xl font-bold text-amber-700 tabular-nums">{formatMoney(totalPayable, currency)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-stone-500">Total Receivable (Vendors Owe Us)</div>
            <div className="mt-1 text-xl font-bold text-blue-700 tabular-nums">{formatMoney(totalReceivable, currency)}</div>
          </Card>
        </div>
      )}

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !vendors ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={vendors} empty="No vendors yet." />
        )}
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Add Vendor' : `Edit: ${modal.vendor.name}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={save}>
                Save
              </Button>
            </>
          }
        >
          <form onSubmit={save} className="space-y-3.5">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={120}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              maxLength={30}
            />
            <Input
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={300}
              placeholder="Address, delivery info, etc."
            />

            <div className="border-t border-line pt-3.5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                Opening Balance
              </div>

              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">
                  Financial Direction
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, openingBalanceType: 'payable' })}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      form.openingBalanceType === 'payable'
                        ? 'border-amber-600 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-stone-300 bg-white text-stone-600 hover:bg-cream'
                    }`}
                  >
                    <div>Payable</div>
                    <div className="text-[11px] font-normal opacity-80">Vendor is owed money</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, openingBalanceType: 'receivable' })}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      form.openingBalanceType === 'receivable'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                        : 'border-stone-300 bg-white text-stone-600 hover:bg-cream'
                    }`}
                  >
                    <div>Receivable</div>
                    <div className="text-[11px] font-normal opacity-80">Vendor owes money to business</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label={`Opening Balance (${currency})`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                  placeholder="0.00"
                />
                <Input
                  label="Opening Date (optional)"
                  type="date"
                  value={form.openingBalanceDate}
                  onChange={(e) => setForm({ ...form, openingBalanceDate: e.target.value })}
                />
              </div>

              <Input
                label="Opening Balance Note (optional)"
                value={form.openingBalanceNote}
                onChange={(e) => setForm({ ...form, openingBalanceNote: e.target.value })}
                maxLength={200}
                placeholder="Carried-forward invoice or advance details"
              />

              <div className="rounded-md bg-cream px-3 py-2 text-xs text-stone-600">
                {previewObAmt > 0 ? (
                  form.openingBalanceType === 'receivable' ? (
                    <span className="text-blue-800 font-medium">
                      Opening Receivable: {formatMoney(previewObAmt, currency)} — Vendor owes money to the business.
                    </span>
                  ) : (
                    <span className="text-amber-800 font-medium">
                      Opening Payable: {formatMoney(previewObAmt, currency)} — Vendor is owed money by the business.
                    </span>
                  )
                ) : (
                  <span>No opening balance ({formatMoney(0, currency)}).</span>
                )}
              </div>
            </div>

            {modal.mode === 'edit' && (
              <label className="flex items-center gap-2 text-sm text-stone-700 pt-1">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-stone-300"
                />
                Active (can receive new purchases)
              </label>
            )}
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {ledgerVendor && (
        <Modal
          title={`Ledger — ${ledgerVendor.name}`}
          wide
          onClose={() => setLedgerVendor(null)}
          footer={
            <>
              <div className="flex-1 text-sm text-stone-600">
                Opening: <span className="font-semibold tabular-nums">{formatSignedBalance(ledger?.opening ?? 0, currency)}</span>
                <span className="mx-2 text-stone-300">|</span>
                Closing:{' '}
                <span
                  className={`font-semibold tabular-nums ${
                    (ledger?.closing ?? 0) > 0.005
                      ? 'text-amber-700'
                      : (ledger?.closing ?? 0) < -0.005
                        ? 'text-blue-700'
                        : ''
                  }`}
                >
                  {formatSignedBalance(ledger?.closing ?? 0, currency)}
                </span>
              </div>
              <Button variant="secondary" onClick={() => setLedgerVendor(null)}>
                Close
              </Button>
            </>
          }
        >
          {ledger?.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Opening</div>
                <div className="text-xs font-semibold tabular-nums text-stone-800 mt-0.5">
                  {ledger.summary.opening_balance > 0.005
                    ? `${ledger.summary.opening_balance_type === 'receivable' ? 'Receivable' : 'Payable'} ${formatMoney(ledger.summary.opening_balance, currency)}`
                    : formatMoney(0, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Purchases</div>
                <div className="text-xs font-semibold tabular-nums text-amber-700 mt-0.5">
                  {formatMoney(ledger.summary.purchases, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Payments + Claims</div>
                <div className="text-xs font-semibold tabular-nums text-emerald-700 mt-0.5">
                  {formatMoney(ledger.summary.payments + ledger.summary.claims, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Payable</div>
                <div className="text-xs font-semibold tabular-nums text-amber-700 mt-0.5">
                  {formatMoney(ledger.summary.payable, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Receivable</div>
                <div className="text-xs font-semibold tabular-nums text-blue-700 mt-0.5">
                  {formatMoney(ledger.summary.receivable, currency)}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
            <Input label="From" type="date" value={lf.from} onChange={(e) => setLf({ ...lf, from: e.target.value })} />
            <Input label="To" type="date" value={lf.to} onChange={(e) => setLf({ ...lf, to: e.target.value })} />
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Type</span>
              <select
                value={lf.type}
                onChange={(e) => setLf({ ...lf, type: e.target.value })}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              >
                <option value="all">All</option>
                <option value="invoices">Invoices</option>
                <option value="payments">Payments</option>
                <option value="adjustments">Adjustments</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Method</span>
              <select
                value={lf.method}
                onChange={(e) => setLf({ ...lf, method: e.target.value })}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              >
                <option value="">All methods</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </label>
          </div>
          {ledgerError ? (
            <ErrorBox message={ledgerError} onRetry={loadLedger} />
          ) : !ledger ? (
            <Loading />
          ) : (
            <div className="max-h-80 overflow-y-auto border border-line rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cream">
                  <tr className="border-b border-line">
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Date</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Reference</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Description</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Debit</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Credit</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line bg-cream/50">
                    <td className="py-1.5 px-3 text-xs text-stone-500">
                      {ledger.vendor?.opening_balance_date || '—'}
                    </td>
                    <td className="py-1.5 px-3 text-xs font-medium text-stone-600">OPENING</td>
                    <td className="py-1.5 px-3 text-xs text-stone-500">
                      Opening balance
                      {ledger.vendor?.opening_balance > 0.005
                        ? ` (${ledger.vendor.opening_balance_type === 'receivable' ? 'Receivable' : 'Payable'}${
                            ledger.vendor.opening_balance_note ? ` — ${ledger.vendor.opening_balance_note}` : ''
                          })`
                        : ''}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">
                      {ledger.opening < -0.005 ? formatMoney(Math.abs(ledger.opening), currency) : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">
                      {ledger.opening > 0.005 ? formatMoney(ledger.opening, currency) : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums font-semibold">
                      {formatSignedBalance(ledger.opening, currency)}
                    </td>
                  </tr>
                  {ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-stone-400">
                        No transactions in this period.
                      </td>
                    </tr>
                  ) : (
                    ledger.rows.map((r, i) => (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        <td className="py-1.5 px-3 whitespace-nowrap text-stone-600">{r.date || '—'}</td>
                        <td className="py-1.5 px-3 whitespace-nowrap text-stone-700">{r.reference}</td>
                        <td className="py-1.5 px-3 text-stone-600">{r.description}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">
                          {r.debit ? formatMoney(r.debit, currency) : '—'}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">
                          {r.credit ? formatMoney(r.credit, currency) : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-3 text-right tabular-nums font-semibold ${
                            r.balance > 0.005 ? 'text-amber-700' : r.balance < -0.005 ? 'text-blue-700' : 'text-stone-600'
                          }`}
                        >
                          {formatSignedBalance(r.balance, currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {payVendor && (
        <Modal
          title={`Pay Vendor — ${payVendor.name}`}
          onClose={() => setPayVendor(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPayVendor(null)}>
                Cancel
              </Button>
              <Button loading={paying} onClick={savePayment}>
                Record Payment
              </Button>
            </>
          }
        >
          <form onSubmit={savePayment} className="space-y-3.5">
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              Current Payable:{' '}
              <span className="font-bold tabular-nums">
                {formatMoney(payVendor.payable ?? Math.max(0, Number(payVendor.outstanding || 0)), currency)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={`Amount (${currency})`}
                type="number"
                min="0.01"
                step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                placeholder="0.00"
                required
              />
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 mb-1.5">Method</span>
                <select
                  value={payForm.method}
                  onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                  className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Payment Date"
                type="date"
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
              />
              <Input
                label="Reference (optional)"
                value={payForm.reference}
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                maxLength={80}
                placeholder="Receipt / TT no."
              />
            </div>
            <Input
              label="Note (optional)"
              value={payForm.note}
              onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
              maxLength={200}
            />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}
    </div>
  );
}
