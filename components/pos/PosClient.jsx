'use client';
// POS: product grid + search (barcode friendly) + cart + checkout.
// Mobile: the cart becomes a bottom bar + full-screen overlay.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { formatMoney, formatQty, round2, storeDateStr } from '@/lib/format';
import { PRICING_MODES, PRICING_MODE_LABELS, priceForMode, minForMode } from '@/lib/pricing';
import { useToast } from '@/components/Toast';
import { useSyncStatus, SyncPill } from '@/components/SyncStatus';
import { Badge, Button, ErrorBox, Loading, Modal, Field, Input } from '@/components/ui';
import { IconLogout, IconMinus, IconPlus, IconSearch, IconTrash } from '@/components/icons';

const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
];

// Cards mounted per "page" of the product grid. Chosen so the whole first
// screen plus a little scroll is already there, while a large catalogue does
// not put thousands of DOM nodes in the tree.
const GRID_PAGE = 60;

export default function PosClient({ user, settings, priceLimits = null }) {
  const router = useRouter();
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const { status: syncStatus, lastSync, withStatus } = useSyncStatus();

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [myShift, setMyShift] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cart, setCart] = useState([]); // { key, id, name, variant, price, stock, qty, mode }
  // Which cart line the pricing-mode control applies to (set on add, on tap).
  const [selectedKey, setSelectedKey] = useState(null);
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState('cash');
  const [paid, setPaid] = useState('');
  const [customerId, setCustomerId] = useState(''); // '' = walk-in
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [tableNo, setTableNo] = useState(''); // '' = no table (walk-in/bar)
  const [notes, setNotes] = useState(''); // kitchen/order notes
  const [variantProduct, setVariantProduct] = useState(null); // product awaiting size pick
  const [submitting, setSubmitting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [shiftModal, setShiftModal] = useState(null); // 'open' | 'close'
  const [shiftSummary, setShiftSummary] = useState(null); // lazy close-modal figures
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [shiftSubmitting, setShiftSubmitting] = useState(false);
  const [closeResult, setCloseResult] = useState(null);
  // How many product cards are actually mounted. The catalogue can hold
  // thousands of items; mounting every card on each keystroke is the single
  // most expensive thing the POS screen does. Search and the category filter
  // still cover the WHOLE catalogue — this only limits how many cards are in
  // the DOM at once, and the true total is always shown.
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const searchRef = useRef(null);

  const can = useCallback(
    (perm) => user.role === 'admin' || (user.permissions || []).includes(perm),
    [user]
  );

  const load = useCallback(
    async (fresh = false) => {
      await withStatus(async () => {
        const [p, c, cu, sh] = await Promise.all([
          // view=pos: the POS projection (no cost / stock value / category
          // name / purchasing fields) — same rows, same order, fewer bytes.
          api('/api/products?view=pos', { fresh }),
          api('/api/categories', { fresh }),
          api('/api/customers?view=pos', { fresh }).catch(() => ({ customers: [] })),
          api('/api/shifts', { fresh }).catch(() => ({ shifts: [] })),
        ]);
      setProducts(p.products);
      setCategories(c.categories);
      setCustomers(cu.customers);
      const openShift = (sh.shifts || []).find(
        (s) => s.status === 'open' && Number(s.cashier_id) === Number(user.id)
      );
      setMyShift(openShift || null);
    });
  }, [withStatus, user.id]);

  useEffect(() => {
    load().catch(() => {}); // mount: use short cache if data is fresh
    const t = setInterval(() => load(true).catch(() => {}), 30000); // poll: always fresh
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!categoryId || String(p.category_id) === categoryId) &&
        (!q || p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q)))
    );
  }, [products, search, categoryId]);

  // Reset the render window when the filter changes, then slice it. Both are
  // cheap compared to mounting the cards themselves.
  useEffect(() => {
    setVisibleCount(GRID_PAGE);
  }, [search, categoryId]);
  const visibleProducts = useMemo(
    () => (filtered.length > visibleCount ? filtered.slice(0, visibleCount) : filtered),
    [filtered, visibleCount]
  );

  // "Today" in the STORE timezone — must match the server's expiry check
  // (which also uses the store timezone), whatever the machine clock says.
  const today = storeDateStr(settings?.timezone);
  const isExpired = useCallback((p) => Boolean(p.expiry_date) && String(p.expiry_date).slice(0, 10) < today, [today]);
  const isVariantExpired = useCallback(
    (v) => Boolean(v?.expiry_date) && String(v.expiry_date).slice(0, 10) < today,
    [today]
  );
  // Id -> product index. The cart re-derives every line's price and minimum
  // on each render, so a linear `products.find` per line turned a keystroke
  // into O(cart x catalogue) work. The map is rebuilt only when the
  // catalogue itself changes.
  const productById = useMemo(() => {
    const m = new Map();
    for (const p of products || []) m.set(p.id, p);
    return m;
  }, [products]);

  // The product/size row behind a cart line (for price derivation).
  const lineSource = useCallback(
    (item) => {
      const p = productById.get(item.id);
      if (!p) return null;
      if (item.variantId) return (p.variants || []).find((x) => x.id === item.variantId) || null;
      return p;
    },
    [productById]
  );

  // Live unit price of a cart line: its OWN pricing mode (default retail),
  // always derived from the latest loaded data — no requests. Changing a
  // line's mode only re-renders; the server re-derives the same price
  // authoritatively at sale time.
  const lineUnitPrice = useCallback(
    (item) => {
      const row = lineSource(item);
      return row ? priceForMode(row, item.mode || 'retail') : item.price;
    },
    [lineSource]
  );

  // The cashier's minimum for a mode (admin-configured, if any).
  const limitFor = (m) =>
    priceLimits && priceLimits[m] !== undefined && priceLimits[m] !== null
      ? Number(priceLimits[m])
      : null;

  // The product/variant minimum selling price for a cart line's mode
  // (admin-configured per product/variant + mode, ON/OFF). null = not set
  // or protection OFF at both levels.
  const itemMinFor = (item, m) => {
    if (!item) return null;
    const p = productById.get(item.id);
    if (!p) return null;
    let min = minForMode(p, m);
    if (item.variantId) {
      const v = (p.variants || []).find((x) => x.id === item.variantId);
      if (v) {
        const vm = minForMode(v, m);
        if (vm !== null) min = min === null ? vm : Math.max(min, vm);
      }
    }
    return min;
  };

  // Effective minimum for a mode: the stricter of the cashier's user-level
  // limit and the product/variant minimum (never weakens either). Pass the
  // cart line to include the product/variant level; omit it for the
  // user-level limit only.
  const effectiveMinFor = (m, item = null) => {
    const userMin = limitFor(m);
    const itemMin = item ? itemMinFor(item, m) : null;
    if (userMin !== null && itemMin !== null) return Math.max(userMin, itemMin);
    return userMin !== null ? userMin : itemMin;
  };

  // Apply a pricing mode to the SELECTED cart line only (unambiguous:
  // each line keeps its own mode). Blocked when it would drop the line
  // below this cashier's minimum for that mode (server re-enforces).
  function applyModeToSelected(m) {
    const row = cart.find((i) => i.key === selectedKey);
    if (!row) return;
    const src = lineSource(row);
    if (!src) return;
    const price = priceForMode(src, m);
    const userMin = limitFor(m);
    const itemMin = itemMinFor(row, m);
    const lim = userMin !== null && itemMin !== null ? Math.max(userMin, itemMin) : userMin !== null ? userMin : itemMin;
    if (lim !== null && price < lim - 0.001) {
      const itemBinding = itemMin !== null && itemMin >= (userMin ?? -1);
      toast(
        itemBinding
          ? `"${row.name}${row.variant ? ` (${row.variant.name})` : ''}" — minimum selling price for this item is ${formatMoney(itemMin, currency)}. ${PRICING_MODE_LABELS[m]} is ${formatMoney(price, currency)}.`
          : `"${row.name}${row.variant ? ` (${row.variant.name})` : ''}" at ${PRICING_MODE_LABELS[m].toLowerCase()} (${formatMoney(price, currency)}) is below your minimum allowed price (${formatMoney(userMin, currency)}).`,
        'error'
      );
      return;
    }
    setCart((prev) => prev.map((i) => (i.key === row.key ? { ...i, mode: m } : i)));
  }

  // Cart lines are keyed by product + size, so the same product with
  // different sizes stays on separate lines. Each size has its own stock;
  // a product without sizes uses the product stock.
  function addToCart(p, variant = null) {
    if (isExpired(p)) {
      toast(`"${p.name}" is expired (${String(p.expiry_date).slice(0, 10)}). Remove or adjust stock in Inventory.`, 'error');
      return;
    }
    const stock = variant ? Number(variant.stock) : Number(p.stock);
    if (variant) {
      if (!variant.active) {
        toast(`"${p.name}" size "${variant.name}" is disabled.`, 'error');
        return;
      }
      if (isVariantExpired(variant)) {
        toast(`"${p.name} (${variant.name})" is expired (${String(variant.expiry_date).slice(0, 10)}). Adjust it in Inventory.`, 'error');
        return;
      }
    }
    const key = variant ? `${p.id}::${variant.name}` : String(p.id);
    // Lines start in retail mode; the cashier picks another mode per line
    // from the cart (Walk-in Customer / Table area).
    const price = variant ? priceForMode(variant, 'retail') : priceForMode(p, 'retail');
    // Instant feedback on the effective retail minimum (the stricter of
    // the cashier limit and the product/variant minimum; the server
    // re-enforces both authoritatively at sale time).
    const lineRef = { id: p.id, variantId: variant ? variant.id : null };
    const retailLimit = effectiveMinFor('retail', lineRef);
    const retailItemMin = itemMinFor(lineRef, 'retail');
    if (retailLimit !== null && price < retailLimit - 0.001) {
      const itemBinding = retailItemMin !== null && retailItemMin >= (limitFor('retail') ?? -1);
      toast(
        itemBinding
          ? `"${p.name}"${variant ? ` (${variant.name})` : ''}" — minimum selling price for this item is ${formatMoney(retailItemMin, currency)}.`
          : `"${p.name}"${variant ? ` (${variant.name})` : ''} at retail (${formatMoney(price, currency)}) is below your minimum allowed price (${formatMoney(retailLimit, currency)}).`,
        'error'
      );
      return;
    }
    setCart((prev) => {
      if (variant) {
        const usedOfVariant = prev.filter((i) => i.key === key).reduce((s, i) => s + i.qty, 0);
        if (usedOfVariant + 1 > stock) {
          toast(`"${p.name}" size "${variant.name}" is out of stock.`, 'error');
          return prev;
        }
      } else {
        const usedOfProduct = prev.filter((i) => i.id === p.id).reduce((s, i) => s + i.qty, 0);
        if (usedOfProduct + 1 > stock) {
          toast(`${p.name} is out of stock.`, 'error');
          return prev;
        }
      }
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i));
      }
      return [
        ...prev,
        { key, id: p.id, variantId: variant ? variant.id : null, name: p.name, variant, price, stock, qty: 1, mode: 'retail' },
      ];
    });
    // The just-added line becomes the selected one, so the pricing-mode
    // control in the cart acts on the item the cashier just picked.
    setSelectedKey(key);
  }

  function setQty(key, qty) {
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n <= 0) return removeItem(key);
    setCart((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        if (i.variantId) {
          // Each size has its own stock level.
          const maxQty = Math.max(0, Math.floor(i.stock));
          return { ...i, qty: Math.min(n, maxQty || n) };
        }
        // Lines of a plain product share its stock.
        const others = prev.filter((x) => x.id === i.id && x.key !== key).reduce((s, x) => s + x.qty, 0);
        const maxQty = Math.max(0, Math.floor(i.stock) - others);
        const next = Math.min(n, maxQty || n);
        return { ...i, qty: next };
      })
    );
  }

  function removeItem(key) {
    setCart((prev) => prev.filter((i) => i.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  }

  function clearCart() {
    setCart([]);
    setSelectedKey(null);
    setDiscount('');
    setPaid('');
    setCustomerId('');
    setWalkInName('');
    setWalkInPhone('');
    setTableNo('');
    setNotes('');
  }

  // Barcode scanners "type" the code and press Enter.
  function onSearchKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.trim();
    // A size barcode adds that exact size straight to the cart.
    const exactVariant = q
      ? filtered.flatMap((p) => (p.variants || []).map((v) => ({ p, v }))).find(({ v }) => v.barcode && v.barcode === q)
      : null;
    if (exactVariant) {
      addToCart(exactVariant.p, exactVariant.v);
      setSearch('');
      return;
    }
    const exact = q
      ? filtered.find((p) => (p.barcode && p.barcode === q) || p.name.toLowerCase() === q.toLowerCase())
      : null;
    const target = exact || (filtered.length === 1 ? filtered[0] : null);
    if (target) {
      if (Array.isArray(target.variants) && target.variants.length > 0) {
        setVariantProduct(target); // sized product: pick the size first
      } else {
        addToCart(target);
      }
      setSearch('');
    } else if (filtered.length > 1) {
      toast('Multiple products match. Select one from the grid.', 'error');
    }
  }

  const subtotal = round2(cart.reduce((s, i) => s + lineUnitPrice(i) * i.qty, 0));
  const discountNum = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = round2(subtotal - discountNum);
  const paidNum = Number(paid) || 0;
  const change = round2(paidNum - total);
  const credit = round2(Math.max(total - paidNum, 0));
  const selectedCustomer = customers.find((c) => String(c.id) === customerId) || null;
  const canCheckout =
    cart.length > 0 &&
    !submitting &&
    (paidNum >= total || (credit > 0 && selectedCustomer && can('customer_credit')));

  async function checkout() {
    if (submitting) return;
    if (paidNum < total) {
      if (!selectedCustomer) {
        toast('Select a customer to record the balance as credit.', 'error');
        return;
      }
      if (!can('customer_credit')) {
        toast('You do not have permission to make credit sales.', 'error');
        return;
      }
    }
    // Minimum-price pre-check per line's mode: the effective minimum
    // (the stricter of the cashier limit and the product/variant minimum).
    // The server re-validates authoritatively — this is instant feedback,
    // not the gate.
    const hasHardMin = cart.some((i) => effectiveMinFor(i.mode || 'retail', i) !== null);
    if (hasHardMin) {
      for (const i of cart) {
        const lim = effectiveMinFor(i.mode || 'retail', i);
        if (lim === null) continue;
        const up = lineUnitPrice(i);
        if (up < lim - 0.001) {
          const itemMin = itemMinFor(i, i.mode || 'retail');
          const itemBinding = itemMin !== null && itemMin >= (limitFor(i.mode || 'retail') ?? -1);
          toast(
            itemBinding
              ? `"${i.name}${i.variant ? ` (${i.variant.name})` : ''}" — minimum selling price for this item is ${formatMoney(itemMin, currency)}.`
              : `"${i.name}${i.variant ? ` (${i.variant.name})` : ''}" at ${PRICING_MODE_LABELS[i.mode || 'retail'].toLowerCase()} (${formatMoney(up, currency)}) is below your minimum allowed price (${formatMoney(lim, currency)}).`,
            'error'
          );
          return;
        }
      }
      const floorTotal = cart.reduce((s, i) => {
        const lim = effectiveMinFor(i.mode || 'retail', i);
        const up = lineUnitPrice(i);
        return s + (lim === null ? up : Math.max(up, lim)) * i.qty;
      }, 0);
      if (discountNum > subtotal - floorTotal + 0.001) {
        toast('The discount would take a line below its minimum allowed price for its mode.', 'error');
        return;
      }
    }
    setSubmitting(true);
    try {
      const data = await api('/api/sales', {
        method: 'POST',
        body: {
          items: cart.map((i) => ({
            productId: i.id,
            qty: i.qty,
            variantId: i.variantId || null,
            variant: i.variant ? i.variant.name : null,
            mode: i.mode || 'retail',
          })),
          discount: discountNum,
          paymentMethod: method,
          paid: paidNum,
          customerId: customerId ? Number(customerId) : null,
          customerName: customerId ? '' : walkInName,
          customerPhone: customerId ? '' : walkInPhone,
          tableNo: tableNo.trim() || null,
          notes: notes.trim(),
        },
      });
      clearCart();
      setMethod('cash');
      setCartOpen(false);
      router.push(`/sales/${data.id}`);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      toast(err.message, 'error');
      load().catch(() => {}); // refresh stock/prices
    } finally {
      setSubmitting(false);
    }
  }

  // ---- shift ----
  async function openShift() {
    if (shiftSubmitting) return;
    setShiftSubmitting(true);
    try {
      await api('/api/shifts', { method: 'POST', body: { openingCash: Number(openingCash) || 0 } });
      setShiftModal(null);
      setOpeningCash('');
      toast('Shift opened.');
      load().catch(() => {});
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setShiftSubmitting(false);
    }
  }

  // Open the close-shift modal and lazily fetch the real shift summary
  // (cash sales so far) on demand instead of keeping the sales list alive
  // on the POS screen. The close transaction stays authoritative.
  function openShiftClose() {
    setShiftModal('close');
    setShiftSummary(null);
    setSummaryBusy(true);
    api(`/api/shifts/${myShift.id}`)
      .then((d) => setShiftSummary(d.summary))
      .catch(() => setShiftSummary(null))
      .finally(() => setSummaryBusy(false));
  }

  async function closeShift() {
    if (shiftSubmitting) return;
    setShiftSubmitting(true);
    try {
      const data = await api(`/api/shifts/${myShift.id}`, {
        method: 'POST',
        body: { closingCash: Number(closingCash) || 0 },
      });
      setCloseResult({ ...data.closing, summary: data.summary });
      setClosingCash('');
      load().catch(() => {});
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setShiftSubmitting(false);
    }
  }

  function downloadShiftCsv() {
    if (!closeResult || !myShift) return;
    const { summary } = closeResult;
    const rows = [
      ['Field', 'Value'],
      ['Cashier', user.full_name || user.username],
      ['Shift ID', myShift.id],
      ['Opened', new Date(myShift.opened_at).toLocaleString()],
      ['Closed', new Date(closeResult.closedAt).toLocaleString()],
      ['Sales count', summary.sales.count],
      ['Total sales', summary.sales.total],
      ['Cash sales', summary.sales.cash],
      ['Card sales', summary.sales.card],
      ['Other sales', summary.sales.other],
      ['Opening cash', myShift.opening_cash],
      ['Expected cash', closeResult.expectedCash],
      ['Counted cash', closeResult.countedCash],
      ['Difference', closeResult.difference],
      ['Expenses in shift', summary.expenses.reduce((s, e) => s + Number(e.amount), 0)],
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shift_${myShift.id}_close.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function quickAddCustomer() {
    if (!newCustomer.name.trim()) {
      toast('Enter the customer name.', 'error');
      return;
    }
    setShiftSubmitting(true);
    try {
      const d = await api('/api/customers', {
        method: 'POST',
        body: { name: newCustomer.name, phone: newCustomer.phone },
      });
      setShowAddCustomer(false);
      setNewCustomer({ name: '', phone: '' });
      toast('Customer added.');
      load().catch(() => {});
      setCustomerId(String(d.id));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setShiftSubmitting(false);
    }
  }

  const cartPanelProps = {
    cart,
    lineUnitPrice,
    selectedKey,
    onSelectLine: (key) => setSelectedKey(key),
    onSelectMode: applyModeToSelected,
    limitForMode: limitFor,
    setQty,
    removeItem,
    clearCart,
    currency,
    subtotal,
    total,
    discount,
    setDiscount,
    canDiscount: can('discount'),
    method,
    setMethod,
    paid,
    setPaid,
    change,
    credit,
    paidNum,
    customers,
    customerId,
    setCustomerId,
    selectedCustomer,
    canCredit: can('customer_credit'),
    walkInName,
    setWalkInName,
    walkInPhone,
    setWalkInPhone,
    tableNo,
    setTableNo,
    notes,
    setNotes,
    canManageCustomers: can('customer_management'),
    onAddCustomer: () => setShowAddCustomer(true),
    canCheckout,
    submitting,
    onCheckout: checkout,
  };

  const cartPanel = <CartPanel showHeader {...cartPanelProps} />;

  return (
    <div className="h-dvh flex bg-cream">
      {/* Left: products */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-line flex items-center gap-3 px-4 shrink-0">
          {settings?.has_logo && (
            <img
              src="/api/settings/logo"
              alt={settings?.business_name || 'Logo'}
              className="w-8 h-8 rounded-md object-contain bg-cream border border-line shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-stone-900 leading-tight">Point of Sale</h1>
            {settings?.business_name && <div className="text-[11px] text-stone-400 truncate">{settings.business_name}</div>}
          </div>
          <div className="flex-1" />
          <SyncPill status={syncStatus} lastSync={lastSync} />
          <ShiftChip shift={myShift} currency={currency} onClick={() => (myShift ? openShiftClose() : setShiftModal('open'))} />
          <span className="text-xs text-stone-500 hidden lg:block">{user.full_name || user.username}</span>
          <button
            onClick={async () => {
              try {
                await api('/api/auth/logout', { method: 'POST' });
              } catch {
                // ignore
              }
              window.location.href = '/login';
            }}
            className="flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-cream"
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </header>

        <div className="bg-white border-b border-line px-4 py-3 space-y-3 shrink-0">
          <div className="relative">
            <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search product or scan barcode"
              className="w-full pl-9 pr-3 py-2.5 rounded-md border border-stone-300 bg-cream/60 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15 focus:border-stone-500"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <CategoryChip active={!categoryId} onClick={() => setCategoryId('')} label="All" />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                active={String(c.id) === categoryId}
                onClick={() => setCategoryId(String(c.id))}
                label={c.name}
              />
            ))}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          {loadError && products === null ? (
            <ErrorBox message={loadError} onRetry={() => load().catch(() => {})} />
          ) : !products ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-stone-400">No products found.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {visibleProducts.map((p) => {
                const stock = Number(p.stock);
                const out = stock <= 0;
                const expired = isExpired(p);
                const variants = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v.active);
                const hasVariants = variants.length > 0;
                const fromPrice = hasVariants
                  ? Math.min(...variants.map((v) => priceForMode(v, 'retail')))
                  : priceForMode(p, 'retail');
                const expiringSoon =
                  !expired &&
                  p.expiry_date &&
                  daysUntil(String(p.expiry_date).slice(0, 10), today) <= 30;
                return (
                  <button
                    key={p.id}
                    onClick={() => (hasVariants ? setVariantProduct(p) : addToCart(p))}
                    disabled={out || expired}
                    className="text-left bg-white border border-line rounded-lg p-3 hover:border-stone-400 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {(p.has_image || (hasVariants && variants.some((v) => v.has_image))) && (
                      <img
                        src={
                          p.has_image
                            ? `/api/products/${p.id}/image`
                            : `/api/products/${p.id}/variants/${variants.find((v) => v.has_image).id}/image`
                        }
                        alt=""
                        loading="lazy"
                        className="w-full h-20 object-cover rounded-md mb-2"
                      />
                    )}
                    <div className="text-sm font-medium text-stone-800 leading-snug line-clamp-2 min-h-[2.5rem]">
                      {p.name}
                    </div>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span className="font-semibold text-stone-900 text-sm">
                        {hasVariants ? `from ${formatMoney(fromPrice, currency)}` : formatMoney(priceForMode(p, 'retail'), currency)}
                        {hasVariants && (
                          <span className="ml-1.5 text-[10px] font-medium text-stone-400">
                            {variants.length} sizes
                          </span>
                        )}
                      </span>
                      {expired ? (
                        <Badge tone="bad">Expired</Badge>
                      ) : (
                        <Badge tone={out ? 'bad' : stock <= Number(p.min_stock) ? 'warn' : 'muted'}>
                          {out ? 'Out' : `${formatQty(stock)} left`}
                        </Badge>
                      )}
                    </div>
                    {expiringSoon && (
                      <div className="mt-1.5">
                        <Badge tone="warn">Expires {String(p.expiry_date).slice(0, 10)}</Badge>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {products && filtered.length > 0 && (
            <div className="px-1 pt-3 pb-1 text-center">
              <div className="text-xs text-stone-400">
                Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
                {filtered.length !== (products || []).length && ` (catalogue: ${(products || []).length})`}
              </div>
              {filtered.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((n) => n + GRID_PAGE)}
                  className="mt-2 px-4 py-2 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700 hover:bg-cream/70"
                >
                  Show {Math.min(GRID_PAGE, filtered.length - visibleCount)} more
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Right: cart (desktop) */}
      <aside className="hidden md:flex w-[340px] xl:w-[400px] shrink-0 bg-white border-l border-line flex-col">{cartPanel}</aside>

      {/* Mobile: bottom bar + cart overlay */}
      {cart.length > 0 && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold text-stone-900">{formatMoney(total, currency)}</span>
            <span className="text-stone-500"> · {cart.reduce((s, i) => s + i.qty, 0)} items</span>
          </div>
          <Button onClick={() => setCartOpen(true)}>View cart</Button>
        </div>
      )}
      {cartOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-stone-900/40">
          <div className="absolute inset-x-0 bottom-0 top-14 bg-white flex flex-col rounded-t-xl">
            <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-semibold">Current Sale</h2>
              <button onClick={() => setCartOpen(false)} className="text-xs font-medium text-stone-600">
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col">
              <CartPanel {...cartPanelProps} showHeader={false} />
            </div>
          </div>
        </div>
      )}

      {/* Open shift */}
      {shiftModal === 'open' && (
        <Modal title="Open shift" onClose={() => setShiftModal(null)} footer={
          <>
            <Button variant="secondary" onClick={() => setShiftModal(null)}>Cancel</Button>
            <Button loading={shiftSubmitting} onClick={openShift}>Open shift</Button>
          </>
        }>
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Count the cash in the drawer before starting, then enter it here. The shift is used to reconcile cash at the end.
            </p>
            <Input
              label={`Opening cash (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </Modal>
      )}

      {/* Close shift */}
      {shiftModal === 'close' && myShift && (
        <Modal
          title={closeResult ? 'Shift closed' : 'Close shift'}
          onClose={() => {
            setShiftModal(null);
            setCloseResult(null);
          }}
          footer={
            closeResult ? (
              <>
                <Button variant="secondary" onClick={downloadShiftCsv}>Download report (CSV)</Button>
                <Button
                  onClick={() => {
                    setShiftModal(null);
                    setCloseResult(null);
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setShiftModal(null)}>Cancel</Button>
                <Button loading={shiftSubmitting} onClick={closeShift}>Close shift</Button>
              </>
            )
          }
        >
          {closeResult ? (
            <div className="space-y-2 text-sm">
              <ResultRow label="Expected cash" value={formatMoney(closeResult.expectedCash, currency)} />
              <ResultRow label="Counted cash" value={formatMoney(closeResult.countedCash, currency)} />
              <ResultRow
                label="Difference"
                value={formatMoney(closeResult.difference, currency)}
                tone={
                  Math.abs(closeResult.difference) < 0.01
                    ? 'ok'
                    : closeResult.difference < 0
                      ? 'bad'
                      : 'warn'
                }
              />
              <ResultRow
                label="Sales in shift"
                value={`${closeResult.summary.sales.count} · ${formatMoney(closeResult.summary.sales.total, currency)}`}
              />
              <ResultRow
                label="Expenses in shift"
                value={formatMoney(
                  closeResult.summary.expenses.reduce((s, e) => s + Number(e.amount), 0),
                  currency
                )}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5 text-sm bg-cream/70 rounded-md p-3">
                <ResultRow label="Opening cash" value={formatMoney(myShift.opening_cash, currency)} />
                <ResultRow
                  label="Cash sales so far"
                  value={
                    summaryBusy
                      ? '…'
                      : shiftSummary
                        ? formatMoney(shiftSummary.sales.cash, currency)
                        : '—'
                  }
                  hint={
                    shiftSummary
                      ? 'Server figure for this shift; recomputed at close'
                      : 'The exact figure is computed by the server at close'
                  }
                />
                <ResultRow
                  label="Expected at close"
                  value={
                    summaryBusy
                      ? '…'
                      : shiftSummary
                        ? formatMoney(
                            round2(Number(myShift.opening_cash) + Number(shiftSummary.sales.cash)),
                            currency
                          )
                        : '—'
                  }
                />
              </div>
              <Input
                label={`Counted cash (${currency})`}
                type="number"
                min="0"
                step="0.01"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder="0.00"
                hint="Count the drawer now. The exact expected amount is calculated from the sales recorded during the shift."
              />
            </div>
          )}
        </Modal>
      )}

      {/* Size/variant picker (only for products with configured sizes) */}
      {variantProduct && (
        <Modal
          title={variantProduct.name}
          onClose={() => setVariantProduct(null)}
          footer={
            <Button variant="secondary" onClick={() => setVariantProduct(null)}>
              Cancel
            </Button>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-stone-600">Choose a size. Each size has its own price and stock.</p>
            <div className="grid grid-cols-2 gap-2">
              {(variantProduct.variants || []).filter((v) => v.active).map((v) => {
                const vStock = Number(v.stock);
                const vExpired = isVariantExpired(v);
                const disabled = vStock <= 0 || vExpired;
                const price = priceForMode(v, 'retail');
                const hasDiscount = Number(v.discount_pct) > 0;
                return (
                  <button
                    key={v.id || v.name}
                    disabled={disabled}
                    onClick={() => {
                      addToCart(variantProduct, v);
                      setVariantProduct(null);
                    }}
                    className="rounded-md border border-stone-300 bg-white px-3 py-2.5 text-left hover:border-stone-500 hover:bg-cream disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <div className="text-sm font-medium text-stone-800 break-words">{v.name}</div>
                    <div className="text-xs text-stone-500 tabular-nums">
                      {hasDiscount && (
                        <span className="line-through text-stone-400 mr-1.5">
                          {formatMoney(Number(v.price), currency)}
                        </span>
                      )}
                      {formatMoney(price, currency)}
                    </div>
                    <div className={`text-[11px] mt-1 ${vExpired ? 'text-red-600' : vStock <= 0 ? 'text-red-500' : 'text-stone-400'}`}>
                      {vExpired
                        ? `Expired ${String(v.expiry_date).slice(0, 10)}`
                        : vStock <= 0
                          ? 'Out of stock'
                          : `${formatQty(vStock)} in stock`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* Quick add customer */}
      {showAddCustomer && (
        <Modal title="New customer" onClose={() => setShowAddCustomer(false)} footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddCustomer(false)}>Cancel</Button>
            <Button loading={shiftSubmitting} onClick={quickAddCustomer}>Save customer</Button>
          </>
        }>
          <div className="space-y-3">
            <Input
              label="Name"
              value={newCustomer.name}
              onChange={(e) => setNewCustomer((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Ahmed Traders"
            />
            <Input
              label="Phone (optional)"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer((v) => ({ ...v, phone: e.target.value }))}
              placeholder="e.g. 0300-1234567"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResultRow({ label, value, tone, hint }) {
  const cls =
    tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-stone-800';
  return (
    <div>
      <div className="flex justify-between">
        <span className="text-stone-600">{label}</span>
        <span className={`font-semibold tabular-nums ${cls}`}>{value ?? '—'}</span>
      </div>
      {hint && <div className="text-[11px] text-stone-400">{hint}</div>}
    </div>
  );
}

function daysUntil(dateStr, todayStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date(todayStr + 'T00:00:00');
  return Math.round((d - now) / 86400000);
}

function ShiftChip({ shift, currency, onClick }) {
  if (!shift) {
    return (
      <button
        onClick={onClick}
        title="Open a shift to reconcile cash at the end of your session"
        className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dashed border-stone-300 px-2.5 py-0.5 text-[11px] font-medium text-stone-500 hover:bg-cream"
      >
        Open shift
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={`Shift since ${new Date(shift.opened_at).toLocaleTimeString()}. Tap to close.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Shift · {formatMoney(shift.opening_cash, currency)}
    </button>
  );
}

function CartPanel(props) {
  const {
    cart, lineUnitPrice, setQty, removeItem, clearCart, currency, subtotal, total,
    selectedKey, onSelectLine, onSelectMode, limitForMode,
    discount, setDiscount, canDiscount, method, setMethod, paid, setPaid,
    change, credit, paidNum, customers, customerId, setCustomerId, selectedCustomer,
    canCredit, walkInName, setWalkInName, walkInPhone, setWalkInPhone,
    tableNo, setTableNo, notes, setNotes,
    canManageCustomers, onAddCustomer, canCheckout, submitting, onCheckout, showHeader = true,
  } = props;

  const selectedRow = cart.find((i) => i.key === selectedKey) || null;

  return (
    <>
      {showHeader && (
        <div className="px-4 py-3 border-b border-line flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-stone-900">Current Sale</h2>
          <button
            onClick={clearCart}
            disabled={cart.length === 0}
            className="text-xs text-stone-500 hover:text-stone-800 disabled:opacity-40 flex items-center gap-1"
          >
            <IconTrash className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-line/80 min-h-0">
        {cart.length === 0 ? (
          <div className="p-8 text-center text-sm text-stone-400">Cart is empty. Select products to begin.</div>
        ) : (
          cart.map((i) => {
            const selected = i.key === selectedKey;
            const lineMode = i.mode || 'retail';
            return (
            <div
              key={i.key}
              onClick={() => onSelectLine(i.key)}
              className={`px-4 py-2.5 flex items-center gap-2 cursor-pointer ${selected ? 'bg-cream/80 ring-1 ring-inset ring-stone-300' : 'hover:bg-cream/40'}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-stone-800 truncate">{i.name}</div>
                <div className="text-xs text-stone-500">
                  {i.variant ? `${i.variant.name} · ` : ''}
                  {formatMoney(lineUnitPrice(i), currency)} each
                  {lineMode !== 'retail' ? (
                    <span className="ml-1.5 text-[10px] font-semibold text-amber-700">
                      {PRICING_MODE_LABELS[lineMode]}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <QtyBtn onClick={() => setQty(i.key, i.qty - 1)} label="Decrease">
                  <IconMinus className="w-3.5 h-3.5" />
                </QtyBtn>
                <input
                  value={i.qty}
                  onChange={(e) => setQty(i.key, e.target.value)}
                  inputMode="decimal"
                  className="w-11 text-center text-sm border border-stone-300 rounded py-1 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                  aria-label={`Quantity of ${i.name}${i.variant ? ' ' + i.variant.name : ''}`}
                />
                <QtyBtn onClick={() => setQty(i.key, i.qty + 1)} disabled={i.qty >= i.stock} label="Increase">
                  <IconPlus className="w-3.5 h-3.5" />
                </QtyBtn>
              </div>
              <div className="w-[76px] text-right text-sm font-semibold tabular-nums">
                {formatMoney(lineUnitPrice(i) * i.qty, currency)}
              </div>
            </div>
            );
          })
        )}
      </div>

      <div className="border-t border-line p-4 space-y-3 bg-cream/50 shrink-0">
        {/* Pricing mode for the selected cart line (same area as the
            walk-in customer / table fields). Each line keeps its own mode. */}
        {cart.length > 0 && (
          <div className="space-y-1">
            <div role="group" aria-label="Pricing mode" className="grid grid-cols-3 gap-1">
              {PRICING_MODES.map((m) => (
                <button
                  key={m}
                  disabled={!selectedRow}
                  onClick={() => onSelectMode(m)}
                  aria-pressed={selectedRow ? selectedRow.mode === m : false}
                  title={
                    selectedRow
                      ? `${PRICING_MODE_LABELS[m]} — ${selectedRow.name}${selectedRow.variant ? ` (${selectedRow.variant.name})` : ''}`
                      : 'Select a cart line first'
                  }
                  className={`rounded-md border px-1 py-1 text-[11px] font-medium disabled:opacity-40 whitespace-nowrap ${
                    selectedRow && selectedRow.mode === m
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
                  }`}
                >
                  {PRICING_MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-[11px] text-stone-400 truncate">
                {selectedRow
                  ? `applies to: ${selectedRow.name}${selectedRow.variant ? ` (${selectedRow.variant.name})` : ''}`
                  : 'tap a line to select it'}
              </span>
              {selectedRow && limitForMode(selectedRow.mode || 'retail', selectedRow) !== null && (
                <span className="text-[11px] text-stone-400 shrink-0">
                  min {formatMoney(limitForMode(selectedRow.mode || 'retail', selectedRow), currency)}
                </span>
              )}
            </div>
          </div>
        )}
        {/* Customer */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex-1 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              aria-label="Customer"
            >
              <option value="">Walk-in customer</option>
              {customers
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {Number(c.outstanding_balance) > 0 ? ` (${formatMoney(c.outstanding_balance, currency)} due)` : ''}
                  </option>
                ))}
            </select>
            {canManageCustomers && (
              <button
                onClick={onAddCustomer}
                className="shrink-0 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-cream"
              >
                + Add
              </button>
            )}
          </div>
          {selectedCustomer && Number(selectedCustomer.outstanding_balance) > 0 && (
            <div className="text-[11px] text-amber-700">
              Current balance: {formatMoney(selectedCustomer.outstanding_balance, currency)}
            </div>
          )}
          {!customerId && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="Customer name (optional)"
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                aria-label="Customer name"
              />
              <input
                value={walkInPhone}
                onChange={(e) => setWalkInPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                aria-label="Customer phone"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={tableNo}
              onChange={(e) => setTableNo(e.target.value)}
              placeholder="Table no. (optional)"
              maxLength={20}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              aria-label="Table number"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Order notes (optional)"
              maxLength={300}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              aria-label="Order notes"
            />
          </div>
          <div className="text-[11px] text-stone-400 -mt-1">
            Table number and notes appear on the printed receipts.
          </div>
        </div>

        <div className="flex justify-between text-sm text-stone-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm shrink-0 ${canDiscount ? 'text-stone-600' : 'text-stone-400'}`}>Discount</span>
          <div className="relative w-32">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400">{currency}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              disabled={!canDiscount}
              placeholder={canDiscount ? '0.00' : 'Not allowed'}
              className="w-full rounded-md border border-stone-300 bg-white py-1.5 pl-8 pr-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-900/15 disabled:bg-cream-deep"
              aria-label="Discount"
            />
          </div>
        </div>
        {!canDiscount && <div className="text-[11px] text-stone-400 -mt-1.5">Ask an admin for the discount permission.</div>}

        <div className="flex justify-between items-baseline border-t border-dashed border-stone-300 pt-2.5">
          <span className="text-sm font-semibold text-stone-900">Grand Total</span>
          <span className="text-xl font-bold text-stone-900 tabular-nums">{formatMoney(total, currency)}</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                method === m.key
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-stone-600 shrink-0">Customer paid</span>
          <div className="flex items-center gap-1.5">
            <div className="relative w-32">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400">{currency}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-stone-300 bg-white py-1.5 pl-8 pr-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                aria-label="Customer paid"
              />
            </div>
            <button
              onClick={() => setPaid(String(total))}
              className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-600 hover:bg-cream"
            >
              Exact
            </button>
          </div>
        </div>

        {credit > 0 && paidNum > 0 ? (
          <div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-600">Credit (balance)</span>
              <span className="font-semibold tabular-nums text-amber-700">{formatMoney(credit, currency)}</span>
            </div>
            <div className="text-[11px] leading-snug text-amber-700 mt-1">
              {selectedCustomer
                ? canCredit
                  ? `Remaining ${formatMoney(credit, currency)} will be added to ${selectedCustomer.name}'s balance.`
                  : 'You do not have the credit permission — the server will reject this sale.'
                : 'Select a customer to record the remaining amount as credit.'}
            </div>
          </div>
        ) : (
          <div className="flex justify-between text-sm">
            <span className="text-stone-600">Change / Return</span>
            <span className={`font-semibold tabular-nums ${change > 0 ? 'text-emerald-700' : 'text-stone-400'}`}>
              {formatMoney(Math.max(change, 0), currency)}
            </span>
          </div>
        )}

        <Button size="lg" className="w-full" loading={submitting} disabled={!canCheckout} onClick={onCheckout}>
          {submitting ? 'Completing…' : 'Complete Sale'}
        </Button>
      </div>
    </>
  );
}

function CategoryChip({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${
        active
          ? 'bg-stone-900 text-white border-stone-900'
          : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
      }`}
    >
      {label}
    </button>
  );
}

function QtyBtn({ children, disabled, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-9 h-9 flex items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-cream disabled:opacity-40"
    >
      {children}
    </button>
  );
}
