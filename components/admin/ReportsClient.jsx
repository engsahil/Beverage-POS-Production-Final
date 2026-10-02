'use client';
// Reports screen: Daily / Weekly / Monthly Sales + Date Range + Cashier / Product / Purchase / Inventory + SVG Graphs + CSV export.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadCsv } from '@/lib/api-client';
import { formatMoney, formatQty, storeDateStr } from '@/lib/format';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconDownload, IconPrinter } from '@/components/icons';

const REPORT_TABS = [
  { id: 'daily', label: 'Daily Sales', needsRange: true, defaultDays: -29 },
  { id: 'weekly', label: 'Weekly Sales', needsRange: true, defaultDays: -83 },
  { id: 'monthly', label: 'Monthly Sales', needsRange: true, defaultDays: -364 },
  { id: 'range', label: 'Date Range', needsRange: true, defaultDays: -29 },
  { id: 'cashiers', label: 'Sales by Cashier', needsRange: true, defaultDays: -29 },
  { id: 'products', label: 'Product Sales', needsRange: true, defaultDays: -29 },
  { id: 'purchases', label: 'Purchase Summary', needsRange: true, defaultDays: -29 },
  { id: 'inventory', label: 'Inventory Summary', needsRange: false, defaultDays: 0 },
];

const MONEY_KEYS = new Set(['sales', 'cash', 'card', 'other', 'discount', 'revenue', 'total', 'cost', 'value', 'avg_order']);
const NUM_KEYS = new Set(['orders', 'qty_sold', 'purchases', 'stock', 'min_stock', 'sizes']);

function SalesGraph({ rows, labelKey, valueKey = 'sales', secondKey = 'orders', currency, title }) {
  if (!rows || rows.length === 0) {
    return (
      <Card title={title || 'Graph'} className="mb-4 p-4">
        <div className="text-sm text-stone-400 py-6 text-center">No data in the selected range to plot.</div>
      </Card>
    );
  }

  // Chronological order (oldest -> newest), up to 31 bars for crisp readability
  const series = [...rows].reverse().slice(-31);
  const maxVal = Math.max(...series.map((r) => Number(r[valueKey] || 0)), 1);

  const svgWidth = 760;
  const svgHeight = 210;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 22;
  const padBottom = 42;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;
  const slotW = plotW / series.length;
  const barW = Math.max(8, Math.min(38, slotW * 0.62));

  return (
    <Card title={title || 'Sales Graph'} className="mb-4 p-4" data-testid="report-graph">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-52 select-none"
          role="img"
          aria-label={title || 'Sales chart'}
        >
          {/* Horizontal grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padTop + plotH * (1 - t);
            const v = Math.round(maxVal * t);
            return (
              <g key={t}>
                <line x1={padLeft} y1={y} x2={svgWidth - padRight} y2={y} stroke="#e7e5e4" strokeDasharray={t === 0 ? undefined : '3 3'} />
                <text x={padLeft - 6} y={y + 3} textAnchor="end" className="fill-stone-400 text-[9px] tabular-nums">
                  {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {series.map((r, i) => {
            const val = Number(r[valueKey] || 0);
            const orders = Number(r[secondKey] || 0);
            const bh = Math.max(val > 0 ? 3 : 0, (val / maxVal) * plotH);
            const cx = padLeft + i * slotW + slotW / 2;
            const x = cx - barW / 2;
            const y = padTop + plotH - bh;
            const rawLbl = String(r[labelKey] || '');
            const shortLbl =
              rawLbl.length > 10
                ? rawLbl.slice(5, 10)
                : rawLbl.length === 10
                  ? rawLbl.slice(5)
                  : rawLbl;

            return (
              <g key={rawLbl || i}>
                <title>
                  {`${rawLbl}: ${formatMoney(val, currency)}${orders ? ` (${orders} orders)` : ''}`}
                </title>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={bh}
                  rx="3"
                  className="fill-brand hover:opacity-85 transition-opacity"
                />
                {series.length <= 16 && val > 0 && (
                  <text
                    x={cx}
                    y={Math.max(12, y - 4)}
                    textAnchor="middle"
                    className="fill-stone-600 text-[9px] font-medium tabular-nums"
                  >
                    {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
                  </text>
                )}
                {(series.length <= 16 || i % Math.ceil(series.length / 12) === 0 || i === series.length - 1) && (
                  <text
                    x={cx}
                    y={padTop + plotH + 16}
                    textAnchor="middle"
                    className="fill-stone-500 text-[9px] tabular-nums"
                  >
                    {shortLbl}
                  </text>
                )}
                {secondKey && (series.length <= 16 || i % Math.ceil(series.length / 12) === 0) && (
                  <text
                    x={cx}
                    y={padTop + plotH + 28}
                    textAnchor="middle"
                    className="fill-stone-400 text-[8px] tabular-nums"
                  >
                    {orders} ord
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}

export default function ReportsClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const [tab, setTab] = useState('daily');
  const [from, setFrom] = useState(() => storeDateStr(tz, -29));
  const [to, setTo] = useState(() => storeDateStr(tz, 0));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reqSeq = useRef(0);

  const load = useCallback(async (activeTab, rangeFrom, rangeTo) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (rangeFrom) qs.set('from', rangeFrom);
      if (rangeTo) qs.set('to', rangeTo);
      const res = await api(`/api/reports/${activeTab}?${qs}`);
      if (seq !== reqSeq.current) return;
      setData(res);
      setError('');
    } catch (err) {
      if (seq !== reqSeq.current) return;
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab, from, to);
  }, [tab, from, to, load]);

  function handleTabSwitch(t) {
    setTab(t.id);
    if (t.needsRange) {
      setFrom(storeDateStr(tz, t.defaultDays));
      setTo(storeDateStr(tz, 0));
    }
  }

  const currentTab = REPORT_TABS.find((t) => t.id === tab);

  function renderValue(key, v) {
    if (MONEY_KEYS.has(key)) return formatMoney(v, currency);
    if (key === 'stock' || key === 'min_stock' || key === 'qty_sold') return formatQty(v);
    if (NUM_KEYS.has(key)) return Number(v);
    return v;
  }

  const columns = (data?.columns || []).map((c) => {
    const isNum = MONEY_KEYS.has(c.key) || NUM_KEYS.has(c.key);
    return {
      key: c.key,
      label: c.label,
      align: isNum ? 'right' : 'left',
      className: isNum ? 'tabular-nums' : '',
      render: (r) => renderValue(c.key, r[c.key]),
    };
  });

  const rows = data?.rows || [];
  const totals = {};
  if (rows.length > 0) {
    for (const c of data.columns) {
      if (c.key === 'avg_order') continue;
      if (MONEY_KEYS.has(c.key) || NUM_KEYS.has(c.key)) {
        totals[c.key] = rows.reduce((s, r) => s + Number(r[c.key] || 0), 0);
      }
    }
    if (totals.orders > 0 && totals.sales !== undefined) {
      totals.avg_order = totals.sales / totals.orders;
    }
  }

  function exportCsv() {
    if (!data) return;
    downloadCsv(`${tab}-report-${from}-to-${to}.csv`, data.columns, data.rows);
  }

  const isSalesPeriodTab = tab === 'daily' || tab === 'weekly' || tab === 'monthly' || tab === 'range';
  const summary = data?.summary;
  const dailyBreakdown = data?.dailyBreakdown || [];

  const dailyBreakdownColumns = [
    { key: 'date', label: 'Date' },
    { key: 'orders', label: 'Orders', align: 'right', className: 'tabular-nums' },
    { key: 'sales', label: 'Sales', align: 'right', className: 'tabular-nums font-medium', render: (r) => formatMoney(r.sales, currency) },
    { key: 'cash', label: 'Cash', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.cash, currency) },
    { key: 'card', label: 'Card', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.card, currency) },
    { key: 'other', label: 'Other', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.other, currency) },
    { key: 'discount', label: 'Discounts', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.discount, currency) },
  ];

  // Determine chart parameters by active tab
  const chartConfig = (() => {
    if (tab === 'daily' || tab === 'range') {
      return { rows, labelKey: 'date', valueKey: 'sales', secondKey: 'orders', title: 'Daily Sales Graph' };
    }
    if (tab === 'weekly') {
      return { rows, labelKey: 'week_start', valueKey: 'sales', secondKey: 'orders', title: 'Weekly Sales Graph' };
    }
    if (tab === 'monthly') {
      return { rows, labelKey: 'month', valueKey: 'sales', secondKey: 'orders', title: 'Monthly Sales Graph' };
    }
    if (tab === 'cashiers') {
      return { rows, labelKey: 'cashier', valueKey: 'sales', secondKey: 'orders', title: 'Sales by Cashier Graph' };
    }
    if (tab === 'products') {
      return { rows: rows.slice(0, 15), labelKey: 'product', valueKey: 'revenue', secondKey: 'qty_sold', title: 'Top Products Revenue Graph' };
    }
    if (tab === 'purchases') {
      return { rows, labelKey: 'date', valueKey: 'total', secondKey: 'purchases', title: 'Purchases Graph' };
    }
    if (tab === 'inventory') {
      return { rows: rows.slice(0, 15), labelKey: 'product', valueKey: 'value', secondKey: 'stock', title: 'Inventory Value Graph' };
    }
    return null;
  })();

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Reports"
        sub="Daily, weekly, and monthly sales records, graphs, and printable summaries."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
              <IconDownload className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={!rows.length} className="no-print">
              <IconPrinter className="w-4 h-4" /> Print
            </Button>
          </>
        }
      />

      {/* Tabs + range */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 no-print">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTabSwitch(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                tab === t.id
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-700 border-stone-300 hover:bg-cream'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {currentTab?.needsRange && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
            />
            <span className="text-xs text-stone-500">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={() => load(tab, from, to)} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          {/* Summary KPI cards for Daily / Weekly / Monthly / Range Sales */}
          {isSalesPeriodTab && summary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <Card className="p-4">
                <div className="text-xs font-medium text-stone-500 mb-1">
                  {tab === 'daily' ? 'Daily Sales Total' : tab === 'weekly' ? 'Weekly Sales Total' : tab === 'monthly' ? 'Monthly Sales Total' : 'Total Sales'}
                </div>
                <div className="text-xl font-bold tabular-nums text-stone-900">
                  {formatMoney(summary.total_sales, currency)}
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">
                  Avg order {formatMoney(summary.avg_order, currency)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-stone-500 mb-1">Orders / Transactions</div>
                <div className="text-xl font-bold tabular-nums text-stone-900">{summary.total_orders}</div>
                <div className="text-[11px] text-stone-400 mt-0.5">Completed sales</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-stone-500 mb-1">Cash Payment</div>
                <div className="text-xl font-bold tabular-nums text-emerald-700">
                  {formatMoney(summary.cash, currency)}
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">Cash drawer</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-stone-500 mb-1">Card Payment</div>
                <div className="text-xl font-bold tabular-nums text-stone-800">
                  {formatMoney(summary.card, currency)}
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">POS card terminal</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-stone-500 mb-1">Other / Credit</div>
                <div className="text-xl font-bold tabular-nums text-amber-700">
                  {formatMoney(summary.other, currency)}
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">
                  Discounts: {formatMoney(summary.discount, currency)}
                </div>
              </Card>
            </div>
          )}

          {/* Lightweight SVG Graph */}
          {chartConfig && (
            <SalesGraph
              rows={chartConfig.rows}
              labelKey={chartConfig.labelKey}
              valueKey={chartConfig.valueKey}
              secondKey={chartConfig.secondKey}
              currency={currency}
              title={chartConfig.title}
            />
          )}

          {/* Primary Report Table */}
          <Card
            title={
              currentTab?.needsRange
                ? `${currentTab.label} (${from} to ${to})`
                : currentTab?.label
            }
            className="overflow-hidden mb-4"
          >
            <DataTable
              columns={columns}
              rows={rows.map((r, i) => ({ id: i, ...r }))}
              empty="No records for this range."
            />
            {rows.length > 0 && Object.keys(totals).length > 0 && (
              <div className="border-t border-line bg-cream/60 px-3.5 py-2.5 flex flex-wrap justify-end gap-6 text-xs">
                {data.columns
                  .filter((c) => totals[c.key] !== undefined)
                  .map((c) => (
                    <div key={c.key}>
                      <span className="text-stone-500">{c.label}: </span>
                      <span className="font-semibold text-stone-900 tabular-nums">
                        {renderValue(c.key, totals[c.key])}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          {/* Daily Breakdown table for Weekly and Monthly views */}
          {(tab === 'weekly' || tab === 'monthly') && (
            <Card
              title={`Daily Breakdown (${from} to ${to})`}
              className="overflow-hidden"
            >
              <DataTable
                columns={dailyBreakdownColumns}
                rows={dailyBreakdown.map((r) => ({ id: r.date, ...r }))}
                empty="No daily sales in this period."
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
