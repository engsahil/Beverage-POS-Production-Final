'use client';
// Daily Records: sales and purchases by business date.
import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv } from '@/lib/api-client';
import {  formatMoney, localDateStr, daysAgoStr , storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, DataTable, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconDownload } from '@/components/icons';

export default function DailyClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const [from, setFrom] = useState(() => storeDateStr(settings?.timezone, -29));
  const [to, setTo] = useState(() => storeDateStr(settings?.timezone, 0));
  const [days, setDays] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/daily?from=${from}&to=${to}`);
      setDays(d.days);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!days || days.length === 0) {
      toast('Nothing to export.', 'error');
      return;
    }
    downloadCsv(
      `daily_records_${from}_${to}.csv`,
      [
        { key: 'date', label: 'Date' },
        { key: 'orders', label: 'Orders' },
        { key: 'sales', label: 'Total Sales' },
        { key: 'cash', label: 'Cash Sales' },
        { key: 'card', label: 'Card Sales' },
        { key: 'other', label: 'Other Payments' },
        { key: 'discount', label: 'Discounts' },
        { key: 'purchase_count', label: 'Purchase Count' },
        { key: 'purchases', label: 'Total Purchases' },
      ],
      days
    );
    toast('CSV exported.');
  }

  const columns = [
    { key: 'date', label: 'Date', render: (r) => <span className="font-medium">{r.date}</span> },
    { key: 'orders', label: 'Orders', align: 'right', className: 'tabular-nums' },
    { key: 'sales', label: 'Total Sales', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatMoney(r.sales, currency) },
    { key: 'cash', label: 'Cash', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.cash, currency) },
    { key: 'card', label: 'Card', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.card, currency) },
    { key: 'other', label: 'Other', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.other, currency) },
    { key: 'discount', label: 'Discounts', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.discount, currency) },
    { key: 'purchase_count', label: 'Purchases', align: 'right', className: 'tabular-nums' },
    { key: 'purchases', label: 'Purchase Total', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatMoney(r.purchases, currency) },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Daily Records"
        sub="Daily sales and purchase totals (business date)"
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <IconDownload className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      <div className="bg-white border border-line rounded-lg p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs font-medium text-stone-600 mb-1">From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateCls} />
        </div>
        <div>
          <div className="text-xs font-medium text-stone-600 mb-1">To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateCls} />
        </div>
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !days ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={days} empty="No records in this period." />
        )}
      </div>
    </div>
  );
}

const dateCls =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/15';
