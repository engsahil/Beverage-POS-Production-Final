'use client';
// Shift detail: full reconciliation summary from real database data.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime } from '@/lib/format';
import { Badge, Button, ErrorBox, Loading, PageHeader } from '@/components/ui';

export default function ShiftDetailClient({ shiftId, user, settings }) {
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/shifts/${shiftId}`));
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="p-6"><ErrorBox message={error} onRetry={load} /></div>;
  if (!data) return <div className="p-6"><Loading /></div>;

  const { shift, summary } = data;
  const diff = shift.difference !== null && shift.difference !== undefined ? Number(shift.difference) : null;

  function downloadCsv() {
    const rows = [
      ['Field', 'Value'],
      ['Cashier', shift.cashier_name || '—'],
      ['Shift ID', shift.id],
      ['Status', shift.status],
      ['Opened', new Date(shift.opened_at).toLocaleString()],
      ['Closed', shift.closed_at ? new Date(shift.closed_at).toLocaleString() : ''],
      ['Sales count', summary.sales.count],
      ['Total sales', summary.sales.total],
      ['Cash sales', summary.sales.cash],
      ['Card sales', summary.sales.card],
      ['Other sales', summary.sales.other],
      ['Opening cash', shift.opening_cash],
      ['Expected cash', shift.expected_cash ?? ''],
      ['Counted cash', shift.closing_cash ?? ''],
      ['Difference', shift.difference ?? ''],
      ['Expenses in shift', summary.expenses.reduce((s, e) => s + Number(e.amount), 0)],
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shift_${shift.id}_summary.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        back={{ href: '/admin/shifts', label: 'Shifts' }}
        title={`Shift #${shift.id}`}
        sub={`${shift.cashier_name || '—'} · opened ${formatDate(shift.opened_at, tz)} ${formatTime(shift.opened_at, tz)}`}
        actions={
          <div className="flex gap-2 items-center">
            <Badge tone={shift.status === 'open' ? 'ok' : 'muted'}>{shift.status}</Badge>
            <Button variant="secondary" onClick={downloadCsv}>Download CSV</Button>
          </div>
        }
      />

      <div className="bg-white border border-line rounded-lg divide-y divide-line/80">
        <section className="p-4">
          <h3 className="text-sm font-semibold text-stone-800 mb-3">Sales during shift</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Orders" value={String(summary.sales.count)} />
            <Stat label="Total" value={formatMoney(summary.sales.total, currency)} />
            <Stat label="Cash" value={formatMoney(summary.sales.cash, currency)} />
            <Stat label="Card" value={formatMoney(summary.sales.card, currency)} />
            <Stat label="Other" value={formatMoney(summary.sales.other, currency)} />
          </div>
        </section>

        {shift.status === 'closed' && (
          <section className="p-4">
            <h3 className="text-sm font-semibold text-stone-800 mb-3">Cash reconciliation</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Opening cash" value={formatMoney(shift.opening_cash, currency)} />
              <Stat label="Expected cash" value={formatMoney(shift.expected_cash, currency)} />
              <Stat label="Counted cash" value={formatMoney(shift.closing_cash, currency)} />
              <Stat
                label="Difference"
                value={formatMoney(shift.difference, currency)}
                cls={diff === null ? '' : Math.abs(diff) < 0.01 ? 'text-emerald-700' : diff < 0 ? 'text-red-700' : 'text-amber-700'}
              />
            </div>
          </section>
        )}

        <section className="p-4">
          <h3 className="text-sm font-semibold text-stone-800 mb-3">Expenses during shift</h3>
          {summary.expenses.length === 0 ? (
            <div className="text-sm text-stone-400">No expenses recorded during this shift.</div>
          ) : (
            <ul className="divide-y divide-line/80">
              {summary.expenses.map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-stone-800">{e.category}</span>
                    {e.note && <span className="text-stone-500"> — {e.note}</span>}
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(e.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, cls = '' }) {
  return (
    <div className="bg-cream/60 rounded-md p-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
