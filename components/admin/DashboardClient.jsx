'use client';
// Admin dashboard: today's numbers, low stock, recent activity.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, formatQty } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Loading } from '@/components/ui';
import { useSyncStatus, SyncPill } from '@/components/SyncStatus';
import Onboarding from '@/components/Onboarding';

export default function DashboardClient({ settings }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const { status: syncStatus, lastSync, withStatus } = useSyncStatus();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (fresh = false) => {
    try {
      await withStatus(async () => {
        setData(await api('/api/dashboard', { fresh }));
        setError('');
      });
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [withStatus]);

  useEffect(() => {
    load(); // mount: use short cache if data is fresh
    const t = setInterval(() => load(true).catch(() => {}), 30000); // poll: always fresh
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="p-6 max-w-6xl"><ErrorBox message={error} onRetry={load} /></div>;
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    );

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Dashboard</h1>
          <p className="text-sm text-stone-500 mt-0.5">Today at a glance. Refreshes automatically every ~30 seconds.</p>
        </div>
        <div className="flex items-center gap-2">
          <SyncPill status={syncStatus} lastSync={lastSync} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent('bevpos:open-guide'))}
          >
            Getting started guide
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Today's Sales" value={formatMoney(data.today.sales, currency)} />
        <Stat label="Today's Orders" value={String(data.today.orders)} />
        <Stat label="Today's Purchases" value={formatMoney(data.todayPurchases.total, currency)} />
        <Stat
          label="Low Stock Products"
          value={String(data.lowStock.length)}
          tone={data.lowStock.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Business insights: Today / Streak / Monthly Sales Goal */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GoalCard
          title="Today"
          big={formatMoney(data.goals.daily.sales, currency)}
          sub={`Daily goal: ${data.goals.daily.goal > 0 ? formatMoney(data.goals.daily.goal, currency) : 'not set'}`}
          pct={data.goals.daily.goal > 0 ? Math.min(100, (data.goals.daily.sales / data.goals.daily.goal) * 100) : null}
          met={data.goals.daily.met}
        />
        <GoalCard
          title="Streak"
          big={`${data.goals.streak.days} day${data.goals.streak.days === 1 ? '' : 's'}`}
          sub={
            data.goals.streak.goal > 0
              ? `Consecutive days at or above the ${formatMoney(data.goals.streak.goal, currency)} daily goal`
              : 'Consecutive days with recorded sales activity'
          }
          pct={data.goals.daily.goal > 0 ? Math.min(100, (data.goals.daily.sales / data.goals.daily.goal) * 100) : null}
          met={data.goals.streak.days > 0}
          flame
        />
        <GoalCard
          title="Monthly Sales Goal"
          big={formatMoney(data.goals.monthly.sales, currency)}
          sub={`Month goal: ${data.goals.monthly.goal > 0 ? formatMoney(data.goals.monthly.goal, currency) : 'not set'}`}
          pct={data.goals.monthly.goal > 0 ? Math.min(100, (data.goals.monthly.sales / data.goals.monthly.goal) * 100) : null}
          met={data.goals.monthly.met}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card
          title="Recent Sales"
          actions={
            <Link href="/sales" className="text-xs font-medium text-stone-500 hover:text-stone-800">
              View all
            </Link>
          }
        >
          {data.recentSales.length === 0 ? (
            <div className="p-6 text-center text-sm text-stone-400">No sales yet.</div>
          ) : (
            <ul className="divide-y divide-line/80">
              {data.recentSales.map((s) => (
                <li key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link href={`/sales/${s.id}`} className="text-sm font-medium text-stone-800 hover:underline">
                      {s.sale_no}
                    </Link>
                    <div className="text-xs text-stone-500">
                      {formatDate(s.created_at, tz)} · {formatTime(s.created_at, tz)} · {s.cashier || '—'}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(s.total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent Purchases"
          actions={
            <Link href="/admin/purchases" className="text-xs font-medium text-stone-500 hover:text-stone-800">
              View all
            </Link>
          }
        >
          {data.recentPurchases.length === 0 ? (
            <div className="p-6 text-center text-sm text-stone-400">No purchases yet.</div>
          ) : (
            <ul className="divide-y divide-line/80">
              {data.recentPurchases.map((p) => (
                <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/purchases/${p.id}`} className="text-sm font-medium text-stone-800 hover:underline">
                      {p.vendor}
                    </Link>
                    <div className="text-xs text-stone-500">{formatDate(p.purchase_date, tz)}</div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(p.total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Low Stock"
          actions={
            <Link href="/admin/inventory" className="text-xs font-medium text-stone-500 hover:text-stone-800">
              Inventory
            </Link>
          }
        >
          {data.lowStock.length === 0 ? (
            <div className="p-6 text-center text-sm text-stone-400">No low stock items.</div>
          ) : (
            <ul className="divide-y divide-line/80">
              {data.lowStock.map((p) => (
                <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="flex-1 text-sm text-stone-800 truncate">{p.name}</span>
                  <Badge tone={p.stock === 0 ? 'bad' : 'warn'}>
                    {p.stock === 0 ? 'Out of stock' : `${formatQty(p.stock)} left (min ${formatQty(p.min_stock)})`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Inventory Summary">
          <div className="p-4 grid grid-cols-2 gap-4">
            <SummaryItem label="Active products" value={String(data.inventory.products)} />
            <SummaryItem label="Out of stock" value={String(data.inventory.out_of_stock)} />
            <SummaryItem label="Low stock" value={String(data.inventory.low_stock)} />
            <SummaryItem label="Stock value (cost)" value={formatMoney(data.inventory.stock_value, currency)} />
          </div>
        </Card>
      </div>

      <Onboarding autoOpen />
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-white border border-line rounded-lg p-4">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div
        className={`mt-1.5 text-xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-stone-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-semibold text-stone-900 tabular-nums">{value}</div>
    </div>
  );
}

function GoalCard({ title, big, sub, pct, met, flame }) {
  return (
    <div className="bg-white border border-line rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">{title}</span>
        {met ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
            {flame ? 'On a streak' : pct !== null ? `${Math.round(pct)}% · Goal met` : 'Goal met'}
          </span>
        ) : (
          pct !== null && (
            <span className="text-[11px] font-medium text-stone-500">{Math.round(pct)}%</span>
          )
        )}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${met ? 'text-emerald-700' : 'text-stone-900'}`}>{big}</div>
      <div className="text-xs text-stone-400 mt-0.5 leading-snug">{sub}</div>
      {pct !== null && (
        <div className="mt-2.5 h-1.5 rounded-full bg-stone-100 overflow-hidden">
          <div
            className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}
