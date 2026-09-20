'use client';
// Sales list. Admins see all sales with filters; cashiers see their own.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, downloadCsv } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, storeDateStr } from '@/lib/format';
import { PRICING_MODE_LABELS } from '@/lib/pricing';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconDownload } from '@/components/icons';

const METHOD_LABEL = { cash: 'Cash', card: 'Card', other: 'Other' };

export default function SalesClient({ user, settings }) {
  const router = useRouter();
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const isAdmin = user.role === 'admin';

  // Defaults use the STORE timezone (server filters use it too), so the
  // list always covers business-today.
  const [from, setFrom] = useState(() => storeDateStr(tz, -6));
  const [to, setTo] = useState(() => storeDateStr(tz, 0));
  const [cashierId, setCashierId] = useState('');
  const [method, setMethod] = useState('');
  const [sales, setSales] = useState(null);
  const [cashiers, setCashiers] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (method) params.set('paymentMethod', method);
      if (isAdmin && cashierId) params.set('cashierId', cashierId);
      const data = await api(`/api/sales?${params}`);
      setSales(data.sales);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [from, to, method, cashierId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api('/api/users')
      .then((d) => setCashiers(d.users))
      .catch(() => {});
  }, [isAdmin]);

  const columns = [
    { key: 'sale_no', label: 'Sale No', render: (r) => <span className="font-medium">{r.sale_no}</span> },
    {
      key: 'created_at',
      label: 'Date / Time',
      render: (r) => (
        <span className="text-stone-600">
          {formatDate(r.created_at, tz)} · {formatTime(r.created_at, tz)}
        </span>
      ),
    },
    ...(isAdmin
      ? [{ key: 'cashier_name', label: 'Cashier', render: (r) => r.cashier_name || '—' }]
      : []),
    {
      key: 'customer_name',
      label: 'Customer',
      render: (r) => r.customer_name || <span className="text-stone-400">Walk-in</span>,
    },
    { key: 'line_count', label: 'Items', align: 'right' },
    { key: 'payment_method', label: 'Payment', render: (r) => METHOD_LABEL[r.payment_method] || r.payment_method },
    {
      key: 'pricing_mode',
      label: 'Mode',
      render: (r) =>
        r.pricing_mode && r.pricing_mode !== 'retail' ? (
          <Badge tone="muted">{PRICING_MODE_LABELS[r.pricing_mode] || r.pricing_mode}</Badge>
        ) : (
          <span className="text-stone-400">Retail</span>
        ),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => formatMoney(r.total, currency),
    },
    { key: 'paid', label: 'Paid', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.paid, currency) },
    { key: 'change_due', label: 'Change', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.change_due, currency) },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge tone={r.status === 'completed' ? 'ok' : 'muted'}>{r.status}</Badge>,
    },
  ];

  function exportCsv() {
    if (!sales || sales.length === 0) {
      toast('Nothing to export.', 'error');
      return;
    }
    downloadCsv(
      `sales_${from}_${to}.csv`,
      [
        { key: 'sale_no', label: 'Sale No' },
        { key: 'created_at', label: 'Date' },
        { key: 'cashier_name', label: 'Cashier' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'line_count', label: 'Items' },
        { key: 'payment_method', label: 'Payment' },
        { key: 'pricing_mode', label: 'Pricing Mode' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'discount', label: 'Discount' },
        { key: 'total', label: 'Total' },
        { key: 'paid', label: 'Paid' },
        { key: 'change_due', label: 'Change' },
        { key: 'status', label: 'Status' },
      ],
      sales
    );
    toast('CSV exported.');
  }

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title={isAdmin ? 'Sales' : 'Sales History'}
        sub={isAdmin ? 'All sales with filters' : 'Sales completed by you'}
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <IconDownload className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      <div className="bg-white border border-line rounded-lg p-4 mb-4 flex flex-wrap items-end gap-3">
        <FilterField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateCls} />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateCls} />
        </FilterField>
        {isAdmin && (
          <FilterField label="Cashier">
            <select value={cashierId} onChange={(e) => setCashierId(e.target.value)} className={`${dateCls} w-40`}>
              <option value="">All cashiers</option>
              {cashiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name || c.username}
                </option>
              ))}
            </select>
          </FilterField>
        )}
        <FilterField label="Payment">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${dateCls} w-36`}>
            <option value="">All methods</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </FilterField>
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !sales ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={sales} empty="No sales in this period." onRowClick={(r) => router.push(`/sales/${r.id}`)} />
        )}
      </div>
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <div>
      <div className="text-xs font-medium text-stone-600 mb-1">{label}</div>
      {children}
    </div>
  );
}

const dateCls =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/15';
