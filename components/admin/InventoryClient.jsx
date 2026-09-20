'use client';
// Inventory: current stock, low stock, adjustments and movement history.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, formatDate, formatTime, formatQty } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select } from '@/components/ui';

/** Walk back from current stock to get the stock AFTER each movement (movements are newest first). */
function resultingStocks(movements, currentStock) {
  let after = Number(currentStock);
  return movements.map((m) => {
    const entry = { ...m, resulting: Math.round(after * 100) / 100 };
    after = Math.round((after - Number(m.change)) * 100) / 100;
    return entry;
  });
}

export default function InventoryClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;

  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all | out | low | expiring | expired
  const [adjust, setAdjust] = useState(null); // product
  const [adjustVariantId, setAdjustVariantId] = useState(''); // size for sized products
  const [history, setHistory] = useState(null); // { product, movements }
  const [delta, setDelta] = useState('');
  const [direction, setDirection] = useState('increase');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null); // product id with visible size breakdown

  const load = useCallback(async () => {
    try {
      const d = await api('/api/products');
      setProducts(d.products);
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

  const today = new Date().toISOString().slice(0, 10);
  const in30 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();
  const active = (products || []).filter((p) => p.active);
  const lowCount = active.filter((p) => Number(p.stock) <= Number(p.min_stock)).length;
  const outCount = active.filter((p) => Number(p.stock) <= 0).length;
  const stockValue = active.reduce((s, p) => s + Number(p.stock) * Number(p.cost), 0);

  // Expiry dates a product contributes: its own (plain products) or its
  // sizes' dates (sized products).
  const expiryDates = (p) =>
    (p.variants || []).length > 0
      ? (p.variants || []).map((v) => (v.expiry_date ? String(v.expiry_date).slice(0, 10) : null)).filter(Boolean)
      : p.expiry_date
        ? [String(p.expiry_date).slice(0, 10)]
        : [];
  const isExpired = (p) => expiryDates(p).some((d) => d < today);
  const isExpiring = (p) => !isExpired(p) && expiryDates(p).some((d) => d <= in30);
  const expiredCount = active.filter(isExpired).length;

  const visible = active.filter((p) => {
    if (filter === 'out') return Number(p.stock) <= 0;
    if (filter === 'low') return Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock);
    if (filter === 'expired') return isExpired(p);
    if (filter === 'expiring') return isExpiring(p);
    return true;
  });

  function openAdjust(p) {
    setDelta('');
    setDirection('increase');
    setNote('');
    setAdjustVariantId((p.variants || [])[0]?.id ? String((p.variants || [])[0].id) : '');
    setAdjust(p);
  }

  async function saveAdjust(e) {
    e.preventDefault();
    if (saving) return;
    const q = Number(delta);
    if (!Number.isFinite(q) || q <= 0) {
      toast('Enter a quantity above zero.', 'error');
      return;
    }
    const sized = (adjust.variants || []).length > 0;
    if (sized && !adjustVariantId) {
      toast('Select the size to adjust.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/api/inventory/adjust', {
        method: 'POST',
        body: {
          productId: adjust.id,
          variantId: sized ? Number(adjustVariantId) : null,
          delta: direction === 'increase' ? q : -q,
          note: note.trim(),
        },
      });
      toast('Stock updated.');
      setAdjust(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(p) {
    setHistory({ product: p, movements: null });
    try {
      const d = await api(`/api/stock-movements?productId=${p.id}&limit=50`);
      setHistory({ product: p, movements: d.movements });
    } catch (err) {
      toast(err.message, 'error');
      setHistory(null);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'Product',
      render: (r) => {
        const vs = r.variants || [];
        const open = expanded === r.id;
        return (
          <div>
            <div className="flex items-center gap-1.5">
              {vs.length > 0 && (
                <button
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="text-stone-400 hover:text-stone-700"
                  aria-label={open ? 'Hide sizes' : 'Show sizes'}
                >
                  {open ? '▾' : '▸'}
                </button>
              )}
              <span className="font-medium text-stone-800">{r.name}</span>
            </div>
            {open && vs.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {vs.map((v) => {
                  const vd = v.expiry_date ? String(v.expiry_date).slice(0, 10) : null;
                  return (
                    <div key={v.id} className="flex items-center gap-2 text-xs text-stone-500 bg-cream/60 rounded px-2 py-1">
                      <span className="font-medium text-stone-700">{v.name}</span>
                      <span className="tabular-nums">stock {formatQty(v.stock)}</span>
                      <span className="tabular-nums">min {formatQty(v.min_stock)}</span>
                      {vd && (
                        <span className={vd < today ? 'text-red-600' : vd <= in30 ? 'text-amber-600' : ''}>exp {vd}</span>
                      )}
                      {v.batch_no && <span>batch {v.batch_no}</span>}
                      {!v.active && <span className="text-stone-400">disabled</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      },
    },
    { key: 'category_name', label: 'Category', render: (r) => r.category_name || '—' },
    { key: 'stock', label: 'Current Stock', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatQty(r.stock) },
    { key: 'min_stock', label: 'Min Stock', align: 'right', className: 'tabular-nums', render: (r) => formatQty(r.min_stock) },
    {
      key: 'expiry_date',
      label: 'Expiry',
      render: (r) => {
        const dates = expiryDates(r).sort();
        if (dates.length === 0) return <span className="text-stone-400">—</span>;
        const d = dates[0];
        return <Badge tone={d < today ? 'bad' : d <= in30 ? 'warn' : 'muted'}>{d}</Badge>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        Number(r.stock) <= 0 ? (
          <Badge tone="bad">Out</Badge>
        ) : Number(r.stock) <= Number(r.min_stock) ? (
          <Badge tone="warn">Low</Badge>
        ) : (
          <Badge tone="ok">OK</Badge>
        ),
    },
    { key: 'cost', label: 'Unit Cost', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(r.cost, currency) },
    { key: 'value', label: 'Value', align: 'right', className: 'tabular-nums', render: (r) => formatMoney(Number(r.stock) * Number(r.cost), currency) },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          <button onClick={() => openAdjust(r)} className="px-2 py-1 rounded text-xs font-medium border border-stone-300 text-stone-600 hover:bg-cream">
            Adjust
          </button>
          <button onClick={() => openHistory(r)} className="px-2 py-1 rounded text-xs font-medium border border-stone-300 text-stone-600 hover:bg-cream">
            History
          </button>
        </div>
      ),
    },
  ];

  const adjustVariant = (adjust?.variants || []).find((v) => String(v.id) === String(adjustVariantId));
  const adjustStock = adjustVariant ? adjustVariant.stock : adjust?.stock ?? 0;

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader title="Inventory" sub="Stock levels, adjustments and movement history" />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-line rounded-lg p-4">
          <div className="text-xs font-medium text-stone-500">Stock value (cost)</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(stockValue, currency)}</div>
        </div>
        <div className="bg-white border border-line rounded-lg p-4">
          <div className="text-xs font-medium text-stone-500">Low stock</div>
          <div className={`mt-1 text-lg font-semibold ${lowCount > 0 ? 'text-amber-700' : ''}`}>{lowCount}</div>
        </div>
        <div className="bg-white border border-line rounded-lg p-4">
          <div className="text-xs font-medium text-stone-500">Out of stock</div>
          <div className={`mt-1 text-lg font-semibold ${outCount > 0 ? 'text-red-700' : ''}`}>{outCount}</div>
        </div>
        <div className="bg-white border border-line rounded-lg p-4">
          <div className="text-xs font-medium text-stone-500">Expired products</div>
          <div className={`mt-1 text-lg font-semibold ${expiredCount > 0 ? 'text-red-700' : ''}`}>{expiredCount}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs font-medium text-stone-600">Show</label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        >
          <option value="all">All products</option>
          <option value="out">Out of stock</option>
          <option value="low">Low stock</option>
          <option value="expired">Expired</option>
          <option value="expiring">Expiring within 30 days</option>
        </select>
      </div>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !products ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={visible} empty="No products match this filter." />
        )}
      </div>

      {adjust && (
        <Modal
          title={`Adjust Stock: ${adjust.name}`}
          onClose={() => { setAdjust(null); setAdjustVariantId(''); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdjust(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={saveAdjust}>
                Apply Adjustment
              </Button>
            </>
          }
        >
          <form onSubmit={saveAdjust} className="space-y-3.5">
            {(adjust.variants || []).length > 0 && (
              <Select label="Size" value={adjustVariantId} onChange={(e) => setAdjustVariantId(e.target.value)}>
                <option value="">Select size…</option>
                {(adjust.variants || []).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            )}
            <div className="text-sm text-stone-600">
              Previous stock: <span className="font-semibold">{formatQty(adjustStock)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="increase">Increase (+)</option>
                <option value="decrease">Decrease (−)</option>
              </Select>
              <Input label="Quantity" type="number" min="0.5" step="0.5" value={delta} onChange={(e) => setDelta(e.target.value)} required placeholder="0" />
            </div>
            {delta && Number(delta) > 0 && (
              <div className="text-sm text-stone-600">
                Resulting stock: <span className="font-semibold">{formatQty(Number(adjustStock) + (direction === 'increase' ? Number(delta) : -Number(delta)))}</span>
              </div>
            )}
            <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. damaged, count correction" maxLength={160} />
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}

      {history && (
        <Modal
          title={`Stock History: ${history.product.name}`}
          onClose={() => setHistory(null)}
          wide
          footer={<Button variant="secondary" onClick={() => setHistory(null)}>Close</Button>}
        >
          {!history.movements ? (
            <Loading />
          ) : history.movements.length === 0 ? (
            <div className="py-8 text-center text-sm text-stone-400">No movements recorded.</div>
          ) : (
            <ul className="divide-y divide-line/80 max-h-80 overflow-y-auto">
              {resultingStocks(history.movements, history.product.stock).map((m) => (
                <li key={m.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className={`w-14 text-right text-sm font-semibold tabular-nums ${
                      Number(m.change) >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {Number(m.change) >= 0 ? '+' : ''}
                    {formatQty(m.change)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-stone-800 capitalize">
                      {m.reason}
                      {m.note ? ` — ${m.note}` : ''}
                    </div>
                    <div className="text-xs text-stone-500">
                      {formatDate(m.created_at, tz)} · {formatTime(m.created_at, tz)}
                      {m.user_name ? ` · ${m.user_name}` : ''}
                    </div>
                  </div>
                  <span
                    className="w-16 text-right text-sm tabular-nums text-stone-600"
                    title="Stock after this movement"
                  >
                    {formatQty(m.resulting)}
                  </span>
                </li>
              ))}
              <li className="pt-2 text-[11px] text-stone-400">Right column: stock after each movement (newest first).</li>
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}
