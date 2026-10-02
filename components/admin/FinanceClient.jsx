'use client';
// Finance hub: account balances (cash/bank/card) + Cash Flow, Profit &
// Loss, Balance Sheet, Receivables, Payables. Every number is computed
// from stored transactions — nothing here is a stored aggregate.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import {  formatMoney, daysAgoStr, localDateStr , storeDateStr } from '@/lib/format';
import { Badge, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconWallet, IconScale, IconTarget } from '@/components/icons';

const TABS = [
  ['cashflow', 'Cash Flow'],
  ['profit', 'Profit & Loss'],
  ['balance', 'Balance Sheet'],
  ['receivables', 'Receivables'],
  ['payables', 'Payables'],
];

const METHOD_LABEL = { cash: 'Cash', bank: 'Bank', card: 'Card' };

export default function FinanceClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;

  const [tab, setTab] = useState('cashflow');
  const [from, setFrom] = useState(() => storeDateStr(tz, -29));
  const [to, setTo] = useState(() => storeDateStr(tz, 0));

  const [accounts, setAccounts] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await api('/api/finance/accounts');
        if (alive) setAccounts(a);
      } catch (err) {
        if (alive && err.status !== 401) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const url =
        tab === 'cashflow' ? 'cash-flow' : tab === 'profit' ? 'profit' : tab === 'balance' ? 'balance-sheet' : tab;
      const sp = new URLSearchParams();
      // cash flow + P&L take a date range; the rest are point-in-time
      if (tab === 'cashflow' || tab === 'profit') {
        sp.set('from', from);
        sp.set('to', to);
      }
      const d = await api(`/api/finance/${url}${sp.toString() ? `?${sp.toString()}` : ''}`);
      if (reqId === reqIdRef.current) setData(d);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (reqId === reqIdRef.current) setError(err.message);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [tab, from, to]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const money = (v, cls = '') => <span className={`tabular-nums ${cls}`}>{formatMoney(Number(v) || 0, currency)}</span>;

  // True only when the loaded data actually matches the visible tab.
  // (During a tab switch the previous tab's data is still in state;
  // rendering it with the new tab's shape would crash.)
  function ready() {
    if (!data || loading) return false;
    if (tab === 'cashflow') return Boolean(data.accounts);
    if (tab === 'profit') return data.revenue !== undefined;
    if (tab === 'balance') return Boolean(data.assets);
    if (tab === 'receivables') return Array.isArray(data.customers);
    return Array.isArray(data.vendors);
  }

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Finance"
        sub="Accounts, cash flow, profit, and what you are owed or owe — computed from the stored transactions."
      />

      {/* Account balances */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          ['cash', IconWallet],
          ['bank', IconWallet],
          ['card', IconWallet],
        ].map(([key, Icon]) => (
          <Card key={key} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-7 h-7 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-medium text-stone-600">{METHOD_LABEL[key]}</span>
            </div>
            <div className={`text-2xl font-bold tabular-nums ${accounts ? (Number(accounts[key]) < 0 ? 'text-red-600' : 'text-stone-900') : ''}`}>
              {accounts ? formatMoney(accounts[key], currency) : '…'}
            </div>
            {accounts && accounts[key] !== undefined && Number(accounts[key]) < 0 && (
              <div className="text-[11px] text-red-500 mt-0.5">Negative — more paid out than taken in via this account</div>
            )}
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {TABS.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setTab(val)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
              tab === val ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Date range (except balance sheet) */}
      {tab !== 'balance' && (tab === 'cashflow' || tab === 'profit') && (
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">From</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
          </div>
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">To</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
          </div>
        </div>
      )}

      {error ? (
        <Card><ErrorBox message={error} onRetry={load} /></Card>
      ) : !ready() ? (
        <Card><Loading /></Card>
      ) : (
        <>
          {/* ===== CASH FLOW ===== */}
          {tab === 'cashflow' && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-800">Cash Flow — {data.from} to {data.to}</h3>
                <span className="text-xs text-stone-400">Each account, by the method the money moved</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-cream/50">
                      <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Movement</th>
                      {['cash', 'bank', 'card', 'total'].map((m) => (
                        <th key={m} className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                          {m === 'total' ? 'Total' : METHOD_LABEL[m]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <Row cur={currency} label="Opening" cells={['cash', 'bank', 'card', 'total'].map((m) => data.accounts[m].opening)} />
                    <Row cur={currency} label="Sales" indent cells={['cash', 'bank', 'card'].map((m) => data.accounts[m].sales).concat([sum(['cash', 'bank', 'card'], 'sales', data)])} />
                    <Row cur={currency} label="Customer payments" indent cells={['cash', 'bank', 'card'].map((m) => data.accounts[m].customer_payments).concat([sum(['cash', 'bank', 'card'], 'customer_payments', data)])} />
                    <Row cur={currency} label="Received (inflow)" bold cells={['cash', 'bank', 'card', 'total'].map((m) => data.accounts[m].inflow)} />
                    <Row cur={currency} label="Vendor payments" indent cells={['cash', 'bank', 'card'].map((m) => -data.accounts[m].vendor_payments).concat([sum(['cash', 'bank', 'card'], 'vendor_payments', data, true)])} />
                    <Row cur={currency} label="Expenses" indent cells={['cash', 'bank', 'card'].map((m) => -data.accounts[m].expenses).concat([sum(['cash', 'bank', 'card'], 'expenses', data, true)])} />
                    <Row cur={currency} label="Paid out (outflow)" bold cells={['cash', 'bank', 'card', 'total'].map((m) => -data.accounts[m].outflow)} />
                    {data.accounts.total.unspecified > 0.005 && (
                      <Row cur={currency} label="Expenses w/o method (legacy)" indent cells={[0, 0, 0, -data.accounts.total.unspecified]} />
                    )}
                    <Row cur={currency} label="Closing" bold top cells={['cash', 'bank', 'card', 'total'].map((m) => data.accounts[m].closing)} />
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ===== PROFIT & LOSS ===== */}
          {tab === 'profit' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-stone-800 mb-1">Profit & Loss — {data.from} to {data.to}</h3>
                <PLRow cur={currency} label="Sales revenue" value={data.revenue} strong />
                <PLRow cur={currency} label="Cost of goods sold (current cost)" value={-data.cogs} />
                <PLRow cur={currency} label="Gross profit" value={data.gross} strong border />
                <PLRow cur={currency} label="Expenses" value={-data.expenseTotal} />
                {data.claims > 0.005 && <PLRow cur={currency} label="Vendor claims settled" value={data.claims} />}
                <PLRow
                  cur={currency}
                  label="Net profit"
                  value={data.net}
                  strong
                  border
                  cls={data.net >= 0 ? 'text-emerald-700' : 'text-red-600'}
                />
                <p className="text-[11px] text-stone-400 pt-1">
                  COGS uses each sold line's quantity × the product's current cost (cost at the exact sale moment is not stored).
                </p>
              </Card>
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-line">
                  <h3 className="text-sm font-semibold text-stone-800">Expenses by category</h3>
                </div>
                {data.expenses.length === 0 ? (
                  <div className="py-8 text-center text-sm text-stone-400">No expenses in this period.</div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.expenses.map((e) => (
                        <tr key={e.category} className="border-b border-line/70 last:border-0">
                          <td className="py-2 px-4 text-stone-700">{e.category}</td>
                          <td className="py-2 px-4 text-right tabular-nums font-medium text-red-600">{formatMoney(-e.total, currency)}</td>
                        </tr>
                      ))}
                      <tr className="bg-cream/50">
                        <td className="py-2 px-4 text-sm font-semibold">Total expenses</td>
                        <td className="py-2 px-4 text-right tabular-nums font-bold text-red-600">{formatMoney(-data.expenseTotal, currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          )}

          {/* ===== BALANCE SHEET ===== */}
          {tab === 'balance' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-line bg-emerald-50/50">
                  <h3 className="text-sm font-semibold text-stone-800">Assets</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <BSRow cur={currency} label="Cash" value={data.assets.cash} />
                    <BSRow cur={currency} label="Bank" value={data.assets.bank} />
                    <BSRow cur={currency} label="Card" value={data.assets.card} />
                    <BSRow cur={currency} label="Customer receivables" value={data.assets.receivables} />
                    {Number(data.assets.vendor_receivables) > 0.005 && (
                      <BSRow cur={currency} label="Vendor receivables" value={data.assets.vendor_receivables} />
                    )}
                    <BSRow cur={currency} label="Inventory (current cost)" value={data.assets.inventory} />
                    <BSTotal cur={currency} label="Total assets" value={data.assets.total} />
                  </tbody>
                </table>
              </Card>
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-line bg-amber-50/50">
                  <h3 className="text-sm font-semibold text-stone-800">Liabilities</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <BSRow cur={currency} label="Vendor payables" value={data.liabilities.payables} />
                    <BSTotal cur={currency} label="Total liabilities" value={data.liabilities.total} />
                  </tbody>
                </table>
              </Card>
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-line bg-stone-100">
                  <h3 className="text-sm font-semibold text-stone-800">Equity</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <BSRow cur={currency} label="Owner equity (residual)" value={data.equity.owner_equity} />
                    <BSTotal cur={currency} label="Total equity" value={data.equity.total} />
                  </tbody>
                </table>
              </Card>
              <div className="lg:col-span-3 flex items-center gap-2 text-sm">
                <IconScale className="w-4 h-4 text-stone-400" />
                <span className="text-stone-600">As of {data.asOf}</span>
                <Badge tone={data.balanced ? 'ok' : 'bad'}>
                  {data.balanced ? 'Balanced: Assets = Liabilities + Equity' : 'Out of balance'}
                </Badge>
                <span className="text-xs text-stone-400">
                  Owner equity is the residual of the recorded books (no capital/withdrawal ledger exists in this app).
                </span>
              </div>
            </div>
          )}

          {/* ===== RECEIVABLES ===== */}
          {tab === 'receivables' && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
                  <IconTarget className="w-4 h-4 text-blue-600" /> Customer Receivables
                </h3>
                <span className="text-sm text-stone-600">
                  Total owed to you: <span className="font-bold tabular-nums text-blue-700">{formatMoney(data.total, currency)}</span>
                </span>
              </div>
              {data.customers.length === 0 ? (
                <div className="py-10 text-center text-sm text-stone-400">No customers owe you money.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-cream/50">
                      <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Customer</th>
                      <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Phone</th>
                      <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Oldest Credit</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => (
                      <tr key={c.id} className="border-b border-line/70 last:border-0">
                        <td className="py-2.5 px-4 font-medium text-stone-800">{c.name}</td>
                        <td className="py-2.5 px-4 text-stone-600">{c.phone || '—'}</td>
                        <td className="py-2.5 px-4 text-stone-500">{c.oldest_credit || '—'}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-blue-700">{formatMoney(c.outstanding_balance, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {/* ===== PAYABLES ===== */}
          {tab === 'payables' && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-stone-800">Vendor Payables & Receivables</h3>
                <span className="text-sm text-stone-600">
                  Total you owe: <span className="font-bold tabular-nums text-amber-700">{formatMoney(data.total, currency)}</span>
                  {Number(data.receivableTotal) > 0.005 && (
                    <span className="ml-3">
                      Vendors owe you: <span className="font-bold tabular-nums text-blue-700">{formatMoney(data.receivableTotal, currency)}</span>
                    </span>
                  )}
                  {data.overdueTotal > 0.005 && (
                    <span className="ml-2 text-red-600">(overdue: {formatMoney(data.overdueTotal, currency)})</span>
                  )}
                </span>
              </div>
              {data.vendors.length === 0 ? (
                <div className="py-10 text-center text-sm text-stone-400">You don't owe any vendor money.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-cream/50">
                      <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Vendor</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Open Invoices</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Overdue</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Payable</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Receivable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vendors.map((v) => (
                      <tr key={v.vendor_id} className="border-b border-line/70 last:border-0">
                        <td className="py-2.5 px-4 font-medium text-stone-800">{v.name}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-stone-600">{v.invoices}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums">{v.overdue > 0.005 ? <span className="text-red-600 font-medium">{formatMoney(v.overdue, currency)}</span> : <span className="text-stone-300">—</span>}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-amber-700">{v.payable > 0.005 ? formatMoney(v.payable, currency) : '—'}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-blue-700">{v.receivable > 0.005 ? formatMoney(v.receivable, currency) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function sum(methods, field, data, negate = false) {
  const t = methods.reduce((s, m) => s + (data.accounts[m]?.[field] || 0), 0);
  return negate ? -t : t;
}

function Row({ label, cells, indent, bold, top, cur }) {
  return (
    <tr className={`border-b border-line/70 last:border-0 ${bold ? 'bg-cream/50' : ''} ${top ? 'border-t-2 border-t-line' : ''}`}>
      <td className={`py-2 px-4 ${indent ? 'pl-8' : ''} ${bold ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>{label}</td>
      {cells.map((v, i) => {
        const n = Number(v) || 0;
        return (
          <td key={i} className={`py-2 px-4 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${n < 0 ? 'text-red-600' : n > 0 && !bold ? 'text-emerald-700' : 'text-stone-700'}`}>
            {formatMoney(n, cur)}
          </td>
        );
      })}
    </tr>
  );
}

function PLRow({ label, value, strong, border, cls = '', cur }) {
  const n = Number(value) || 0;
  return (
    <div className={`flex items-center justify-between ${border ? 'border-t border-line pt-2.5 mt-2.5' : ''}`}>
      <span className={`text-sm ${strong ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : 'font-medium'} ${n < 0 ? 'text-red-600' : cls}`}>
        {formatMoney(n, cur)}
      </span>
    </div>
  );
}

function BSRow({ label, value, note, cur }) {
  const n = Number(value) || 0;
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="py-2 px-4 text-stone-700">
        {label}
        {note && <span className="block text-[10px] text-stone-400">{note}</span>}
      </td>
      <td className={`py-2 px-4 text-right tabular-nums ${n < 0 ? 'text-red-600' : 'text-stone-800'}`}>{formatMoney(n, cur)}</td>
    </tr>
  );
}

function BSTotal({ label, value, cur }) {
  const n = Number(value) || 0;
  return (
    <tr className="bg-cream/50">
      <td className="py-2 px-4 text-sm font-semibold">{label}</td>
      <td className="py-2 px-4 text-right tabular-nums font-bold">{formatMoney(n, cur)}</td>
    </tr>
  );
}
