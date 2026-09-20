'use client';
// Thermal receipts for a completed sale: the CUSTOMER receipt and the
// KITCHEN order ticket (KOT). Both are rendered from the SAME sale
// data (one API response) — nothing is fetched a second time.
//
// Design rules (thermal printer safety):
// - monospaced font stack only (no web fonts, crisp on thermal dots)
// - pure black on white, no colors, no cards, no rounded corners
// - fixed sheet widths: 80mm = 302px, 58mm = 220px (96dpi)
// - safe margins: 15px sides on 80mm, 20px on 58mm (≈ printable width)
// - trailing whitespace at the bottom so the auto-cutter never
//   clips the last line
import { formatMoney, formatQty, formatDate, formatTime } from '@/lib/format';
import { PRICING_MODE_LABELS } from '@/lib/pricing';

const MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Dashed separator — prints as dots on thermal paper. */
function Sep() {
  return <div className="r-sep" />;
}

function CenterRow({ children, className = '' }) {
  return <div className={`text-center break-words ${className}`}>{children}</div>;
}

function KV({ label, value, bold = false, className = '' }) {
  return (
    <div className={`r-row ${className}`}>
      <span>{label}</span>
      <span className={bold ? 'font-bold' : ''}>{value}</span>
    </div>
  );
}

function ItemBlock({ name, variant, qty, unitPrice, lineTotal, cur, mode }) {
  return (
    <div className="r-item">
      <div className="r-item-name">
        {name}
        {variant ? <span className="r-item-variant"> · {variant}</span> : null}
        {mode && mode !== 'retail' ? (
          <span className="r-item-variant"> · {PRICING_MODE_LABELS[mode] || mode}</span>
        ) : null}
      </div>
      <div className="r-row">
        <span>
          {formatQty(qty)} × {formatMoney(unitPrice, cur)}
        </span>
        <span>{formatMoney(Number(qty) * Number(unitPrice), cur)}</span>
      </div>
    </div>
  );
}

/**
 * Customer receipt.
 * sale: row from /api/sales/:id, items: its sale_items, settings: business settings.
 * width: '80' | '58'
 */
export function CustomerReceipt({ sale, items, settings, width }) {
  const cur = settings?.currency || 'Rs';
  const tz = settings?.timezone;
  const table = sale.table_no || 'WALK-IN';
  return (
    <div className={`receipt-page receipt-customer r-sheet ${width === '58' ? 'rw-58' : 'rw-80'}`}>
      {settings?.has_logo && (
        <CenterRow>
          {/* Fixed height keeps the thermal layout from shifting; width
              scales with the sheet so it never overflows the print area. */}
          <img
            src="/api/settings/logo"
            alt=""
            className="r-logo mx-auto"
            style={{ height: width === '58' ? 32 : 44, maxWidth: '100%' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </CenterRow>
      )}
      <CenterRow className="r-biz font-bold">{settings?.business_name || 'Beverage Store'}</CenterRow>
      <Sep />

      <div className="r-block">
        <KV label="ORDER NO:" value={sale.sale_no} bold />
        <KV label="TABLE NO:" value={table} bold />
        <KV label="DATE:" value={formatDate(sale.created_at, tz)} />
        <KV label="TIME:" value={formatTime(sale.created_at, tz)} />
        <KV label="CASHIER:" value={sale.cashier_name || '—'} />
        {sale.customer_name ? <KV label="CUSTOMER:" value={sale.customer_name} /> : null}
      </div>
      <Sep />

      <div className="r-block">
        {items.map((it, i) => (
          <ItemBlock
            key={i}
            name={it.name}
            variant={it.variant}
            qty={it.qty}
            unitPrice={it.unit_price}
            lineTotal={Number(it.qty) * Number(it.unit_price)}
            cur={cur}
            mode={sale.pricing_mode === 'mixed' ? it.pricing_mode : null}
          />
        ))}
      </div>
      <Sep />

      <div className="r-block">
        <KV label="Subtotal" value={formatMoney(sale.subtotal, cur)} />
        {Number(sale.discount) > 0 ? (
          <KV label="Discount" value={`- ${formatMoney(sale.discount, cur)}`} />
        ) : null}
      </div>
      <div className="r-total">
        <span>TOTAL</span>
        <span>{formatMoney(sale.total, cur)}</span>
      </div>

      <div className="r-block">
        {sale.pricing_mode && sale.pricing_mode !== 'retail' ? (
          <KV label="Pricing Mode" value={PRICING_MODE_LABELS[sale.pricing_mode] || sale.pricing_mode} />
        ) : null}
        <KV label="Payment" value={sale.payment_method === 'cash' ? 'Cash' : sale.payment_method === 'card' ? 'Card' : 'Other'} />
        <KV label="Customer Paid" value={formatMoney(sale.paid, cur)} />
        {Number(sale.total) - Number(sale.paid) > 0.001 ? (
          <KV label="Balance (credit)" value={formatMoney(Number(sale.total) - Number(sale.paid), cur)} />
        ) : null}
        <KV label="Change / Return" value={formatMoney(sale.change_due, cur)} bold />
      </div>
      <Sep />

      <CenterRow className="r-footer break-words">{settings?.receipt_footer}</CenterRow>
      {/* trailing feed space for the auto-cutter */}
      <div className="r-feed" />
    </div>
  );
}

/**
 * Kitchen order ticket (KOT). Deliberately minimal: what to prepare,
 * how many, which table, which order. No payment information at all.
 */
export function KitchenReceipt({ sale, items, settings, width }) {
  const tz = settings?.timezone;
  const table = sale.table_no || 'WALK-IN';
  return (
    <div className={`receipt-page receipt-kitchen r-sheet ${width === '58' ? 'rw-58' : 'rw-80'}`}>
      <CenterRow className="r-biz font-bold">{settings?.business_name || 'Beverage Store'}</CenterRow>
      <CenterRow className="r-kot-title font-bold">GATE PASS</CenterRow>
      <Sep />

      <div className="r-block">
        <KV label="ORDER NO:" value={sale.sale_no} bold />
        <KV label="TABLE NO:" value={table} bold />
        <KV label="TIME:" value={formatTime(sale.created_at, tz)} bold />
        <KV label="DATE:" value={formatDate(sale.created_at, tz)} />
      </div>
      <Sep />

      <div className="r-block">
        {items.map((it, i) => (
          <div key={i} className="r-kot-item">
            <div className="r-kot-line">
              <span className="font-bold">{formatQty(it.qty)} ×</span>
              <span className="r-kot-name font-bold">{it.name}</span>
            </div>
            {it.variant ? <div className="r-kot-variant">{it.variant}</div> : null}
          </div>
        ))}
      </div>

      {sale.notes ? (
        <>
          <Sep />
          <div className="r-block">
            <div className="r-kot-notes-label font-bold">NOTES:</div>
            <div className="r-kot-notes break-words">{sale.notes}</div>
          </div>
        </>
      ) : null}
      <Sep />

      {/* trailing feed space for the auto-cutter */}
      <div className="r-feed" />
    </div>
  );
}
