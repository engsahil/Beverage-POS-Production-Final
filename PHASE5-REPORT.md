# Phase 5 — Completion Report

Date: 2026-09-18 (UTC) · App: `/home/user/beverage-pos` (Next.js 15 + PostgreSQL, live on :3001)

## 1. What was built

### Finance hub (`/admin/finance`, `components/admin/FinanceClient.jsx`)
- **Account cards** — Cash / Bank / Card balances, derived from real stored transactions
  (sales paid, customer payments, vendor payments, expenses — per payment method).
- **5 tabs**, all backed by new APIs in `lib/finance.js` (single-purpose SQL, no ORM):
  - **Cash Flow** (date range): opening / inflow / outflow / closing per account.
  - **Profit & Loss** (date range): revenue, COGS (at current cost), gross profit,
    expenses by category, settled vendor claims (credit), net.
  - **Balance Sheet** (point-in-time): assets (cash, bank, card, receivables,
    inventory at cost) / liabilities (payables) / equity (residual) + "Balanced" badge.
  - **Receivables** / **Payables**: per-customer / per-vendor outstanding + overdue totals.
- Every number is computed from stored rows (`sales`, `customer_transactions`,
  `purchase_payments`, `expenses`, `vendor_claims`, `products.stock×cost`).
  Nothing is hard-coded; empty periods render polished empty states.

### Purchases: payments, status, ledger
- **Payments CRUD** on each purchase (`/api/purchases/:id/payments`): amount, method
  (cash/bank/card), date, reference, note. One purchase → one invoice total; stock
  deducted once. Status derived: `unpaid → partially_paid → paid`, plus
  `overdue` (past due_date, still outstanding). Exact-remaining allowed, one paisa
  over blocked; deleting a payment re-opens the balance.
- **Purchases list**: status column + filter pills, paid / remaining per row.
- **Purchase detail**: invoice / paid / remaining cards, payments table (edit + delete),
  invoice image attachment (upload/serve/download, `bytea` never leaked to lists).
- **Vendor ledger** (`/api/vendors/:id/ledger`): opening balance, running balance per
  row (invoice = debit, payment = credit), filters by type and method.

### Customers: payment methods + ledger
- Customer payments now carry a **method** (required) and note; over-balance recovery
  rejected with a friendly message; `customer_credit` permission enforced.
- **Customer ledger** (`/api/customers/:id`): running balance across sale/payment rows;
  edit/delete of transaction entries with balance recalculation (transactional).
- **Receivables tab** shows per-customer outstanding with the same data.

### Expenses v2
- Fields: **Paid via** (cash/bank/card), **Payee**, **Reference**, **attachment**
  (image upload, served auth'd, never serialized into lists).
- Expense date + method feed the cash-flow and P&L directly.

### Branding — logo (sidebar · POS · receipt · settings)
- **Settings → Branding**: upload/replace/remove logo. Client-side downscale to
  max 512 px canvas → JPEG data URL → `PUT /api/settings/logo` (≤ 256 KB,
  jpeg/png/webp only). Stored as `bytea`; served by `GET /api/settings/logo`
  (auth'd image response); `DELETE` clears it.
- Rendered in: **admin sidebar** (next to business name), **POS header**, and
  **both receipt outputs** (`.r-logo`, sized to not break 58/80 mm layout).
- No logo → clean fallback (app mark / name), no broken-image icon.

### License activation (valid key supplied by the vendor; tests read it from the LICENSE_KEY env var)
- `POST /api/license {key}` → server compares SHA-256 digest to a constant that
  exists **only in the server route file** (verified absent from `.next/static`
  client bundles). Only the activation flag + key name are stored.
- **Persistent indicator**: green dot + "License Activated" in the sidebar footer,
  red + "Not Activated" otherwise. The sidebar **re-fetches real state on every
  route change** (one small request), so activating in Settings updates the dot
  immediately on client-side navigation — no stale state.
- Deactivation is an admin action from Settings.

### Business insights (dashboard)
- Settings gained **Daily / Monthly sales goals** (0 = off).
- Dashboard shows 3 cards: **Today** (sales vs goal, progress bar), **Streak**
  (consecutive days meeting the daily goal, flame icon), **Monthly** (MTD vs goal).
  Computed server-side in `/api/dashboard` with business-timezone dates.

### Design pass (reference tokens)
- `globals.css` @theme: cream `#F5F6F0`, cream-deep `#ECEFE6`, line `#E5E7EB`,
  brand green `#16B364`, brand-deep `#0E9B52`, danger `#E5484D`, ink `#172033`,
  sub `#6B7280`. Buttons/badges/cards/header re-mapped in `components/ui.jsx`
  (primary = brand green, danger red, tinted ok/bad/info badges, soft shadows).
- No emoji anywhere; professional icon set only.

## 2. Bugs found & fixed during browser verification (this session)

| Bug | Fix |
|---|---|
| P&L tab crashed (`reading 'length'` on undefined) — stale previous-tab data rendered with new tab's shape during the switch | Per-tab shape guard (`ready()`) in `FinanceClient.jsx` |
| Balance Sheet tab never loaded data | `load()` now fetches `/api/finance/balance-sheet` |
| Sidebar license dot + logo went stale after client-side activation/upload | Sidebar fetches `/api/settings` on mount + each route change; live state drives dot & logo |
| Sales list defaults used browser timezone while the server filters by store timezone — "today's" sales could be out of range | New `storeDateStr(tz, offset)` helper; `/sales` defaults now use the store timezone |

## 3. Verification (all against the running production build)

| Suite | Result | Covers |
|---|---|---|
| `uicheck/phase5-api.mjs` | **70 / 70** | Every Phase-5 API: purchase payments/status/ledger, vendor ledger + filters, customer methods/ledger/recalc, expenses v2 + attachment (bytea non-leak), finance endpoints (cash-flow math, P&L, balance sheet balanced, receivables, payables/overdue), goals/streak, license activate/deactivate + persistence |
| `uicheck/phase5-ui.mjs` | **27 / 27** (0 console errors) | Dashboard goal cards; Finance nav + all 5 tabs incl. P&L & balanced badge; purchases list/detail + payment recorded **through the UI**; vendor Outstanding + ledger modal; customer ledger + recovery modal; expense form fields; logo upload via UI → sidebar/POS/receipt; goals; license activation via UI → persistent sidebar dot |
| `uicheck/variant-ui.mjs` | **14 / 14** | Variant products end-to-end (regression guard) |
| `scripts/smoke.mjs` | **203 / 203** | Full app regression: auth, products, purchases, sales, shifts, imports, variants, clear-data, finance interactions |

Notes:
- The smoke suite's customer-recovery calls were updated to the new
  payment-method contract (they predated Phase 5); no behavior change in the app.
- Test suites are self-contained; `phase5-api.mjs` now cleans its isolated
  test-year expenses up front and uses a wider year space so re-runs can't
  collide. Accumulated test artifacts from earlier runs were removed from the
  dev database (seed users + settings untouched; no production data exists in
  this instance).

## 4. Performance (measured, warm, server ↔ browser on host)

- API endpoints: **7–11 ms** (`/api/settings`, `/api/dashboard`,
  cash-flow, balance-sheet, profit).
- Full page loads: **TTFB 14–35 ms**, **DOMContentLoaded 40–67 ms**,
  load ≤ 89 ms across `/admin`, `/admin/finance`, `/pos`, `/sales`,
  `/admin/products`.
- The new per-navigation sidebar state check adds one ~11 ms request fired
  in parallel; it does not block render.

## 5. Security & honest limitations

- License: key and digest live only in the server route; verified **not**
  present in any client bundle. Single-node deployment means anyone with
  server-source access can read the digest — this is an activation gate, not
  cryptographic DRM. Deactivation is admin-only.
- Money: integer-paisa/`round2` handling in app code; DB stores `numeric`.
- Attachments (logo, invoices, expense receipts): local `bytea` storage only.
  No object storage is configured — fine for this single-node deployment;
  permanent large-scale attachments would need object storage (reported, not
  built, per constraints).
- Local backup only (no cloud backup exists — none claimed).
- **Not tested — environment limitation:** 58 mm physical print output
  (verified layout math and width-aware CSS only, no printer in sandbox),
  PWA offline behavior on a flaky network, multi-node license sync (N/A by
  design), and real-object-storage uploads.
