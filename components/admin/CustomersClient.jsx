'use client';
// Customers: lightweight records + credit ledger + recovery payments.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Field } from '@/components/ui';
import { IconPencil, IconPlus, IconTrash } from '@/components/icons';

const EMPTY = { name: '', phone: '', address: '', notes: '', active: true };

// Ledger row labels. 'sale' is a credit sale (the unpaid part of an invoice),
// which is a debit to the customer's account.
const LEDGER_LABELS = {
  sale: 'credit sale',
  payment: 'payment',
  adjustment: 'adjustment',
  opening_balance: 'opening',
};

function LedgerStat({ label, value }) {
  return (
    <div>
      <div className="text-stone-500">{label}</div>
      <div className="font-semibold tabular-nums text-stone-800">{value}</div>
    </div>
  );
}

export default function CustomersClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;

  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', customer? }
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState(null); // { customer, ledger }
  const [payModal, setPayModal] = useState(null); // customer
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [paying, setPaying] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [entryModal, setEntryModal] = useState(null); // { type: 'opening_balance'|'adjustment', customer }
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDirection, setEntryDirection] = useState('debit');
  const [entryNote, setEntryNote] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [editTxn, setEditTxn] = useState(null); // ledger row being edited
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editMethod, setEditMethod] = useState('cash');
  const [savingTxn, setSavingTxn] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/customers?search=${encodeURIComponent(search.trim())}`);
      setCustomers(d.customers);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250); // small debounce for typing
    return () => clearTimeout(t);
  }, [load]);

  function openCreate() {
    setForm(EMPTY);
    setModal({ mode: 'create' });
  }
  function openEdit(c) {
    setForm({ name: c.name, phone: c.phone, address: c.address, notes: c.notes, active: c.active });
    setModal({ mode: 'edit', customer: c });
  }

  async function save(e) {
    if (e) e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      toast('Customer name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
        active: form.active,
      };
      if (modal.mode === 'create') {
        await api('/api/customers', { method: 'POST', body });
        toast('Customer added.');
      } else {
        await api(`/api/customers/${modal.customer.id}`, { method: 'PUT', body });
        toast('Customer updated.');
      }
      setModal(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c) {
    try {
      await api(`/api/customers/${c.id}`, { method: 'PUT', body: { active: !c.active } });
      toast(c.active ? 'Customer disabled.' : 'Customer enabled.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openLedger(c, { before } = {}) {
    if (before === undefined) setLedger({ customer: c, ledger: null, totals: null, hasMore: false });
    setLedgerBusy(true);
    try {
      const d = await api(`/api/customers/${c.id}${before ? `?before=${before}` : ''}`, {
        fresh: before !== undefined,
      });
      if (before) {
        // Append the older page; the server orders by id DESC.
        setLedger((prev) => ({
          customer: d.customer,
          ledger: [...(prev?.ledger || []), ...d.ledger],
          totals: d.totals,
          hasMore: d.hasMore,
        }));
      } else {
        setLedger({ customer: d.customer, ledger: d.ledger, totals: d.totals, hasMore: d.hasMore });
      }
    } catch (err) {
      toast(err.message, 'error');
      if (before === undefined) setLedger(null);
    } finally {
      setLedgerBusy(false);
    }
  }

  // Opening balance / adjustment: a new ledger row, never an overwrite.
  // The server writes it and the running balance in one transaction.
  async function saveEntry(e) {
    if (e) e.preventDefault();
    if (entrySaving) return;
    const amount = Number(entryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount above zero.', 'error');
      return;
    }
    if (entryModal.type === 'adjustment' && !entryNote.trim()) {
      toast('An adjustment needs a note explaining the change.', 'error');
      return;
    }
    setEntrySaving(true);
    try {
      const d = await api(`/api/customers/${entryModal.customer.id}/ledger`, {
        method: 'POST',
        body: { type: entryModal.type, amount, direction: entryDirection, note: entryNote.trim() },
      });
      toast(
        entryModal.type === 'opening_balance'
          ? `Opening balance recorded. Balance: ${formatMoney(d.balance, currency)}.`
          : `Adjustment recorded. Balance: ${formatMoney(d.balance, currency)}.`
      );
      setEntryModal(null);
      setEntryAmount('');
      setEntryNote('');
      setEntryDirection('debit');
      openLedger(entryModal.customer);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setEntrySaving(false);
    }
  }

  async function recordPayment() {
    if (paying) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount above zero.', 'error');
      return;
    }
    setPaying(true);
    try {
      const d = await api(`/api/customers/${payModal.id}/payments`, {
        method: 'POST',
        body: { amount, note: payNote.trim(), method: payMethod },
      });
      toast(`Recovery recorded. Remaining balance: ${formatMoney(d.balance, currency)}.`);
      setPayModal(null);
      setPayAmount('');
      setPayNote('');
      if (ledger && String(ledger.customer.id) === String(payModal.id)) openLedger(payModal);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPaying(false);
    }
  }

  // Historical ledger editing: the server recalculates every following
  // balance and the customer's outstanding in one locked transaction.
  async function saveEditTxn(e) {
    if (e) e.preventDefault();
    if (savingTxn) return;
    const amount = Number(editAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount above zero.', 'error');
      return;
    }
    setSavingTxn(true);
    try {
      const body = { amount, note: editNote.trim() };
      if (editTxn.type === 'payment') body.method = editMethod;
      await api(`/api/customers/${ledger.customer.id}/transactions/${editTxn.id}`, { method: 'PUT', body });
      toast('Ledger entry updated. Balances recalculated.');
      setEditTxn(null);
      openLedger(ledger.customer);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingTxn(false);
    }
  }

  async function deleteTxn(t) {
    if (!window.confirm('Remove this ledger entry? All following balances will be recalculated.')) return;
    setSavingTxn(true);
    try {
      await api(`/api/customers/${ledger.customer.id}/transactions/${t.id}`, { method: 'DELETE' });
      toast('Ledger entry removed. Balances recalculated.');
      openLedger(ledger.customer);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingTxn(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Customer', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || <span className="text-stone-400">—</span> },
    {
      key: 'outstanding_balance',
      label: 'Balance',
      align: 'right',
      className: 'tabular-nums',
      render: (r) =>
        Number(r.outstanding_balance) > 0 ? (
          <span className="font-semibold text-amber-700">{formatMoney(r.outstanding_balance, currency)}</span>
        ) : (
          <span className="text-stone-400">0.00</span>
        ),
    },
    { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
    { key: 'created_at', label: 'Since', render: (r) => <span className="text-stone-500">{formatDate(r.created_at, tz)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          <button onClick={() => openLedger(r)} className="px-2 py-1 rounded text-xs font-medium border border-stone-300 text-stone-600 hover:bg-cream">
            Ledger
          </button>
          {Number(r.outstanding_balance) > 0 && (
            <button
              onClick={() => {
                setPayModal(r);
                setPayAmount('');
                setPayNote('');
                setPayMethod('cash');
              }}
              className="px-2 py-1 rounded text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Recover
            </button>
          )}
          <button onClick={() => openEdit(r)} className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800" aria-label={`Edit ${r.name}`}>
            <IconPencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => toggleActive(r)}
            className={`px-2 py-1 rounded text-xs font-medium border ${
              r.active ? 'border-stone-300 text-stone-600 hover:bg-cream' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            {r.active ? 'Disable' : 'Enable'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Customers"
        sub="Customer records and their credit balances. Walk-in sales need no customer."
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add Customer
          </Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        />
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !customers ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={customers} empty="No customers yet. Add one or use the quick-add on the POS screen." />
        )}
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Add Customer' : `Edit: ${modal.customer.name}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={saving} onClick={save}>
                {modal.mode === 'create' ? 'Add Customer' : 'Save Changes'}
              </Button>
            </>
          }
        >
          <form onSubmit={save} className="space-y-3.5">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} />
            <Input label="Address (optional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={200} />
            <Input label="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} />
            <Field label="">
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded border-stone-300" />
                Active (selectable on POS)
              </label>
            </Field>
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {ledger && (
        <Modal
          title={`Ledger: ${ledger.customer.name}`}
          onClose={() => setLedger(null)}
          wide
          footer={
            <>
              {ledger.ledger && ledger.ledger.length === 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEntryModal({ type: 'opening_balance', customer: ledger.customer });
                    setEntryAmount('');
                    setEntryNote('');
                    setEntryDirection('debit');
                  }}
                >
                  Opening Balance
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  setEntryModal({ type: 'adjustment', customer: ledger.customer });
                  setEntryAmount('');
                  setEntryNote('');
                  setEntryDirection('debit');
                }}
              >
                Adjustment
              </Button>
              {Number(ledger.customer.outstanding_balance) > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPayModal(ledger.customer);
                    setPayAmount('');
                    setPayNote('');
                    setPayMethod('cash');
                  }}
                >
                  Record Recovery
                </Button>
              )}
              <Button variant="secondary" onClick={() => setLedger(null)}>Close</Button>
            </>
          }
        >
          {/* Account summary — every figure comes from the ledger rows, the
              same source as the balance, so the columns can never disagree. */}
          <div className="mb-4 bg-cream/70 rounded-md p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-600">Outstanding balance</span>
              <span className="text-base font-bold tabular-nums text-amber-700">
                {formatMoney(ledger.customer.outstanding_balance, currency)}
              </span>
            </div>
            {ledger.totals && (
              <>
                <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                  <LedgerStat label="Opening balance" value={formatMoney(ledger.totals.opening_balance, currency)} />
                  <LedgerStat label="Purchases on credit" value={formatMoney(ledger.totals.total_purchases_on_credit, currency)} />
                  <LedgerStat label="Payments received" value={formatMoney(ledger.totals.total_payments, currency)} />
                  <LedgerStat label="Adjustments" value={formatMoney(ledger.totals.total_adjustments, currency)} />
                  <LedgerStat label="Total debit" value={formatMoney(ledger.totals.total_debits, currency)} />
                  <LedgerStat label="Total credit" value={formatMoney(ledger.totals.total_credits, currency)} />
                </div>
                <div className="mt-2 text-[11px] text-stone-500">
                  Opening balance + total debit − total credit ={' '}
                  <span className="font-semibold tabular-nums">{formatMoney(ledger.totals.ledger_balance, currency)}</span>
                  {ledger.totals.in_sync ? (
                    <span className="ml-1.5 text-emerald-700">· matches the stored balance</span>
                  ) : (
                    <span className="ml-1.5 text-red-700">
                      · does not match the stored balance ({formatMoney(ledger.totals.outstanding, currency)})
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          {!ledger.ledger ? (
            <Loading />
          ) : ledger.ledger.length === 0 ? (
            <div className="py-8 text-center text-sm text-stone-400">No credit transactions yet.</div>
          ) : (
            <ul className="divide-y divide-line/80 max-h-80 overflow-y-auto">
              {ledger.ledger.map((t) => (
                <li key={t.id} className="py-2.5 flex items-center gap-3">
                  <Badge tone={t.type === 'payment' ? 'ok' : t.type === 'sale' ? 'warn' : 'muted'}>
                    {LEDGER_LABELS[t.type] || t.type}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-stone-800 truncate">
                      {t.note || '—'}
                      {t.type === 'payment' && t.method && <span className="ml-1.5 text-xs text-stone-400">via {t.method}</span>}
                      {t.sale_no && <span className="ml-1.5 text-xs text-stone-400">sale #{t.sale_no}</span>}
                    </div>
                    <div className="text-xs text-stone-500">
                      {formatDate(t.created_at, tz)} · {formatTime(t.created_at, tz)}
                      {t.user_name ? ` · ${t.user_name}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold tabular-nums ${Number(t.amount) >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {Number(t.amount) >= 0 ? '+' : '-'}
                      {formatMoney(Math.abs(Number(t.amount)), currency).replace('-', '')}
                    </div>
                    <div className="text-[11px] text-stone-400 tabular-nums">balance {formatMoney(t.balance_after, currency)}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditTxn(t);
                        setEditAmount(String(Math.abs(Number(t.amount))));
                        setEditNote(t.note || '');
                        setEditMethod(t.method || 'cash');
                      }}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-cream"
                      aria-label="Edit entry"
                      title="Edit (recalculates balances)"
                    >
                      <IconPencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteTxn(t)}
                      className="p-1 rounded text-stone-400 hover:text-red-600 hover:bg-red-50"
                      aria-label="Remove entry"
                      title="Remove (recalculates balances)"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
              {ledger.hasMore && (
                <li className="py-2.5 text-center">
                  <button
                    onClick={() => openLedger(ledger.customer, { before: ledger.ledger[ledger.ledger.length - 1].id })}
                    disabled={ledgerBusy}
                    className="text-xs font-medium text-stone-600 hover:text-stone-900 disabled:opacity-50"
                  >
                    {ledgerBusy ? 'Loading…' : 'Load earlier entries'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </Modal>
      )}

      {entryModal && (
        <Modal
          title={entryModal.type === 'opening_balance' ? `Opening balance: ${entryModal.customer.name}` : `Adjustment: ${entryModal.customer.name}`}
          onClose={() => setEntryModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEntryModal(null)}>Cancel</Button>
              <Button loading={entrySaving} onClick={saveEntry}>
                Record Entry
              </Button>
            </>
          }
        >
          <form onSubmit={saveEntry} className="space-y-3.5">
            <div className="text-sm text-stone-600">
              Current balance:{' '}
              <span className="font-semibold text-amber-700">
                {formatMoney(entryModal.customer.outstanding_balance, currency)}
              </span>
            </div>
            <Input
              label={`Amount (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              required
            />
            <Field label="Direction">
              <label className="flex items-center gap-4 text-sm text-stone-700">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="entry-direction"
                    checked={entryDirection === 'debit'}
                    onChange={() => setEntryDirection('debit')}
                  />
                  Debit (customer owes more)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="entry-direction"
                    checked={entryDirection === 'credit'}
                    onChange={() => setEntryDirection('credit')}
                  />
                  Credit (customer owes less)
                </label>
              </label>
            </Field>
            <Input
              label={entryModal.type === 'adjustment' ? 'Note (required)' : 'Note (optional)'}
              value={entryNote}
              onChange={(e) => setEntryNote(e.target.value)}
              maxLength={200}
              placeholder={entryModal.type === 'adjustment' ? 'e.g. invoice correction, goodwill credit' : 'e.g. balance carried forward'}
            />
            <p className="text-[11px] text-stone-400">
              This adds a new ledger row — nothing already recorded is changed or removed. The running
              balance of this and every later entry is recalculated in the same transaction.
            </p>
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {payModal && (
        <Modal
          title={`Recover balance: ${payModal.name}`}
          onClose={() => setPayModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPayModal(null)}>Cancel</Button>
              <Button loading={paying} onClick={recordPayment}>Record Payment</Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="text-sm text-stone-600">
              Outstanding balance: <span className="font-semibold text-amber-700">{formatMoney(payModal.outstanding_balance, currency)}</span>
            </div>
            <Input
              label={`Amount received (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Payment method</span>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </label>
            <Input label="Note (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. cash received at counter" maxLength={200} />
            <p className="text-[11px] text-stone-400">
              Full or partial. The method determines which account (cash/bank/card) the money lands in. The balance update and ledger entry are written in one transaction and can never go out of sync.
            </p>
          </div>
        </Modal>
      )}

      {editTxn && ledger && (
        <Modal
          title="Edit ledger entry"
          onClose={() => setEditTxn(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditTxn(null)}>Cancel</Button>
              <Button loading={savingTxn} onClick={saveEditTxn}>Save & Recalculate</Button>
            </>
          }
        >
          <form onSubmit={saveEditTxn} className="space-y-3.5">
            <div className="text-xs text-stone-500">
              {editTxn.type} · {formatDate(editTxn.created_at, tz)} {formatTime(editTxn.created_at, tz)}
            </div>
            <Input
              label={`Amount (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              required
            />
            {editTxn.type === 'payment' && (
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 mb-1.5">Payment method</span>
                <select value={editMethod} onChange={(e) => setEditMethod(e.target.value)} className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                </select>
              </label>
            )}
            <Input label="Note" value={editNote} onChange={(e) => setEditNote(e.target.value)} maxLength={200} />
            <p className="text-[11px] text-stone-400">
              Saving recalculates the running balance of this and every later entry, plus the customer's outstanding balance — in one transaction.
            </p>
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}
    </div>
  );
}
