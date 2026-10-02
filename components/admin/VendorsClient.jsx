'use client';
// Vendors: add, edit, enable/disable + accounting-style ledger per vendor.
// Vendor opening balance follows the customer opening-balance pattern but
// fits the derived vendor ledger (column on vendors, not a second ledger
// table) — creation, persistence, ledger history, payables, running balance,
// decimals, zero (clear), invalid inputs and auditability are all covered.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, daysAgoStr, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input } from '@/components/ui';
import { IconPencil, IconPlus, IconScale } from '@/components/icons';

const EMPTY = { name: '', phone: '', notes: '' };

export default function VendorsClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const toast = useToast();
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode, vendor? }
  const [form, setForm] = useState(EMPTY);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Ledger modal state
  const [ledgerVendor, setLedgerVendor] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState('');
  const [lf, setLf] = useState({ from: daysAgoStr(89), to: storeDateStr(settings?.timezone), type: 'all', method: '' });

  // Opening balance modal state
  const [obModal, setObModal] = useState(null); // vendor
  const [obAmount, setObAmount] = useState('');
  const [obNote, setObNote] = useState('');
  const [obDate, setObDate] = useState('');
  const [obSaving, setObSaving] = useState(false);

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
    setForm(EMPTY);
    setActive(true);
    setModal({ mode: 'create' });
  }
  function openEdit(v) {
    setForm({ name: v.name, phone: v.phone, notes: v.notes });
    setActive(v.active);
    setModal({ mode: 'edit', vendor: v });
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const body = { name: form.name.trim(), phone: form.phone.trim(), notes: form.notes.trim() };
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
      load();
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

  async function openOb(v) {
    setObModal(v);
    setObAmount(v.opening_balance ? String(Number(v.opening_balance).toFixed(2)) : '');
    setObNote('');
    setObDate(v.opening_balance_date ? String(v.opening_balance_date).slice(0, 10) : '');
    try {
      const d = await api(`/api/vendors/${v.id}/opening-balance`);
      setObAmount(d.opening_balance ? String(Number(d.opening_balance).toFixed(2)) : '');
      setObNote(d.opening_balance_note || '');
      setObDate(d.opening_balance_date ? String(d.opening_balance_date).slice(0, 10) : '');
    } catch {}
  }

  async function saveOb(e) {
    if (e) e.preventDefault();
    if (obSaving) return;
    const amt = obAmount.trim() === '' ? null : Number(obAmount);
    if (amt === null || Number.isNaN(amt) || amt < 0) {
      toast('Enter an opening balance of 0 or more (0 clears it).', 'error');
      return;
    }
    if (amt > 999999999.99) {
      toast('Opening balance is too large (max 999,999,999.99).', 'error');
      return;
    }
    setObSaving(true);
    try {
      const d = await api(`/api/vendors/${obModal.id}/opening-balance`, {
        method: 'PUT',
        body: { amount: amt, note: obNote.trim(), date: obDate || null },
      });
      toast(amt === 0 ? 'Opening balance cleared.' : `Opening balance ${formatMoney(d.opening_balance, currency)} saved.`);
      setObModal(null);
      load();
      if (ledgerVendor && ledgerVendor.id === obModal.id) loadLedger();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setObSaving(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'opening', label: 'Opening', align: 'right', className: 'tabular-nums', render: (r) => {
      const ob = Number(r.opening_balance || 0);
      return ob > 0.005 ? <span className="text-stone-600">{formatMoney(ob, currency)}</span> : <span className="text-stone-300">—</span>;
    } },
    { key: 'outstanding', label: 'Outstanding', align: 'right', className: 'font-semibold tabular-nums', render: (r) => {
      const o = Number(r.outstanding);
      return o > 0.005 ? <span className="text-amber-600">{formatMoney(o, currency)}</span> : <span className="text-stone-400">—</span>;
    } },
    { key: 'notes', label: 'Notes', render: (r) => <span className="text-stone-500">{r.notes || '—'}</span> },
    { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openOb(r)} className="px-2 py-1 rounded text-xs font-medium border border-stone-300 text-stone-600 hover:bg-cream" title="Opening balance">
            OB
          </button>
          <Button variant="ghost" size="sm" onClick={() => { setLf({ from: daysAgoStr(89), to: storeDateStr(settings?.timezone), type: 'all', method: '' }); setLedgerVendor(r); }}>
            <IconScale className="w-3.5 h-3.5" /> Ledger
          </Button>
          <button onClick={() => openEdit(r)} className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800" aria-label={`Edit ${r.name}`}>
            <IconPencil className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const ledgerColumns = [
    { key: 'date', label: 'Date', render: (r) => <span className="text-stone-600">{r.date || '—'}</span> },
    { key: 'reference', label: 'Reference', render: (r) => <span className="text-stone-700">{r.reference}</span> },
    { key: 'description', label: 'Description', render: (r) => <span className="text-stone-600">{r.description}</span> },
    { key: 'debit', label: 'Debit (paid)', align: 'right', className: 'tabular-nums', render: (r) => (r.debit ? <span className="text-emerald-700">{formatMoney(r.debit, currency)}</span> : <span className="text-stone-300">—</span>) },
    { key: 'credit', label: 'Credit (owed)', align: 'right', className: 'tabular-nums', render: (r) => (r.credit ? <span className="text-amber-700">{formatMoney(r.credit, currency)}</span> : <span className="text-stone-300">—</span>) },
    { key: 'balance', label: 'Balance', align: 'right', className: 'font-semibold tabular-nums', render: (r) => <span className={r.balance > 0.005 ? 'text-amber-700' : 'text-stone-500'}>{formatMoney(r.balance, currency)}</span> },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Vendors"
        sub="Suppliers you purchase stock from"
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add Vendor
          </Button>
        }
      />

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
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} />
            <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} placeholder="Address, delivery info, etc." />
            {modal.mode === 'edit' && (
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 rounded border-stone-300" />
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
                Opening: <span className="font-semibold tabular-nums">{formatMoney(ledger?.opening ?? 0, currency)}</span>
                <span className="mx-2 text-stone-300">|</span>
                Closing: <span className={`font-semibold tabular-nums ${(ledger?.closing ?? 0) > 0.005 ? 'text-amber-700' : ''}`}>{formatMoney(ledger?.closing ?? 0, currency)}</span>
              </div>
              <Button variant="secondary" onClick={() => setLedgerVendor(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
            <Input label="From" type="date" value={lf.from} onChange={(e) => setLf({ ...lf, from: e.target.value })} />
            <Input label="To" type="date" value={lf.to} onChange={(e) => setLf({ ...lf, to: e.target.value })} />
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Type</span>
              <select value={lf.type} onChange={(e) => setLf({ ...lf, type: e.target.value })} className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
                <option value="all">All</option>
                <option value="invoices">Invoices</option>
                <option value="payments">Payments</option>
                <option value="adjustments">Adjustments</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Method</span>
              <select value={lf.method} onChange={(e) => setLf({ ...lf, method: e.target.value })} className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
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
                    <td colSpan={5} className="py-1.5 px-3 text-xs text-stone-500">Opening balance</td>
                    <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{formatMoney(ledger.opening, currency)}</td>
                  </tr>
                  {ledger.rows.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-sm text-stone-400">No entries in this period.</td></tr>
                  ) : (
                    ledger.rows.map((r, i) => (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        <td className="py-1.5 px-3 whitespace-nowrap text-stone-600">{r.date || '—'}</td>
                        <td className="py-1.5 px-3 whitespace-nowrap text-stone-700">{r.reference}</td>
                        <td className="py-1.5 px-3 text-stone-600">{r.description}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{r.debit ? formatMoney(r.debit, currency) : '—'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{r.credit ? formatMoney(r.credit, currency) : '—'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{formatMoney(r.balance, currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {obModal && (
        <Modal
          title={`Opening Balance — ${obModal.name}`}
          onClose={() => setObModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setObModal(null)}>Cancel</Button>
              <Button loading={obSaving} onClick={saveOb}>Save</Button>
            </>
          }
        >
          <form onSubmit={saveOb} className="space-y-3.5">
            <Input label={`Amount (${currency}) — 0 clears`} type="number" min="0" step="0.01" value={obAmount} onChange={(e) => setObAmount(e.target.value)} placeholder="e.g. 15000.00" />
            <Input label="Date (optional)" type="date" value={obDate} onChange={(e) => setObDate(e.target.value)} />
            <Input label="Note (optional)" value={obNote} onChange={(e) => setObNote(e.target.value)} maxLength={200} placeholder="Why this opening balance exists" />
            <p className="text-xs text-stone-500">Opening balance is what you already owed this vendor before using this system. It appears in the ledger, outstanding and payables. Decimals are handled as money (2dp). Enter 0 to clear.</p>
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}
    </div>
  );
}
