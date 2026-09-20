'use client';
// Products: list, search, add, edit, enable/disable, photo, barcode label.
//
// Full variant level (Phase 5): a product may have sizes (variants). Each
// size is its own record — price, cost, wholesale/retail reference prices,
// tax, discount, stock, min/reorder, expiry, batch, supplier, image, status.
// The edit dialog is structured in three sections: common product info,
// base pricing (plain products), and a list of sizes with add / edit /
// duplicate / remove. Plain products (no sizes) behave exactly as before.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMoney, formatQty, storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select, Field } from '@/components/ui';
import { IconPencil, IconPlus, IconPrinter } from '@/components/icons';

const EMPTY = {
  name: '',
  barcode: '',
  categoryId: '',
  price: '',
  cost: '',
  stock: '',
  minStock: '',
  minPrice: '',
  wholesalePrice: '',
  specialPrice: '',
  minPriceEnabled: false,
  minRetail: '',
  minWholesale: '',
  minSpecial: '',
  expiryDate: '',
  active: true,
  variants: [], // [] = plain product; otherwise size form objects
};

const EMPTY_VARIANT = () => ({
  id: null,
  name: '',
  unit: '',
  sku: '',
  barcode: '',
  price: '',
  wholesalePrice: '',
  retailPrice: '',
  specialPrice: '',
  cost: '',
  taxRate: '',
  discountPct: '',
  stock: '',
  minStock: '',
  reorderLevel: '',
  minPriceEnabled: false,
  minRetail: '',
  minWholesale: '',
  minSpecial: '',
  expiryDate: '',
  batchNo: '',
  supplierId: '',
  active: true,
  imageData: null,
  clearImage: false,
  hasImage: false,
});

/** Resize an image file to a max dimension and return a JPEG data URL. */
async function fileToResizedDataUrl(file, maxDim = 480, quality = 0.82) {
  const raw = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = raw;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale === 1 && file.size <= 400 * 1024) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function variantFromRow(v) {
  return {
    id: v.id,
    name: v.name,
    unit: v.unit || '',
    sku: v.sku || '',
    barcode: v.barcode || '',
    price: String(v.price),
    wholesalePrice: Number(v.wholesale_price) ? String(v.wholesale_price) : '',
    retailPrice: Number(v.retail_price) ? String(v.retail_price) : '',
    specialPrice: Number(v.special_price) ? String(v.special_price) : '',
    cost: Number(v.cost) ? String(v.cost) : '',
    taxRate: Number(v.tax_rate) ? String(v.tax_rate) : '',
    discountPct: Number(v.discount_pct) ? String(v.discount_pct) : '',
    stock: String(v.stock),
    minStock: String(v.min_stock),
    reorderLevel: String(v.reorder_level),
    minPriceEnabled: v.min_price_enabled === true,
    minRetail: v.min_retail === null || v.min_retail === undefined ? '' : String(v.min_retail),
    minWholesale: v.min_wholesale === null || v.min_wholesale === undefined ? '' : String(v.min_wholesale),
    minSpecial: v.min_special === null || v.min_special === undefined ? '' : String(v.min_special),
    expiryDate: v.expiry_date ? String(v.expiry_date).slice(0, 10) : '',
    batchNo: v.batch_no || '',
    supplierId: v.supplier_id ? String(v.supplier_id) : '',
    active: v.active,
    imageData: null,
    clearImage: false,
    hasImage: Boolean(v.has_image),
  };
}

function numOrZero(s) {
  const n = Number(s);
  return s === '' || s === null || s === undefined || !Number.isFinite(n) ? 0 : n;
}

function variantToWire(v, idx) {
  const out = {
    name: v.name.trim(),
    price: numOrZero(v.price),
    sortOrder: idx,
    unit: v.unit.trim(),
    sku: v.sku.trim(),
    barcode: v.barcode.trim(),
    wholesalePrice: numOrZero(v.wholesalePrice),
    retailPrice: numOrZero(v.retailPrice),
    specialPrice: numOrZero(v.specialPrice),
    cost: numOrZero(v.cost),
    taxRate: numOrZero(v.taxRate),
    discountPct: numOrZero(v.discountPct),
    stock: numOrZero(v.stock),
    minStock: numOrZero(v.minStock),
    reorderLevel: numOrZero(v.reorderLevel),
    minPriceEnabled: v.minPriceEnabled === true,
    minRetail: v.minRetail === '' ? null : v.minRetail,
    minWholesale: v.minWholesale === '' ? null : v.minWholesale,
    minSpecial: v.minSpecial === '' ? null : v.minSpecial,
    expiryDate: v.expiryDate || null,
    batchNo: v.batchNo.trim(),
    supplierId: v.supplierId ? Number(v.supplierId) : null,
    active: v.active,
  };
  if (v.id) out.id = v.id;
  if (v.imageData) out.imageData = v.imageData;
  else if (v.clearImage) out.clearImage = true;
  return out;
}

export default function ProductsClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const fileRef = useRef(null);

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', product? }
  const [form, setForm] = useState(EMPTY);
  const [imageData, setImageData] = useState(null);
  const [clearImage, setClearImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelProduct, setLabelProduct] = useState(null);
  const [labelSvg, setLabelSvg] = useState(null);
  const [openVariant, setOpenVariant] = useState(null); // index of expanded size card

  // Store-timezone "today" so expiry badges match the POS/server expiry check.
  const today = storeDateStr(settings?.timezone);
  const daysUntil = (d) => Math.ceil((new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);

  const load = useCallback(async () => {
    try {
      const p = await api('/api/products');
      setProducts(p.products);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, []);
  // Category/vendor options are only needed inside the create/edit form —
  // fetch them the first time the form opens, not on every page load.
  const formMetaPromise = useRef(null);
  function loadFormMeta() {
    if (!formMetaPromise.current) {
      formMetaPromise.current = Promise.all([
        api('/api/categories').catch(() => ({ categories: [] })),
        api('/api/vendors').catch(() => ({ vendors: [] })),
      ]).then(([c, v]) => {
        setCategories(c.categories);
        setVendors(v.vendors || []);
      });
    }
    return formMetaPromise.current;
  }

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    return q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q) ||
            (p.variants || []).some((v) => v.name.toLowerCase().includes(q))
        )
      : products;
  }, [products, search]);

  function openCreate() {
    loadFormMeta();
    setForm(EMPTY);
    setImageData(null);
    setClearImage(false);
    setOpenVariant(null);
    setModal({ mode: 'create' });
  }
  function openEdit(p) {
    loadFormMeta();
    setForm({
      ...EMPTY,
      name: p.name,
      barcode: p.barcode || '',
      categoryId: p.category_id ? String(p.category_id) : '',
      price: String(p.price),
      cost: String(p.cost),
      stock: String(p.stock),
      minStock: String(p.min_stock),
      minPrice: String(p.min_price ?? 0),
      wholesalePrice: p.wholesale_price ? String(p.wholesale_price) : '',
      specialPrice: p.special_price ? String(p.special_price) : '',
      minPriceEnabled: p.min_price_enabled === true,
      minRetail: p.min_retail === null || p.min_retail === undefined ? '' : String(p.min_retail),
      minWholesale: p.min_wholesale === null || p.min_wholesale === undefined ? '' : String(p.min_wholesale),
      minSpecial: p.min_special === null || p.min_special === undefined ? '' : String(p.min_special),
      expiryDate: p.expiry_date ? String(p.expiry_date).slice(0, 10) : '',
      active: p.active,
      variants: (p.variants || []).map(variantFromRow),
    });
    setImageData(null);
    setClearImage(false);
    setOpenVariant(null);
    setModal({ mode: 'edit', product: p });
  }

  const hasSizes = form.variants.length > 0;

  function setVariant(i, field, value) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)),
    }));
  }
  function addVariant() {
    if (form.variants.length >= 10) {
      toast('A product can have at most 10 sizes.', 'error');
      return;
    }
    const idx = form.variants.length;
    setForm((f) => ({ ...f, variants: [...f.variants, EMPTY_VARIANT()] }));
    setOpenVariant(idx);
  }
  function duplicateVariant(i) {
    if (form.variants.length >= 10) {
      toast('A product can have at most 10 sizes.', 'error');
      return;
    }
    const src = form.variants[i];
    const copy = { ...src, id: null, name: src.name ? `${src.name} copy`.slice(0, 40) : '', imageData: null, clearImage: false };
    setForm((f) => {
      const arr = [...f.variants];
      arr.splice(i + 1, 0, copy);
      return { ...f, variants: arr };
    });
    setOpenVariant(i + 1);
  }
  async function removeVariant(i) {
    const v = form.variants[i];
    const label = v.name?.trim() || 'this size';
    const stocked = numOrZero(v.stock) > 0;
    const msg = v.id
      ? stocked
        ? `Remove size "${label}"? Its ${formatQty(v.stock)} stock will be written off with an adjustment entry.`
        : `Remove size "${label}"? Historic sales keep their receipt lines.`
      : `Remove size "${label}"?`;
    if (!window.confirm(msg)) return;
    if (v.id && modal?.mode === 'edit') {
      try {
        await api(`/api/products/${modal.product.id}/variants/${v.id}`, { method: 'DELETE' });
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
    }
    setForm((f) => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }));
    setOpenVariant(null);
  }

  async function onPickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Choose a JPG, PNG or WebP image.', 'error');
      return;
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setImageData(dataUrl);
      setClearImage(false);
    } catch {
      toast('Could not read that image. Try another file.', 'error');
    }
  }
  function onPickVariantImage(i, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Choose a JPG, PNG or WebP image.', 'error');
      return;
    }
    fileToResizedDataUrl(file)
      .then((dataUrl) => setVariant(i, 'imageData', dataUrl))
      .catch(() => toast('Could not read that image. Try another file.', 'error'));
  }

  async function save(e) {
    if (e) e.preventDefault();
    if (saving) return;
    setSaving(true);
    // Validate sizes client-side (the server re-validates authoritatively).
    const names = new Set();
    for (const v of form.variants) {
      if (!v.name.trim()) {
        toast('Each size needs a name (e.g. "500 ml").', 'error');
        setSaving(false);
        return;
      }
      const pn = numOrZero(v.price);
      if (!Number.isFinite(pn) || pn < 0) {
        toast(`Size "${v.name.trim()}" needs a price of 0 or more.`, 'error');
        setSaving(false);
        return;
      }
      const key = v.name.trim().toLowerCase();
      if (names.has(key)) {
        toast(`Duplicate size name: "${v.name.trim()}".`, 'error');
        setSaving(false);
        return;
      }
      names.add(key);
    }
    const variantsBody = form.variants.map((v, idx) => variantToWire(v, idx));

    const body = {
      name: form.name.trim(),
      barcode: hasSizes ? null : form.barcode.trim() || null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      price: form.price,
      cost: form.cost === '' ? 0 : form.cost,
      minStock: form.minStock === '' ? 0 : form.minStock,
      minPrice: form.minPrice === '' ? 0 : form.minPrice,
      wholesalePrice: hasSizes ? undefined : (form.wholesalePrice === '' ? null : form.wholesalePrice),
      specialPrice: hasSizes ? undefined : (form.specialPrice === '' ? null : form.specialPrice),
      minPriceEnabled: form.minPriceEnabled === true,
      minRetail: form.minRetail === '' ? null : form.minRetail,
      minWholesale: form.minWholesale === '' ? null : form.minWholesale,
      minSpecial: form.minSpecial === '' ? null : form.minSpecial,
      expiryDate: hasSizes ? null : form.expiryDate || null,
      variants: variantsBody.length > 0 ? variantsBody : null,
    };
    // Product-level stock/expiry apply to plain products only; sizes own
    // their own stock (a plain product's stock moves to its first size).
    if (!hasSizes) {
      body.stock = form.stock === '' ? (modal.mode === 'edit' ? null : 0) : form.stock;
    }
    try {
      if (modal.mode === 'create') {
        if (imageData) body.imageData = imageData;
        await api('/api/products', { method: 'POST', body });
        toast('Product created.');
      } else {
        body.active = form.active;
        if (imageData) body.imageData = imageData;
        else if (clearImage) body.clearImage = true;
        await api(`/api/products/${modal.product.id}`, { method: 'PUT', body });
        toast('Product updated.');
      }
      setModal(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p) {
    try {
      await api(`/api/products/${p.id}`, { method: 'PUT', body: { active: !p.active } });
      toast(p.active ? 'Product disabled.' : 'Product enabled.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Barcode label: render with JsBarcode (dynamic import, only loaded when used)
  useEffect(() => {
    let cancelled = false;
    async function renderLabel() {
      if (!labelProduct) {
        setLabelSvg(null);
        return;
      }
      try {
        const JsBarcode = (await import('jsbarcode')).default;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        new JsBarcode(svg, labelProduct.barcode, {
          format: 'CODE128',
          displayValue: false,
          height: 44,
          width: 1.8,
          margin: 0,
        });
        if (!cancelled) setLabelSvg(svg.outerHTML);
      } catch {
        if (!cancelled) setLabelSvg(null);
      }
    }
    renderLabel();
    return () => {
      cancelled = true;
    };
  }, [labelProduct]);

  const columns = [
    {
      key: 'name',
      label: 'Product',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          {r.has_image ? (
            <img
              src={`/api/products/${r.id}/image`}
              alt=""
              className="w-9 h-9 rounded-md object-cover border border-line shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <div className="font-medium text-stone-900 truncate">{r.name}</div>
            {r.barcode && <div className="text-xs text-stone-400 tabular-nums">{r.barcode}</div>}
          </div>
        </div>
      ),
    },
    { key: 'category_name', label: 'Category', render: (r) => r.category_name || <span className="text-stone-400">—</span> },
    {
      key: 'price',
      label: 'Price',
      render: (r) => {
        const vs = (r.variants || []).filter((v) => v.active);
        if (vs.length > 0) {
          const from = Math.min(...vs.map((v) => Number(v.price) * (100 - Number(v.discount_pct || 0)) / 100));
          return (
            <span className="tabular-nums">
              {formatMoney(from, currency)} <span className="text-[10px] text-stone-400">from</span>
            </span>
          );
        }
        return <span className="tabular-nums">{formatMoney(r.price, currency)}</span>;
      },
    },
    {
      key: 'stock',
      label: 'Stock',
      render: (r) => {
        const low = Number(r.stock) <= Number(r.min_stock) && Number(r.min_stock) > 0;
        return (
          <Badge tone={Number(r.stock) <= 0 ? 'bad' : low ? 'warn' : 'muted'}>
            {formatQty(r.stock)}
          </Badge>
        );
      },
    },
    {
      key: 'variants',
      label: 'Sizes',
      render: (r) =>
        (r.variants || []).length > 0 ? (
          <Badge tone="muted">{r.variants.length}</Badge>
        ) : (
          <span className="text-stone-400 text-xs">—</span>
        ),
    },
    {
      key: 'expiry_date',
      label: 'Expiry',
      render: (r) => {
        const vs = r.variants || [];
        const dates = [
          ...(r.expiry_date && vs.length === 0 ? [String(r.expiry_date).slice(0, 10)] : []),
          ...vs.map((v) => (v.expiry_date ? String(v.expiry_date).slice(0, 10) : null)).filter(Boolean),
        ];
        if (dates.length === 0) return <span className="text-stone-400 text-xs">—</span>;
        const soonest = dates.sort()[0];
        const d = daysUntil(soonest);
        if (d < 0) return <Badge tone="bad">Expired {soonest}</Badge>;
        if (d <= 30) return <Badge tone="warn">{soonest}</Badge>;
        return <span className="text-xs text-stone-500 tabular-nums">{soonest}</span>;
      },
    },
    {
      key: 'active',
      label: 'Status',
      render: (r) => <Badge tone={r.active ? 'good' : 'muted'}>{r.active ? 'Active' : 'Disabled'}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setLabelProduct(r)} title="Print barcode label" disabled={!r.barcode}>
            <IconPrinter className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Edit">
            <IconPencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleActive(r)}>
            {r.active ? 'Disable' : 'Enable'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-6xl">
      <PageHeader
        title="Products"
        sub="Drinks and items for sale, with optional sizes"
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add product
          </Button>
        }
      />
      <div className="mb-4 max-w-xs">
        <Input placeholder="Search name, barcode or size…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !products ? (
        <Loading />
      ) : (
        <DataTable columns={columns} rows={filtered} empty="No products yet. Add your first product." />
      )}

      {/* Add / edit product */}
      {modal && (
        <Modal
          wide
          title={modal.mode === 'create' ? 'Add product' : `Edit — ${modal.product.name}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={saving} onClick={save}>Save product</Button>
            </>
          }
        >
          <div className="space-y-5">
            {/* Common info */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Product</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Name" className="sm:col-span-2">
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Lemon Iced Tea" />
                </Field>
                <Field label="Category">
                  <Select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={hasSizes ? 'Barcode (per size, below)' : 'Barcode'}>
                  <Input
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    disabled={hasSizes}
                    placeholder="Scan or type"
                  />
                </Field>
                <Field label="Photo">
                  <div className="flex items-center gap-2">
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickImage} />
                    <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                      {imageData ? 'Replace photo' : 'Choose photo'}
                    </Button>
                    {(imageData || (modal.mode === 'edit' && modal.product.has_image)) && (
                      <Button variant="ghost" size="sm" onClick={() => { setImageData(null); setClearImage(true); }}>
                        Remove
                      </Button>
                    )}
                  </div>
                  {imageData && <img src={imageData} alt="" className="mt-2 w-16 h-16 object-cover rounded-md border border-line" />}
                </Field>
                {modal.mode === 'edit' && (
                  <Field label="Status">
                    <Select value={form.active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === '1' }))}>
                      <option value="1">Active</option>
                      <option value="0">Disabled</option>
                    </Select>
                  </Field>
                )}
              </div>
            </div>

            {/* Base pricing / plain-product fields */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">
                {hasSizes ? 'Base pricing (reference)' : 'Pricing & stock'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Selling price">
                  <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
                </Field>
                <Field label="Cost">
                  <Input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} />
                </Field>
                <Field label="Min selling price">
                  <Input type="number" min="0" step="0.01" value={form.minPrice} onChange={(e) => setForm((f) => ({ ...f, minPrice: e.target.value }))} />
                </Field>
                <Field label="Min stock">
                  <Input type="number" min="0" step="0.01" value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))} />
                </Field>
                {!hasSizes && (
                  <>
                    <Field label="Stock">
                      <Input type="number" min="0" step="0.01" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} />
                    </Field>
                    <Field label="Wholesale price" hint="Blank falls back to the selling price.">
                      <Input type="number" min="0" step="0.01" value={form.wholesalePrice} onChange={(e) => setForm((f) => ({ ...f, wholesalePrice: e.target.value }))} />
                    </Field>
                    <Field label="Sale / Special price" hint="Blank falls back to the selling price.">
                      <Input type="number" min="0" step="0.01" value={form.specialPrice} onChange={(e) => setForm((f) => ({ ...f, specialPrice: e.target.value }))} />
                    </Field>
                    <Field label="Expiry date">
                      <Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                    </Field>
                  </>
                )}
              </div>
              {hasSizes && (
                <p className="text-xs text-stone-400 mt-2">
                  Sizes below have their own price, cost and stock. The base values above are kept for reference only.
                </p>
              )}
            </div>

            {/* Minimum selling price protection (per mode) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Minimum selling price
                </div>
                <label className="flex items-center gap-1.5 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={form.minPriceEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, minPriceEnabled: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded border-stone-300"
                  />
                  Protection {form.minPriceEnabled ? 'ON' : 'OFF'}
                </label>
              </div>
              <div className={`grid grid-cols-3 gap-3 ${form.minPriceEnabled ? '' : 'opacity-50'}`}>
                <Field label="Retail minimum">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minRetail}
                    onChange={(e) => setForm((f) => ({ ...f, minRetail: e.target.value }))}
                    placeholder="No minimum"
                    disabled={!form.minPriceEnabled}
                  />
                </Field>
                <Field label="Wholesale minimum">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minWholesale}
                    onChange={(e) => setForm((f) => ({ ...f, minWholesale: e.target.value }))}
                    placeholder="No minimum"
                    disabled={!form.minPriceEnabled}
                  />
                </Field>
                <Field label="Sale / Special minimum">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minSpecial}
                    onChange={(e) => setForm((f) => ({ ...f, minSpecial: e.target.value }))}
                    placeholder="No minimum"
                    disabled={!form.minPriceEnabled}
                  />
                </Field>
              </div>
              <p className="text-xs text-stone-400 mt-1.5">
                When ON, no sale in that mode can be priced below the minimum (enforced on the server).
                Blank = no minimum for that mode.
                {hasSizes ? ' Each size can override its own minimum below.' : ''}
              </p>
            </div>

            {/* Sizes / variants */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">Sizes (optional)</div>
                <Button variant="secondary" size="sm" onClick={addVariant} disabled={form.variants.length >= 10}>
                  <IconPlus className="w-3.5 h-3.5" /> Add size
                </Button>
              </div>
              {form.variants.length === 0 ? (
                <p className="text-sm text-stone-400 border border-dashed border-line rounded-md px-3 py-3">
                  No sizes — sold as a single item. Add a size (e.g. 250 ml, 500 ml) when the same product comes in several pack sizes with their own price and stock.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.variants.map((v, i) => {
                    const open = openVariant === i;
                    const price = numOrZero(v.price);
                    const disc = numOrZero(v.discountPct);
                    const effective = (price * (100 - disc)) / 100;
                    const exp = v.expiryDate ? v.expiryDate.slice(0, 10) : null;
                    return (
                      <div key={i} className="border border-line rounded-md bg-white">
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-stone-900 truncate">
                              {v.name || <span className="text-stone-400">New size</span>}
                              {v.unit && <span className="text-stone-400 font-normal"> ({v.unit})</span>}
                            </div>
                            <div className="text-xs text-stone-500 tabular-nums">
                              {disc > 0 && <span className="line-through text-stone-400 mr-1">{formatMoney(price, currency)}</span>}
                              {formatMoney(effective, currency)}
                              <span className="text-stone-400 ml-2">stock {formatQty(v.stock === '' ? 0 : v.stock)}</span>
                              {exp && (
                                <span className={`ml-2 ${exp < today ? 'text-red-600' : daysUntil(exp) <= 30 ? 'text-amber-600' : 'text-stone-400'}`}>
                                  exp {exp}
                                </span>
                              )}
                              {!v.active && <span className="ml-2 text-stone-400">disabled</span>}
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setOpenVariant(open ? null : i)}>
                            {open ? 'Close' : 'Edit'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => duplicateVariant(i)} title="Duplicate this size">
                            Duplicate
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => removeVariant(i)}>
                            Remove
                          </Button>
                        </div>
                        {open && (
                          <div className="border-t border-line px-3 py-3 bg-cream/30">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <Field label="Size name *">
                                <Input value={v.name} onChange={(e) => setVariant(i, 'name', e.target.value)} placeholder="e.g. 500 ml" />
                              </Field>
                              <Field label="Unit">
                                <Input value={v.unit} onChange={(e) => setVariant(i, 'unit', e.target.value)} placeholder="bottle / can / piece" />
                              </Field>
                              <Field label="Selling price *">
                                <Input type="number" min="0" step="0.01" value={v.price} onChange={(e) => setVariant(i, 'price', e.target.value)} />
                              </Field>
                              <Field label="Cost price">
                                <Input type="number" min="0" step="0.01" value={v.cost} onChange={(e) => setVariant(i, 'cost', e.target.value)} />
                              </Field>
                              <Field label="Wholesale price" hint="Blank falls back to the selling price.">
                                <Input type="number" min="0" step="0.01" value={v.wholesalePrice} onChange={(e) => setVariant(i, 'wholesalePrice', e.target.value)} />
                              </Field>
                              <Field label="Sale / Special price" hint="Blank falls back to the selling price.">
                                <Input type="number" min="0" step="0.01" value={v.specialPrice} onChange={(e) => setVariant(i, 'specialPrice', e.target.value)} />
                              </Field>
                              <Field label="Min price protection">
                                <label className="flex items-center gap-1.5 text-xs text-stone-600 pt-1.5">
                                  <input
                                    type="checkbox"
                                    checked={v.minPriceEnabled}
                                    onChange={(e) => setVariant(i, 'minPriceEnabled', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-stone-300"
                                  />
                                  ON
                                </label>
                              </Field>
                              <Field label="Retail minimum">
                                <Input type="number" min="0" step="0.01" value={v.minRetail} onChange={(e) => setVariant(i, 'minRetail', e.target.value)} placeholder="No minimum" disabled={!v.minPriceEnabled} />
                              </Field>
                              <Field label="Wholesale minimum">
                                <Input type="number" min="0" step="0.01" value={v.minWholesale} onChange={(e) => setVariant(i, 'minWholesale', e.target.value)} placeholder="No minimum" disabled={!v.minPriceEnabled} />
                              </Field>
                              <Field label="Sale / Special minimum">
                                <Input type="number" min="0" step="0.01" value={v.minSpecial} onChange={(e) => setVariant(i, 'minSpecial', e.target.value)} placeholder="No minimum" disabled={!v.minPriceEnabled} />
                              </Field>
                              <Field label="Retail price">
                                <Input type="number" min="0" step="0.01" value={v.retailPrice} onChange={(e) => setVariant(i, 'retailPrice', e.target.value)} />
                              </Field>
                              <Field label="Tax rate %">
                                <Input type="number" min="0" max="100" step="0.01" value={v.taxRate} onChange={(e) => setVariant(i, 'taxRate', e.target.value)} placeholder="0" />
                              </Field>
                              <Field label="Standing discount %">
                                <Input type="number" min="0" max="100" step="0.01" value={v.discountPct} onChange={(e) => setVariant(i, 'discountPct', e.target.value)} placeholder="0" />
                              </Field>
                              <Field label="SKU">
                                <Input value={v.sku} onChange={(e) => setVariant(i, 'sku', e.target.value)} placeholder="optional" />
                              </Field>
                              <Field label="Stock">
                                <Input type="number" min="0" step="0.01" value={v.stock} onChange={(e) => setVariant(i, 'stock', e.target.value)} />
                              </Field>
                              <Field label="Min stock">
                                <Input type="number" min="0" step="0.01" value={v.minStock} onChange={(e) => setVariant(i, 'minStock', e.target.value)} placeholder="0" />
                              </Field>
                              <Field label="Reorder at">
                                <Input type="number" min="0" step="0.01" value={v.reorderLevel} onChange={(e) => setVariant(i, 'reorderLevel', e.target.value)} placeholder="0" />
                              </Field>
                              <Field label="Expiry date">
                                <Input type="date" value={v.expiryDate} onChange={(e) => setVariant(i, 'expiryDate', e.target.value)} />
                              </Field>
                              <Field label="Batch no.">
                                <Input value={v.batchNo} onChange={(e) => setVariant(i, 'batchNo', e.target.value)} placeholder="optional" />
                              </Field>
                              <Field label="Barcode">
                                <Input value={v.barcode} onChange={(e) => setVariant(i, 'barcode', e.target.value)} placeholder="optional" />
                              </Field>
                              <Field label="Supplier">
                                <Select value={v.supplierId} onChange={(e) => setVariant(i, 'supplierId', e.target.value)}>
                                  <option value="">—</option>
                                  {vendors.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Status">
                                <Select value={v.active ? '1' : '0'} onChange={(e) => setVariant(i, 'active', e.target.value === '1')}>
                                  <option value="1">Active</option>
                                  <option value="0">Disabled</option>
                                </Select>
                              </Field>
                              <Field label="Size photo">
                                <div className="flex items-center gap-2 pt-1">
                                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPickVariantImage(i, e)} id={`vimg-${i}`} />
                                  <Button variant="ghost" size="sm" onClick={() => document.getElementById(`vimg-${i}`)?.click()}>
                                    {v.imageData || v.hasImage ? 'Replace' : 'Choose'}
                                  </Button>
                                  {(v.imageData || v.hasImage) && (
                                    <Button variant="ghost" size="sm" onClick={() => { setVariant(i, 'imageData', null); setVariant(i, 'clearImage', true); }}>
                                      Remove
                                    </Button>
                                  )}
                                </div>
                                {v.imageData && <img src={v.imageData} alt="" className="mt-1.5 w-12 h-12 object-cover rounded-md border border-line" />}
                              </Field>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Barcode label */}
      {labelProduct && (
        <Modal
          title={`Label — ${labelProduct.name}`}
          onClose={() => setLabelProduct(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLabelProduct(null)}>Close</Button>
              <Button onClick={() => window.print()} variant="primary">Print</Button>
            </>
          }
        >
          {labelSvg ? (
            <div className="flex flex-col items-center gap-2" id="barcode-label">
              <div dangerouslySetInnerHTML={{ __html: labelSvg }} />
              <div className="text-sm font-medium">{labelProduct.name}</div>
              <div className="text-xs tabular-nums">{formatMoney(labelProduct.price, currency)}</div>
            </div>
          ) : (
            <Loading label="Rendering label…" />
          )}
        </Modal>
      )}
    </div>
  );
}
