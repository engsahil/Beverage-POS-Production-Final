'use client';
// Daily / Weekly / Monthly Sales Records screen with payment breakdown and SVG graph.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadCsv } from '@/lib/api-client';
import { formatMoney, formatDate, storeDateStr } from '@/lib/format';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { IconDownload } from '@/components/icons';

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday as week start
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function DailyClient({ settings, readOnly = false }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const [mode, setMode] = useState('daily'); // 'daily' | 'weekly' | 'monthly'
  const [from, setFrom] = useState(() => storeDateStr(tz, -29));
  const [to, setTo] = useState(() => storeDateStr(tz, 0));
  const [days, setDays] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reqSeq = useRef(0);

  const load = useCallback(async (rangeFrom, rangeTo) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: rangeFrom, to: rangeTo });
      const data = await api(`/api/daily?${qs}`);
      if (seq !== reqSeq.current) return;
      setDays(data.days || []);
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
    load(from, to);
  }, [from, to, load]);

  function switchMode(nextMode) {
    setMode(nextMode);
    if (nextMode === 'daily') {
      setFrom(storeDateStr(tz, -29));
      setTo(storeDateStr(tz, 0));
    } else if (nextMode === 'weekly') {
      setFrom(storeDateStr(tz, -83));
      setTo(storeDateStr(tz, 0));
    } else if (nextMode === 'monthly') {
      setFrom(storeDateStr(tz, -364));
      setTo(storeDateStr(tz, 0));
    }
  }

  const aggregatedRows = useMemo(() => {
    if (mode === 'daily') {
      return days.map((r) => ({ ...r, period: r.date }));
    }
    const map = new Map();
    for (const r of days) {
      const key = mode === 'weekly' ? getWeekStart(r.date) : String(r.date).slice(0, 7);
      if (!map.has(key)) {
        map.set(key, {
          period: mode === 'weekly' ? `${key} to ${addDays(key, 6)}` : key,
          key,
          orders: 0,
          sales: 0,
          cash: 0,
          card: 0,
          other: 0,
          discount: 0,
          purchases: 0,
          expenses: 0,
          net: 0,
        });
      }
      const b = map.get(key);
      b.orders += Number(r.orders || 0);
      b.sales += Number(r.sales || 0);
      b.cash += Number(r.cash || 0);
      b.card += Number(r.card || 0);
      b.other += Number(r.other || 0);
      b.discount += Number(r.discount || 0);
      b.purchases += Number(r.purchases || 0);
      b.expenses += Number(r.expenses || 0);
      b.net += Number(r.net || 0);
    }
    return [...map.values()].sort((a, b) => String(b.key).localeCompare(String(a.key)));
  }, [days, mode]);

  const totals = days.reduce(
    (a, d) => ({
      orders: a.orders + Number(d.orders || 0),
      sales: a.sales + Number(d.sales || 0),
      cash: a.cash + Number(d.cash || 0),
      card: a.card + Number(d.card || 0),
      other: a.other + Number(d.other || 0),
      discount: a.discount + Number(d.discount || 0),
      purchases: a.purchases + Number(d.purchases || 0),
      expenses: a.expenses + Number(d.expenses || 0),
      net: a.net + Number(d.net || 0),
    }),
    { orders: 0, sales: 0, cash: 0, card: 0, other: 0, discount: 0, purchases: 0, expenses: 0, net: 0 }
  );

  const columns = [
    {
      key: 'period',
      label: mode === 'daily' ? 'Date' : mode === 'weekly' ? 'Week' : 'Month',
      render: (r) => (
        <span className="font-medium text-stone-900">
          {mode === 'daily' ? formatDate(r.date, tz) : r.period}
        </span>
      ),
    },
    { key: 'orders', label: 'Orders', align: 'right', className: 'tabular-nums' },
    {
      key: 'sales',
      label: 'Sales',
      align: 'right',
      className: 'font-semibold tabular-nums',
      render: (r) => formatMoney(r.sales, currency),
    },
    {
      key: 'cash',
      label: 'Cash',
      align: 'right',
      className: 'tabular-nums text-stone-600',
      render: (r) => formatMoney(r.cash, currency),
    },
    {
      key: 'card',
      label: 'Card',
      align: 'right',
      className: 'tabular-nums text-stone-600',
      render: (r) => formatMoney(r.card, currency),
    },
    {
      key: 'other',
      label: 'Other',
      align: 'right',
      className: 'tabular-nums text-stone-600',
      render: (r) => formatMoney(r.other, currency),
    },
    {
      key: 'discount',
      label: 'Discounts',
      align: 'right',
      className: 'tabular-nums text-stone-500',
      render: (r) => formatMoney(r.discount, currency),
    },
    ...(readOnly
      ? []
      : [
          {
            key: 'purchases',
            label: 'Purchases',
            align: 'right',
            className: 'tabular-nums text-stone-600',
            render: (r) => formatMoney(r.purchases, currency),
          },
          {
            key: 'expenses',
            label: 'Expenses',
            align: 'right',
            className: 'tabular-nums text-stone-600',
            render: (r) => formatMoney(r.expenses || 0, currency),
          },
          {
            key: 'net',
            label: 'Net (Sales − Out)',
            align: 'right',
            className: 'tabular-nums font-medium',
            render: (r) => (
              <span className={r.net < 0 ? 'text-red-700' : 'text-emerald-700'}>
                {formatMoney(r.net, currency)}
              </span>
            ),
          },
        ]),
  ];

  function exportCsv() {
    const csvCols = [
      { key: 'period', label: mode === 'daily' ? 'Date' : mode === 'weekly' ? 'Week' : 'Month' },
      { key: 'orders', label: 'Orders' },
      { key: 'sales', label: 'Sales' },
      { key: 'cash', label: 'Cash' },
      { key: 'card', label: 'Card' },
      { key: 'other', label: 'Other' },
      { key: 'discount', label: 'Discounts' },
      ...(readOnly
        ? []
        : [
            { key: 'purchases', label: 'Purchases' },
            { key: 'expenses', label: 'Expenses' },
            { key: 'net', label: 'Net' },
          ]),
    ];
    downloadCsv(`sales-records-${mode}-${from}-to-${to}.csv`, csvCols, aggregatedRows);
  }

  // Lightweight SVG Graph for Daily / Weekly / Monthly Sales Records
  const chartSeries = [...aggregatedRows].reverse().slice(-31);
  const maxSales = Math.max(...chartSeries.map((r) => Number(r.sales || 0)), 1);

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Daily Records"
        sub="Daily, weekly, and monthly sales totals, payment breakdowns, and trend graph."
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={aggregatedRows.length === 0}>
            <IconDownload className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      {/* Mode tabs + Date filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1.5">
          {[
            { id: 'daily', label: 'Daily Sales' },
            { id: 'weekly', label: 'Weekly Sales' },
            { id: 'monthly', label: 'Monthly Sales' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => switchMode(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                mode === t.id
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-700 border-stone-300 hover:bg-cream'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-stone-600">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
          />
          <label className="text-xs font-medium text-stone-600">to</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid grid-cols-2 ${readOnly ? 'sm:grid-cols-4' : 'sm:grid-cols-5'} gap-3 mb-4`}>
        <Card className="p-4">
          <div className="text-xs text-stone-500">
            {mode === 'daily' ? 'Daily Sales Total' : mode === 'weekly' ? 'Weekly Sales Total' : 'Monthly Sales Total'}
          </div>
          <div className="text-lg font-bold tabular-nums mt-0.5">{formatMoney(totals.sales, currency)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-stone-500">Total Orders</div>
          <div className="text-lg font-bold tabular-nums mt-0.5">{totals.orders}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-stone-500">Cash Sales</div>
          <div className="text-lg font-bold tabular-nums mt-0.5 text-emerald-700">
            {formatMoney(totals.cash, currency)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-stone-500">Card / Other</div>
          <div className="text-lg font-bold tabular-nums mt-0.5">
            {formatMoney(totals.card + totals.other, currency)}
          </div>
        </Card>
        {!readOnly && (
          <Card className="p-4">
            <div className="text-xs text-stone-500">Total Purchases</div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{formatMoney(totals.purchases, currency)}</div>
          </Card>
        )}
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={() => load(from, to)} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          {/* Lightweight SVG Graph */}
          {chartSeries.length > 0 && (
            <Card
              title={
                mode === 'daily'
                  ? 'Daily Sales Graph'
                  : mode === 'weekly'
                    ? 'Weekly Sales Graph'
                    : 'Monthly Sales Graph'
              }
              className="mb-4 p-4"
            >
              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 760 190" className="w-full h-44 select-none" role="img" aria-label="Sales record graph">
                  {[0, 0.5, 1].map((t) => {
                    const y = 20 + 130 * (1 - t);
                    const v = Math.round(maxSales * t);
                    return (
                      <g key={t}>
                        <line x1="52" y1={y} x2="744" y2={y} stroke="#e7e5e4" strokeDasharray={t === 0 ? undefined : '3 3'} />
                        <text x="46" y={y + 3} textAnchor="end" className="fill-stone-400 text-[9px] tabular-nums">
                          {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                        </text>
                      </g>
                    );
                  })}
                  {chartSeries.map((r, i) => {
                    const slotW = 692 / chartSeries.length;
                    const barW = Math.max(8, Math.min(36, slotW * 0.62));
                    const val = Number(r.sales || 0);
                    const bh = Math.max(val > 0 ? 3 : 0, (val / maxSales) * 130);
                    const cx = 52 + i * slotW + slotW / 2;
                    const x = cx - barW / 2;
                    const y = 20 + 130 - bh;
                    const lbl = String(r.period || '').slice(0, 10);
                    return (
                      <g key={r.period || i}>
                        <title>{`${r.period}: ${formatMoney(val, currency)} (${r.orders} orders)`}</title>
                        <rect x={x} y={y} width={barW} height={bh} rx="3" className="fill-brand" />
                        {(chartSeries.length <= 14 || i % Math.ceil(chartSeries.length / 10) === 0 || i === chartSeries.length - 1) && (
                          <text x={cx} y="168" textAnchor="middle" className="fill-stone-500 text-[9px] tabular-nums">
                            {lbl.length === 10 ? lbl.slice(5) : lbl}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden mb-4">
            <DataTable
              columns={columns}
              rows={aggregatedRows.map((d) => ({ id: d.period, ...d }))}
              empty="No activity recorded in this range."
            />
          </Card>

          {(mode === 'weekly' || mode === 'monthly') && days.length > 0 && (
            <Card title="Daily Breakdown" className="overflow-hidden">
              <DataTable
                columns={columns.map((c) =>
                  c.key === 'period'
                    ? { ...c, label: 'Date', render: (r) => <span className="font-medium text-stone-900">{formatDate(r.date, tz)}</span> }
                    : c
                )}
                rows={days.map((d) => ({ id: d.date, period: d.date, ...d }))}
                empty="No daily records."
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
