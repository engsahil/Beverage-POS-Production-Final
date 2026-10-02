'use client';
// Credit & Dues (Udhaar): unified lightweight section for Customer Receivables
// (Udhaar / Credit / Recovery Payments / Ledger) and Vendor Dues (Payable /
// Receivable / Vendor Payments / Opening Balance / Ledger).
// Uses the single existing Customer and Vendor financial APIs and tables — no
// duplicate financial system.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, daysAgoStr, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, Modal, PageHeader, Input } from '@/components/ui';
import { IconScale, IconSearch } from '@/components/icons';

const LEDGER_LABELS = {
  sale: 'Credit Sale',
  payment: 'Payment',
  adjustment: 'Adjustment',
  opening_balance: 'Opening Balance',
};

function formatSignedVendorBalance(val, currency) {
  const n = Number(val || 0);
  if (n > 0.005) return `Payable ${formatMoney(n, currency)}`;
  if (n < -0.005) return `Receivable ${formatMoney(Math.abs(n), currency)}`;
  return formatMoney(0, currency);
}

export default function CreditDuesClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const toast = useToast();

  const [tab, setTab] = useState('customers'); // 'customers' | 'vendors'
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('dues'); // 'dues' | 'all' | 'settled'
  const [vendorFilter, setVendorFilter] = useState('dues'); // 'dues' | 'payable' | 'receivable' | 'all' | 'settled'

  const [customers, setCustomers] = useState(null);
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState('');

  // Customer modals
  const [custPayModal, setCustPayModal] = useState(null);
  const [custPayAmount, setCustPayAmount] = useState('');
  const [custPayMethod, setCustPayMethod] = useState('cash');
  const [custPayNote, setCustPayNote] = useState('');
  const [custPaying, setCustPaying] = useState(false);

  const [custCreditModal, setCustCreditModal] = useState(null); // { customer, type: 'adjustment'|'opening_balance', direction: 'debit'|'credit' }
  const [custCreditAmount, setCustCreditAmount] = useState('');
  const [custCreditNote, setCustCreditNote] = useState('');
  const [custCreditSaving, setCustCreditSaving] = useState(false);

  const [custLedger, setCustLedger] = useState(null); // { customer, ledger, totals, hasMore }
  const [custLedgerBusy, setCustLedgerBusy] = useState(false);

  // Vendor modals
  const [vendPayModal, setVendPayModal] = useState(null);
  const [vendPayForm, setVendPayForm] = useState({
    amount: '',
    method: 'cash',
    paymentDate: storeDateStr(tz),
    reference: '',
    note: '',
  });
  const [vendPaying, setVendPaying] = useState(false);

  const [vendLedgerVendor, setVendLedgerVendor] = useState(null);
  const [vendLedger, setVendLedger] = useState(null);
  const [vendLedgerError, setVendLedgerError] = useState('');
  const [vlf, setVlf] = useState({
    from: daysAgoStr(89),
    to: storeDateStr(tz),
    type: 'all',
    method: '',
  });

  const load = useCallback(async () => {
    try {
      const [cRes, vRes] = await Promise.all([api('/api/customers'), api('/api/vendors')]);
      setCustomers(cRes.customers || []);
      setVendors(vRes.vendors || []);
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

  // Customer Ledger loader
  async function openCustomerLedger(c) {
    setCustLedger({ customer: c, ledger: null, totals: null });
    setCustLedgerBusy(true);
    try {
      const d = await api(`/api/customers/${c.id}`);
      setCustLedger({ customer: d.customer, ledger: d.ledger, totals: d.totals });
    } catch (err) {
      toast(err.message, 'error');
      setCustLedger(null);
    } finally {
      setCustLedgerBusy(false);
    }
  }

  // Record Customer Recovery Payment
  async function handleCustomerPay(e) {
    if (e) e.preventDefault();
    if (custPaying || !custPayModal) return;
    const amount = Number(custPayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount above zero.', 'error');
      return;
    }
    setCustPaying(true);
    try {
      const d = await api(`/api/customers/${custPayModal.id}/payments`, {
        method: 'POST',
        body: { amount, method: custPayMethod, note: custPayNote.trim() },
      });
      toast(`Payment recorded. Remaining balance: ${formatMoney(d.balance, currency)}.`);
      const target = custPayModal;
      setCustPayModal(null);
      setCustPayAmount('');
      setCustPayNote('');
      await load();
      if (custLedger && custLedger.customer.id === target.id) {
        openCustomerLedger(target);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCustPaying(false);
    }
  }

  // Record Customer Credit (Udhaar) / Adjustment / Opening Balance
  async function handleCustomerCredit(e) {
    if (e) e.preventDefault();
    if (custCreditSaving || !custCreditModal) return;
    const amount = Number(custCreditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount above zero.', 'error');
      return;
    }
    if (custCreditModal.type === 'adjustment' && !custCreditNote.trim()) {
      toast('Enter a note describing this credit/udhaar entry.', 'error');
      return;
    }
    setCustCreditSaving(true);
    try {
      const d = await api(`/api/customers/${custCreditModal.customer.id}/ledger`, {
        method: 'POST',
        body: {
          type: custCreditModal.type,
          direction: custCreditModal.direction,
          amount,
          note: custCreditNote.trim(),
        },
      });
      toast(`Recorded. Updated balance: ${formatMoney(d.balance, currency)}.`);
      const target = custCreditModal.customer;
      setCustCreditModal(null);
      setCustCreditAmount('');
      setCustCreditNote('');
      await load();
      if (custLedger && custLedger.customer.id === target.id) {
        openCustomerLedger(target);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCustCreditSaving(false);
    }
  }

  // Vendor Ledger loader
  const loadVendorLedger = useCallback(async () => {
    if (!vendLedgerVendor) return;
    setVendLedger(null);
    setVendLedgerError('');
    try {
      const sp = new URLSearchParams();
      if (vlf.from) sp.set('from', vlf.from);
      if (vlf.to) sp.set('to', vlf.to);
      if (vlf.type !== 'all') sp.set('type', vlf.type);
      if (vlf.method) sp.set('method', vlf.method);
      const d = await api(`/api/vendors/${vendLedgerVendor.id}/ledger?${sp.toString()}`);
      setVendLedger(d);
    } catch (err) {
      setVendLedgerError(err.message);
    }
  }, [vendLedgerVendor, vlf]);

  useEffect(() => {
    loadVendorLedger();
  }, [loadVendorLedger]);

  // Record Vendor Payment
  async function handleVendorPay(e) {
    if (e) e.preventDefault();
    if (vendPaying || !vendPayModal) return;
    const amount = Number(vendPayForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter a payment amount above zero.', 'error');
      return;
    }
    const maxPayable = Number(vendPayModal.payable ?? Math.max(0, Number(vendPayModal.outstanding || 0)));
    if (amount > maxPayable + 0.005) {
      toast(`Amount exceeds vendor payable (${formatMoney(maxPayable, currency)}).`, 'error');
      return;
    }
    setVendPaying(true);
    try {
      const d = await api(`/api/vendors/${vendPayModal.id}/payments`, {
        method: 'POST',
        body: {
          amount,
          method: vendPayForm.method,
          paymentDate: vendPayForm.paymentDate || null,
          reference: vendPayForm.reference.trim(),
          note: vendPayForm.note.trim(),
        },
      });
      toast(`Vendor payment recorded. Remaining payable: ${formatMoney(d.vendor.payable, currency)}.`);
      const target = vendPayModal;
      setVendPayModal(null);
      await load();
      if (vendLedgerVendor && vendLedgerVendor.id === target.id) {
        loadVendorLedger();
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setVendPaying(false);
    }
  }

  // Totals
  const totalCustomerReceivable = (customers || []).reduce(
    (s, c) => s + Math.max(0, Number(c.outstanding_balance || 0)),
    0
  );
  const customersWithDuesCount = (customers || []).filter(
    (c) => Number(c.outstanding_balance || 0) > 0.005
  ).length;

  const totalVendorPayable = (vendors || []).reduce(
    (s, v) => s + Number(v.payable ?? Math.max(0, Number(v.outstanding || 0))),
    0
  );
  const vendorsPayableCount = (vendors || []).filter(
    (v) => Number(v.payable ?? Math.max(0, Number(v.outstanding || 0))) > 0.005
  ).length;

  const totalVendorReceivable = (vendors || []).reduce(
    (s, v) => s + Number(v.receivable ?? Math.max(0, -Number(v.outstanding || 0))),
    0
  );
  const vendorsReceivableCount = (vendors || []).filter(
    (v) => Number(v.receivable ?? Math.max(0, -Number(v.outstanding || 0))) > 0.005
  ).length;

  // Filtered rows
  const q = search.trim().toLowerCase();
  const filteredCustomers = (customers || []).filter((c) => {
    if (q && !`${c.name} ${c.phone || ''}`.toLowerCase().includes(q)) return false;
    const bal = Number(c.outstanding_balance || 0);
    if (customerFilter === 'dues') return bal > 0.005;
    if (customerFilter === 'settled') return bal <= 0.005;
    return true;
  });

  const filteredVendors = (vendors || []).filter((v) => {
    if (q && !`${v.name} ${v.phone || ''}`.toLowerCase().includes(q)) return false;
    const pay = Number(v.payable ?? Math.max(0, Number(v.outstanding || 0)));
    const rec = Number(v.receivable ?? Math.max(0, -Number(v.outstanding || 0)));
    if (vendorFilter === 'dues') return pay > 0.005 || rec > 0.005;
    if (vendorFilter === 'payable') return pay > 0.005;
    if (vendorFilter === 'receivable') return rec > 0.005;
    if (vendorFilter === 'settled') return pay <= 0.005 && rec <= 0.005;
    return true;
  });

  const customerColumns = [
    { key: 'name', label: 'Customer', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    {
      key: 'outstanding_balance',
      label: 'Receivable (Udhaar)',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => {
        const b = Number(r.outstanding_balance || 0);
        return b > 0.005 ? (
          <span className="text-blue-700">{formatMoney(b, currency)}</span>
        ) : (
          <span className="text-stone-400">{formatMoney(0, currency)}</span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        Number(r.outstanding_balance || 0) > 0.005 ? (
          <Badge tone="warn">Due</Badge>
        ) : (
          <Badge tone="ok">Settled</Badge>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {Number(r.outstanding_balance || 0) > 0.005 && (
            <button
              onClick={() => {
                setCustPayModal(r);
                setCustPayAmount('');
                setCustPayMethod('cash');
                setCustPayNote('');
              }}
              className="px-2.5 py-1 rounded text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              Receive Payment
            </button>
          )}
          <button
            onClick={() => {
              setCustCreditModal({ customer: r, type: 'adjustment', direction: 'debit' });
              setCustCreditAmount('');
              setCustCreditNote('');
            }}
            className="px-2.5 py-1 rounded text-xs font-medium border border-stone-300 text-stone-700 hover:bg-cream"
          >
            + Udhaar / Adjust
          </button>
          <Button variant="ghost" size="sm" onClick={() => openCustomerLedger(r)}>
            <IconScale className="w-3.5 h-3.5" /> Ledger
          </Button>
        </div>
      ),
    },
  ];

  const vendorColumns = [
    { key: 'name', label: 'Vendor', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    {
      key: 'opening_balance',
      label: 'Opening',
      align: 'right',
      className: 'tabular-nums',
      render: (r) => {
        const ob = Number(r.opening_balance || 0);
        if (ob <= 0.005) return <span className="text-stone-300">—</span>;
        return (
          <span className={r.opening_balance_type === 'receivable' ? 'text-blue-700' : 'text-amber-700'}>
            {r.opening_balance_type === 'receivable' ? 'Receivable ' : 'Payable '}
            {formatMoney(ob, currency)}
          </span>
        );
      },
    },
    {
      key: 'payable',
      label: 'Payable (We Owe)',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => {
        const p = Number(r.payable ?? Math.max(0, Number(r.outstanding || 0)));
        return p > 0.005 ? <span className="text-amber-700">{formatMoney(p, currency)}</span> : <span className="text-stone-300">—</span>;
      },
    },
    {
      key: 'receivable',
      label: 'Receivable (Owes Us)',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => {
        const rec = Number(r.receivable ?? Math.max(0, -Number(r.outstanding || 0)));
        return rec > 0.005 ? <span className="text-blue-700">{formatMoney(rec, currency)}</span> : <span className="text-stone-300">—</span>;
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => {
        const pay = Number(r.payable ?? Math.max(0, Number(r.outstanding || 0)));
        return (
          <div className="flex items-center justify-end gap-1.5">
            {pay > 0.005 && (
              <button
                onClick={() => {
                  setVendPayForm({
                    amount: '',
                    method: 'cash',
                    paymentDate: storeDateStr(tz),
                    reference: '',
                    note: '',
                  });
                  setVendPayModal(r);
                }}
                className="px-2.5 py-1 rounded text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-50"
              >
                Pay Vendor
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVlf({ from: daysAgoStr(89), to: storeDateStr(tz), type: 'all', method: '' });
                setVendLedgerVendor(r);
              }}
            >
              <IconScale className="w-3.5 h-3.5" /> Ledger
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Credit & Dues (Udhaar)"
        sub="Unified customer receivables (udhaar) and vendor payables/receivables — backed by live ledgers"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500">Customer Receivable (Udhaar)</div>
          <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
            {formatMoney(totalCustomerReceivable, currency)}
          </div>
          <div className="text-xs text-stone-400 mt-0.5">
            {customersWithDuesCount} customer{customersWithDuesCount === 1 ? '' : 's'} with outstanding balance
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500">Vendor Payable (We Owe)</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
            {formatMoney(totalVendorPayable, currency)}
          </div>
          <div className="text-xs text-stone-400 mt-0.5">
            {vendorsPayableCount} vendor{vendorsPayableCount === 1 ? '' : 's'} owed money
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-stone-500">Vendor Receivable (Owes Us)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
            {formatMoney(totalVendorReceivable, currency)}
          </div>
          <div className="text-xs text-stone-400 mt-0.5">
            {vendorsReceivableCount} vendor{vendorsReceivableCount === 1 ? '' : 's'} owing the business
          </div>
        </Card>
      </div>

      {/* Main Tabs + Search + Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTab('customers')}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold border transition-colors ${
              tab === 'customers'
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
            }`}
          >
            Customers (Udhaar) ({customers ? customers.length : '…'})
          </button>
          <button
            onClick={() => setTab('vendors')}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold border transition-colors ${
              tab === 'vendors'
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
            }`}
          >
            Vendors (Payable & Receivable) ({vendors ? vendors.length : '…'})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <IconSearch className="w-4 h-4 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'customers' ? 'Search customer or phone…' : 'Search vendor or phone…'}
              className="rounded-md border border-stone-300 bg-white pl-8 pr-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
            />
          </div>

          {tab === 'customers' ? (
            <div className="flex items-center gap-1">
              {[
                ['dues', 'With Dues'],
                ['all', 'All Customers'],
                ['settled', 'Settled'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setCustomerFilter(k)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium border ${
                    customerFilter === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {[
                ['dues', 'With Balance'],
                ['payable', 'Payable'],
                ['receivable', 'Receivable'],
                ['all', 'All Vendors'],
                ['settled', 'Settled'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setVendorFilter(k)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium border ${
                    vendorFilter === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !customers || !vendors ? (
          <Loading />
        ) : tab === 'customers' ? (
          <DataTable
            columns={customerColumns}
            rows={filteredCustomers}
            empty={customerFilter === 'dues' ? 'No customers currently have outstanding credit/udhaar.' : 'No matching customers.'}
          />
        ) : (
          <DataTable
            columns={vendorColumns}
            rows={filteredVendors}
            empty={vendorFilter === 'dues' ? 'No vendors currently have an outstanding payable or receivable.' : 'No matching vendors.'}
          />
        )}
      </div>

      {/* Customer Payment Modal */}
      {custPayModal && (
        <Modal
          title={`Receive Payment — ${custPayModal.name}`}
          onClose={() => setCustPayModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCustPayModal(null)}>
                Cancel
              </Button>
              <Button loading={custPaying} onClick={handleCustomerPay}>
                Record Payment
              </Button>
            </>
          }
        >
          <form onSubmit={handleCustomerPay} className="space-y-3.5">
            <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
              Outstanding Receivable (Udhaar):{' '}
              <span className="font-bold tabular-nums">
                {formatMoney(custPayModal.outstanding_balance, currency)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={`Amount (${currency})`}
                type="number"
                min="0.01"
                step="0.01"
                value={custPayAmount}
                onChange={(e) => setCustPayAmount(e.target.value)}
                placeholder="0.00"
                required
              />
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 mb-1.5">Method</span>
                <select
                  value={custPayMethod}
                  onChange={(e) => setCustPayMethod(e.target.value)}
                  className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                </select>
              </label>
            </div>
            <Input
              label="Note (optional)"
              value={custPayNote}
              onChange={(e) => setCustPayNote(e.target.value)}
              maxLength={200}
              placeholder="Receipt / recovery note"
            />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {/* Customer Add Credit / Udhaar / Adjustment Modal */}
      {custCreditModal && (
        <Modal
          title={`Credit / Udhaar Entry — ${custCreditModal.customer.name}`}
          onClose={() => setCustCreditModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCustCreditModal(null)}>
                Cancel
              </Button>
              <Button loading={custCreditSaving} onClick={handleCustomerCredit}>
                Save Entry
              </Button>
            </>
          }
        >
          <form onSubmit={handleCustomerCredit} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCustCreditModal({ ...custCreditModal, type: 'adjustment', direction: 'debit' })}
                className={`rounded-md border px-3 py-2 text-left text-xs ${
                  custCreditModal.direction === 'debit'
                    ? 'border-amber-600 bg-amber-50 text-amber-900 font-semibold'
                    : 'border-stone-300 bg-white text-stone-600'
                }`}
              >
                <div>Add Udhaar / Debit</div>
                <div className="text-[11px] font-normal opacity-80">Customer owes more</div>
              </button>
              <button
                type="button"
                onClick={() => setCustCreditModal({ ...custCreditModal, type: 'adjustment', direction: 'credit' })}
                className={`rounded-md border px-3 py-2 text-left text-xs ${
                  custCreditModal.direction === 'credit'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                    : 'border-stone-300 bg-white text-stone-600'
                }`}
              >
                <div>Credit Adjustment</div>
                <div className="text-[11px] font-normal opacity-80">Reduces customer balance</div>
              </button>
            </div>
            <Input
              label={`Amount (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              value={custCreditAmount}
              onChange={(e) => setCustCreditAmount(e.target.value)}
              placeholder="0.00"
              required
            />
            <Input
              label="Note / Description (required)"
              value={custCreditNote}
              onChange={(e) => setCustCreditNote(e.target.value)}
              maxLength={200}
              placeholder="Reason for credit / udhaar or adjustment"
              required
            />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {/* Customer Ledger & Transaction History Modal */}
      {custLedger && (
        <Modal
          title={`Customer Ledger — ${custLedger.customer.name}`}
          wide
          onClose={() => setCustLedger(null)}
          footer={
            <>
              <div className="flex-1 text-sm text-stone-600">
                Outstanding Receivable:{' '}
                <span className="font-bold text-blue-700 tabular-nums">
                  {formatMoney(custLedger.customer.outstanding_balance, currency)}
                </span>
              </div>
              {Number(custLedger.customer.outstanding_balance) > 0.005 && (
                <Button
                  size="sm"
                  onClick={() => {
                    setCustPayModal(custLedger.customer);
                    setCustPayAmount('');
                    setCustPayMethod('cash');
                    setCustPayNote('');
                  }}
                >
                  Receive Payment
                </Button>
              )}
              <Button variant="secondary" onClick={() => setCustLedger(null)}>
                Close
              </Button>
            </>
          }
        >
          {custLedgerBusy && !custLedger.ledger ? (
            <Loading />
          ) : (
            <div className="space-y-3">
              {custLedger.totals && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-md border border-line bg-cream/40 p-2.5">
                    <div className="text-[11px] text-stone-500">Opening Balance</div>
                    <div className="text-xs font-semibold tabular-nums mt-0.5">
                      {formatMoney(custLedger.totals.opening_balance, currency)}
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-cream/40 p-2.5">
                    <div className="text-[11px] text-stone-500">Total Debits (Credit Sales)</div>
                    <div className="text-xs font-semibold tabular-nums text-amber-700 mt-0.5">
                      {formatMoney(custLedger.totals.total_debits, currency)}
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-cream/40 p-2.5">
                    <div className="text-[11px] text-stone-500">Total Payments</div>
                    <div className="text-xs font-semibold tabular-nums text-emerald-700 mt-0.5">
                      {formatMoney(custLedger.totals.total_payments, currency)}
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-cream/40 p-2.5">
                    <div className="text-[11px] text-stone-500">Current Receivable</div>
                    <div className="text-xs font-semibold tabular-nums text-blue-700 mt-0.5">
                      {formatMoney(custLedger.totals.outstanding, currency)}
                    </div>
                  </div>
                </div>
              )}

              <div className="max-h-80 overflow-y-auto border border-line rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-cream">
                    <tr className="border-b border-line">
                      <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Date</th>
                      <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Type</th>
                      <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Note</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Debit (+)</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Credit (−)</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(custLedger.ledger || []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-sm text-stone-400">
                          No transactions yet.
                        </td>
                      </tr>
                    ) : (
                      (custLedger.ledger || []).map((t) => {
                        const amt = Number(t.amount);
                        return (
                          <tr key={t.id} className="border-b border-line/70 last:border-0">
                            <td className="py-1.5 px-3 whitespace-nowrap text-xs text-stone-600">
                              {formatDate(t.created_at, tz)} {formatTime(t.created_at, tz)}
                            </td>
                            <td className="py-1.5 px-3 whitespace-nowrap text-xs font-medium text-stone-700">
                              {LEDGER_LABELS[t.type] || t.type}
                              {t.method ? ` (${t.method})` : ''}
                            </td>
                            <td className="py-1.5 px-3 text-xs text-stone-600">{t.note || '—'}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">
                              {amt > 0 ? formatMoney(amt, currency) : '—'}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">
                              {amt < 0 ? formatMoney(Math.abs(amt), currency) : '—'}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums font-semibold">
                              {formatMoney(t.balance_after, currency)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Vendor Payment Modal */}
      {vendPayModal && (
        <Modal
          title={`Pay Vendor — ${vendPayModal.name}`}
          onClose={() => setVendPayModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setVendPayModal(null)}>
                Cancel
              </Button>
              <Button loading={vendPaying} onClick={handleVendorPay}>
                Record Payment
              </Button>
            </>
          }
        >
          <form onSubmit={handleVendorPay} className="space-y-3.5">
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              Current Payable:{' '}
              <span className="font-bold tabular-nums">
                {formatMoney(vendPayModal.payable ?? Math.max(0, Number(vendPayModal.outstanding || 0)), currency)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={`Amount (${currency})`}
                type="number"
                min="0.01"
                step="0.01"
                value={vendPayForm.amount}
                onChange={(e) => setVendPayForm({ ...vendPayForm, amount: e.target.value })}
                placeholder="0.00"
                required
              />
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 mb-1.5">Method</span>
                <select
                  value={vendPayForm.method}
                  onChange={(e) => setVendPayForm({ ...vendPayForm, method: e.target.value })}
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
                value={vendPayForm.paymentDate}
                onChange={(e) => setVendPayForm({ ...vendPayForm, paymentDate: e.target.value })}
              />
              <Input
                label="Reference (optional)"
                value={vendPayForm.reference}
                onChange={(e) => setVendPayForm({ ...vendPayForm, reference: e.target.value })}
                maxLength={80}
                placeholder="Receipt / TT no."
              />
            </div>
            <Input
              label="Note (optional)"
              value={vendPayForm.note}
              onChange={(e) => setVendPayForm({ ...vendPayForm, note: e.target.value })}
              maxLength={200}
            />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {/* Vendor Ledger Modal */}
      {vendLedgerVendor && (
        <Modal
          title={`Vendor Ledger — ${vendLedgerVendor.name}`}
          wide
          onClose={() => setVendLedgerVendor(null)}
          footer={
            <>
              <div className="flex-1 text-sm text-stone-600">
                Opening:{' '}
                <span className="font-semibold tabular-nums">
                  {formatSignedVendorBalance(vendLedger?.opening ?? 0, currency)}
                </span>
                <span className="mx-2 text-stone-300">|</span>
                Closing:{' '}
                <span className="font-semibold tabular-nums">
                  {formatSignedVendorBalance(vendLedger?.closing ?? 0, currency)}
                </span>
              </div>
              <Button variant="secondary" onClick={() => setVendLedgerVendor(null)}>
                Close
              </Button>
            </>
          }
        >
          {vendLedger?.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Opening</div>
                <div className="text-xs font-semibold tabular-nums mt-0.5">
                  {vendLedger.summary.opening_balance > 0.005
                    ? `${vendLedger.summary.opening_balance_type === 'receivable' ? 'Receivable' : 'Payable'} ${formatMoney(vendLedger.summary.opening_balance, currency)}`
                    : formatMoney(0, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Purchases</div>
                <div className="text-xs font-semibold tabular-nums text-amber-700 mt-0.5">
                  {formatMoney(vendLedger.summary.purchases, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Payments + Claims</div>
                <div className="text-xs font-semibold tabular-nums text-emerald-700 mt-0.5">
                  {formatMoney(vendLedger.summary.payments + vendLedger.summary.claims, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Payable</div>
                <div className="text-xs font-semibold tabular-nums text-amber-700 mt-0.5">
                  {formatMoney(vendLedger.summary.payable, currency)}
                </div>
              </div>
              <div className="rounded-md border border-line bg-cream/40 p-2.5">
                <div className="text-[11px] text-stone-500">Receivable</div>
                <div className="text-xs font-semibold tabular-nums text-blue-700 mt-0.5">
                  {formatMoney(vendLedger.summary.receivable, currency)}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
            <Input label="From" type="date" value={vlf.from} onChange={(e) => setVlf({ ...vlf, from: e.target.value })} />
            <Input label="To" type="date" value={vlf.to} onChange={(e) => setVlf({ ...vlf, to: e.target.value })} />
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Type</span>
              <select
                value={vlf.type}
                onChange={(e) => setVlf({ ...vlf, type: e.target.value })}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
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
                value={vlf.method}
                onChange={(e) => setVlf({ ...vlf, method: e.target.value })}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">All methods</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </label>
          </div>

          {vendLedgerError ? (
            <ErrorBox message={vendLedgerError} onRetry={loadVendorLedger} />
          ) : !vendLedger ? (
            <Loading />
          ) : (
            <div className="max-h-80 overflow-y-auto border border-line rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cream">
                  <tr className="border-b border-line">
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Date</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Reference</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold uppercase text-stone-500">Description</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Debit</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Credit</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold uppercase text-stone-500">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line bg-cream/50">
                    <td className="py-1.5 px-3 text-xs text-stone-500">
                      {vendLedger.vendor?.opening_balance_date || '—'}
                    </td>
                    <td className="py-1.5 px-3 text-xs font-medium text-stone-600">OPENING</td>
                    <td className="py-1.5 px-3 text-xs text-stone-500">Opening balance</td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">
                      {vendLedger.opening < -0.005 ? formatMoney(Math.abs(vendLedger.opening), currency) : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">
                      {vendLedger.opening > 0.005 ? formatMoney(vendLedger.opening, currency) : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums font-semibold">
                      {formatSignedVendorBalance(vendLedger.opening, currency)}
                    </td>
                  </tr>
                  {vendLedger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-stone-400">
                        No transactions in this period.
                      </td>
                    </tr>
                  ) : (
                    vendLedger.rows.map((r, i) => (
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
                        <td className="py-1.5 px-3 text-right tabular-nums font-semibold">
                          {formatSignedVendorBalance(r.balance, currency)}
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
    </div>
  );
}
