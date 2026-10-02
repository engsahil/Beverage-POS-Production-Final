'use client';
// Reports: daily, weekly, monthly and operational summaries with CSV export.
import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv } from '@/lib/api-client';
import {  formatMoney, formatQty, localDateStr, daysAgoStr , storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, DataTable, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconCopy, IconDownload } from '@/components/icons';

const TABS = [
  { key: 'daily', label: 'Daily Sales' },
  { key: 'weekly', label: 'Weekly Sales' },
  { key: 'monthly', label: 'Monthly Sales' },
  { key: 'range', label: 'Date Range' },
  { key: 'cashiers', label: 'Sales by Cashier' },
  { key: 'products', label: 'Product Sales' },
  { key: 'purchases', label: 'Purchase Summary' },
  { key: 'inventory', label: 'Inventory Summary' },
];

export default function ReportsClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const [tab, setTab] = useState('daily');
  const [from, setFrom] = useState(() => storeDateStr(settings?.timezone, -29));
  const [to, setTo] = useState(() => storeDateStr(settings?.timezone, 0));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const needsDate = tab !== 'inventory';

  const load = useCallback(async () => {
    try {
      const params = needsDate ? `from=${from}&to=${to}` : '';
      const d = await api(`/api/reports/${tab}${params ? `?${params}` : ''}`);
      setData(d);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [tab, from, to, needsDate]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const money = (v) => formatMoney(v, currency);

  // Render helper that knows which cells are money values.
  function cell(r, key) {
    const moneyKeys = ['sales', 'cash', 'card', 'other', 'discount', 'total', 'value', 'revenue', 'stock_value', 'avg_order'];
    if (moneyKeys.includes(key)) return money(r[key]);
    if (['stock', 'min_stock', 'qty_sold', 'cost'].includes(key)) return formatQty(r[key]);
    return r[key];
  }

  function exportCsv() {
    if (!data || !data.rows || data.rows.length === 0) {
      toast('Nothing to export.', 'error');
      return;
    }
    downloadCsv(`report_${tab}_${from}_${to}.csv`, data.columns, data.rows);
    toast('CSV exported.');
  }

  async function copySummary() {
    if (!data || !data.rows) return;
    const lines = [];
    const title = TABS.find((t) => t.key === tab)?.label || tab;
    lines.push(`${title} Report`);
    if (data.range) lines.push(`Period: ${data.range.from} to ${data.range.to}`);
    lines.push('');
    lines.push(data.columns.map((c) => c.label).join(' | '));
    for (const r of data.rows.slice(0, 25)) {
      lines.push(data.columns.map((c) => cell(r, c.key)).join(' | '));
    }
    if (data.rows.length > 25) lines.push(`… and ${data.rows.length - 25} more rows`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Summary copied to clipboard.');
    } catch {
      toast('Unable to copy on this browser.', 'error');
    }
  }

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Reports"
        sub="Lightweight sales and inventory reports"
        actions={
          <>
            <Button variant="secondary" onClick={copySummary} disabled={!data || !data.rows?.length}>
              <IconCopy className="w-4 h-4" /> Copy Summary
            </Button>
            <Button variant="secondary" onClick={exportCsv} disabled={!data || !data.rows?.length}>
              <IconDownload className="w-4 h-4" /> Export CSV
            </Button>
          </>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === t.key
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {needsDate && (
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
      )}

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : (
          <DataTable
            columns={data.columns.map((c) => ({
              key: c.key,
              label: c.label,
              align: ['orders', 'qty_sold', 'stock', 'min_stock', 'purchases', 'cash', 'card', 'other', 'discount', 'sales', 'total', 'value', 'revenue', 'cost', 'avg_order'].includes(c.key)
                ? 'right'
                : 'left',
              className: ['sales', 'total', 'value', 'revenue', 'avg_order'].includes(c.key) ? 'font-semibold tabular-nums' : 'tabular-nums',
              render: (r) => cell(r, c.key),
            }))}
            rows={data.rows}
            empty="No data for this period."
          />
        )}
      </div>
    </div>
  );
}

const dateCls =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/15';
