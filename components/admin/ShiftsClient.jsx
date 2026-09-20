'use client';
// Shifts: open/close cashier shifts and reconcile cash.
// Admins see all shifts; each user also sees their own.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, round2 } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input } from '@/components/ui';

export default function ShiftsClient({ user, settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const isAdmin = user.role === 'admin';

  const [shifts, setShifts] = useState(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(null); // shift
  const [closingCash, setClosingCash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { shift, closing, summary }

  const load = useCallback(async () => {
    try {
      const d = await api('/api/shifts');
      setShifts(d.shifts);
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

  async function startClose(s) {
    setClosing(s);
    setClosingCash('');
    setResult(null);
  }

  async function doClose() {
    if (submitting) return;
    const amount = Number(closingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast('Enter the counted cash amount.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const d = await api(`/api/shifts/${closing.id}`, {
        method: 'POST',
        body: { closingCash: amount },
      });
      setResult(d);
      toast('Shift closed.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const { shift, closing: c, summary } = result;
    const rows = [
      ['Field', 'Value'],
      ['Cashier', shift.cashier_name || '—'],
      ['Shift ID', shift.id],
      ['Opened', new Date(shift.opened_at).toLocaleString()],
      ['Closed', new Date(c.closedAt).toLocaleString()],
      ['Sales count', summary.sales.count],
      ['Total sales', summary.sales.total],
      ['Cash sales', summary.sales.cash],
      ['Card sales', summary.sales.card],
      ['Other sales', summary.sales.other],
      ['Opening cash', shift.opening_cash],
      ['Expected cash', c.expectedCash],
      ['Counted cash', c.countedCash],
      ['Difference', c.difference],
      ['Expenses in shift', summary.expenses.reduce((s, e) => s + Number(e.amount), 0)],
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shift_${shift.id}_close.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const columns = [
    { key: 'id', label: 'Shift', render: (r) => <span className="font-medium text-stone-800">#{r.id}</span> },
    ...(isAdmin ? [{ key: 'cashier_name', label: 'Cashier', render: (r) => r.cashier_name || '—' }] : []),
    {
      key: 'opened_at',
      label: 'Opened',
      render: (r) => (
        <span className="text-stone-600">
          {formatDate(r.opened_at, tz)} · {formatTime(r.opened_at, tz)}
        </span>
      ),
    },
    { key: 'opening_cash', label: 'Opening Cash', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.opening_cash, currency) },
    {
      key: 'closed_at',
      label: 'Closed',
      render: (r) =>
        r.status === 'open' ? (
          <span className="text-stone-400">—</span>
        ) : (
          <span className="text-stone-600">
            {formatDate(r.closed_at, tz)} · {formatTime(r.closed_at, tz)}
          </span>
        ),
    },
    {
      key: 'difference',
      label: 'Difference',
      align: 'right',
      className: 'tabular-nums',
      render: (r) =>
        r.status === 'closed' ? (
          <span
            className={`font-semibold ${
              Math.abs(Number(r.difference)) < 0.01 ? 'text-emerald-700' : Number(r.difference) < 0 ? 'text-red-700' : 'text-amber-700'
            }`}
          >
            {formatMoney(r.difference, currency)}
          </span>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge tone={r.status === 'open' ? 'ok' : 'muted'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          <Link
            href={`/admin/shifts/${r.id}`}
            className="px-2 py-1 rounded text-xs font-medium border border-stone-300 text-stone-600 hover:bg-cream"
          >
            Summary
          </Link>
          {r.status === 'open' && (
            <button
              onClick={() => startClose(r)}
              className="px-2 py-1 rounded text-xs font-medium border border-red-300 text-red-700 hover:bg-red-50"
            >
              Close
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Shifts"
        sub="Open a shift on the POS screen with the opening cash, then close it here (or on the POS) to reconcile."
      />

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !shifts ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={shifts} empty="No shifts yet. Open one from the POS screen." />
        )}
      </div>

      {closing && (
        <Modal
          title={result ? `Shift #${closing.id} closed` : `Close shift #${closing.id}`}
          onClose={() => {
            setClosing(null);
            setResult(null);
          }}
          footer={
            result ? (
              <>
                <Button variant="secondary" onClick={downloadCsv}>Download report (CSV)</Button>
                <Button
                  onClick={() => {
                    setClosing(null);
                    setResult(null);
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setClosing(null)}>Cancel</Button>
                <Button loading={submitting} onClick={doClose}>Close Shift</Button>
              </>
            )
          }
        >
          {result ? (
            <div className="space-y-2 text-sm">
              <Row label="Expected cash" value={formatMoney(result.closing.expectedCash, currency)} />
              <Row label="Counted cash" value={formatMoney(result.closing.countedCash, currency)} />
              <Row
                label="Difference"
                value={formatMoney(result.closing.difference, currency)}
                cls={
                  Math.abs(result.closing.difference) < 0.01
                    ? 'text-emerald-700'
                    : result.closing.difference < 0
                      ? 'text-red-700'
                      : 'text-amber-700'
                }
              />
              <Row
                label="Sales in shift"
                value={`${result.summary.sales.count} · ${formatMoney(result.summary.sales.total, currency)}`}
              />
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="text-sm text-stone-600">
                Cashier: <span className="font-semibold">{closing.cashier_name || '—'}</span>
                {' · '}Opened {formatDate(closing.opened_at, tz)} {formatTime(closing.opened_at, tz)}
              </div>
              <div className="text-sm text-stone-600">
                Opening cash: <span className="font-semibold">{formatMoney(closing.opening_cash, currency)}</span>
              </div>
              <Input
                label={`Counted cash (${currency})`}
                type="number"
                min="0"
                step="0.01"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                hint="Expected cash = opening cash + cash sales made during the shift (computed by the server)."
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, cls = 'text-stone-800' }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-600">{label}</span>
      <span className={`font-semibold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
