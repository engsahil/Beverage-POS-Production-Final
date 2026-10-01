# Production audit — total cost aggregation, customer ledger, deployed performance

Date: 2026-10-01
Scope: the whole application (catalogue, inventory, ledger, sales, finance, reports, POS),
audited end to end and then re-verified. Nothing was rewritten; every change is a targeted
fix to an existing file.

---

## 1. Data model as it actually exists

The brief describes *Category → Sub-category → Variant → Sub-variant → Individual item*.
This database has **three** levels, not five, and there is no `sub_categories` or
`sub_variants` table:

| Brief wording | Actual table | Notes |
| --- | --- | --- |
| Category | `categories` | flat, no `parent_id` — a "sub-category" is just another category row |
| Item | `products` | `price`, `cost`, `stock`, `min_stock`, `min_price`, … |
| Variant / Sub-variant / size (500 ml, 1000 ml) | `product_variants` | one row per size, each with its **own** `cost`, `price`, `stock` |

All findings below are stated against these tables. No new hierarchy was invented.

---

## 2. Root cause #1 — total cost / inventory value was variant-blind

**The rule the data implies:** a product that has size rows is valued by its sizes; a product
without sizes is valued by its own `stock × cost`. `products.stock` is a *mirror* of
`SUM(product_variants.stock)` and `products.cost` is frequently `0` for sized products, so
valuing a sized product at the product level silently discards the real cost.

Four places computed an inventory value. **Three of them were variant-blind:**

| Site | Before | Status |
| --- | --- | --- |
| `/api/dashboard` (dashboard card) | `SUM(stock*cost) FROM products` | **fixed** |
| `/api/reports/[type]` (inventory report) | `(p.stock*p.cost) AS value` | **fixed** |
| `InventoryClient.jsx` | recomputed the same wrong sum in the browser | **fixed** |
| `/api/finance/balance-sheet` | already variant-aware (LEFT JOIN LATERAL) | reference |

Measured on the audited catalogue (803 active products, 203 of them sized, 606 size rows):

```
OLD dashboard stock_value : 41,125,656.38
NEW dashboard stock_value : 51,464,088.29
under-reported by         : 10,338,431.91   (20.1% of the true value)
```

So the dashboard, the inventory report and the inventory screen all understated stock value
by ~20%, while the balance sheet said something different — three screens, three answers.

### Fix
* New `lib/inventory.js` holds the single definition of inventory value
  (`stockValueExpr`, `unitCostExpr`, `variantAggregate`, `inventoryValueQuery`), imported by
  every endpoint that needs a value. There is now one rule, in one place, executed in SQL.
* `/api/dashboard`, `/api/reports/[type]` and `/api/products` all use it; `/api/products`
  returns a real `stock_value` column so no client recomputes anything.
* `InventoryClient.jsx` renders the server's `stock_value` (client-side fallback kept for the
  brief moment before data arrives), shows per-size cost and value on the expanded row, and
  its Unit Cost column is the stock-weighted average of the sizes rather than the misleading
  product-level cost.
* `NULL` cost is coerced to `0` in SQL (`COALESCE`) and every aggregation is wrapped in
  `COALESCE(…, 0)`, so a blank or zero cost contributes exactly 0 — never `NULL`, never `NaN`.
* Values are rounded with the same `round2()` used by the rest of the money code, so currency
  precision is unchanged.

---

## 3. Root cause #2 — the ledger had no opening balance, no totals and a hard cap

What already worked correctly and was **left alone**: partial payments, multiple payments
(each is its own row, nothing is overwritten), the signed-amount convention
(`sale` rows are the unpaid credit portion, so `SUM(amount) = outstanding_balance`), and
recalculating `balance_after` after a historical edit.

What was missing:

| Gap | Consequence |
| --- | --- |
| no `opening_balance` type (DB `CHECK` allowed only `sale`, `payment`, `adjustment`) | a customer's carried-forward balance could not be recorded |
| no way to create an `adjustment` | the type existed in the DB but no endpoint could write it |
| no totals (total debit / credit / purchases / payments) | the ledger showed rows but no account summary |
| `LIMIT 200` with no pagination | history beyond 200 entries was silently unreachable |
| no drift detection | a corrupt `balance_after` chain would never be noticed |
| no upper bound on ledger amounts | a large amount reached the DB and raised a raw `numeric(12,2)` overflow → HTTP 500 |

### Fixes
* `lib/ledger.js` — the ledger rules in one module: `LEDGER_TYPES`, `MAX_LEDGER_AMOUNT`,
  `ledgerTotals()`, `recalculateCustomerLedger()`, `appendLedgerEntry()`.
* `db/schema-009.sql` — **additive and backward-safe**: it widens the existing
  `customer_transactions_type_check` to include `opening_balance`, and adds two indexes. No
  table, column or row is dropped or rewritten; existing data is untouched. Verified by
  running it against a copy of the audited database and by re-running the whole suite.
* `POST /api/customers/:id/ledger` — records an **opening balance** (only when the account has
  no history, otherwise `409`) or an **adjustment** (a note is mandatory). The sign is derived
  server-side from `direction`; the client cannot send a raw negative.
* `POST /api/customers/:id/ledger/recalculate` — admin repair: recomputes the stored balance
  and every `balance_after` in one transaction and reports whether it changed anything.
* `GET /api/customers/:id` now returns `{ customer, ledger, totals, hasMore }` with
  `?limit` (≤ 500) / `?before` pagination. `totals` includes
  `opening_balance`, `total_debits`, `total_credits`, `total_purchases_on_credit`,
  `total_payments`, `total_adjustments`, `ledger_balance`, `outstanding`, `in_sync`.
* The identity `Opening + Debits − Credits = Current` is computed **in SQL** from the ledger
  rows and compared with the stored balance; `in_sync: false` is surfaced in the UI as a
  warning rather than hidden.
* `MAX_LEDGER_AMOUNT` is enforced on payments, ledger entries and sale `paid`/`discount`, so an
  out-of-range amount is a clean `400` with a message instead of a `500`.
* `CustomersClient.jsx` shows the account summary strip, the identity line, Opening balance /
  Adjustment buttons, per-row labels, and a "Load earlier entries" control.

No arbitrary business limits were invented: `MAX_LEDGER_AMOUNT` is exactly the range the
existing `numeric(12,2)` columns can hold.

---

## 4. Root cause #3 — deployed performance

### How it was measured
`scripts/e2e/perf-audit.mjs` (new) hits every hot endpoint, reads
`pg_stat_statements` before/after to count statements per request, and reports p50/p95,
statement count, DB time and payload size. It was run twice on the **same build and the same
fixture** (803 products, 606 size rows, 200 customers, 9 001 sales): once against a local
PostgreSQL, once through a TCP proxy that adds a 20 ms round trip — which is what a deployed
app talking to Neon in another region actually experiences.

### The mechanism: round-trip multiplication
Locally every endpoint looked fine. Through the 20 ms link the same endpoints were 3–9×
slower, because each request issued its statements **serially**:

```
/api/dashboard              10 statements/req   31.4 ms local  →   92.2 ms @20 ms   (2.9×)
/api/products                3                  23.5           →  171.9             (7.3×)
/api/customers               2                   6.8           →   94.7            (13.9×)
/api/finance/balance-sheet   6                  12.7           →  140.7            (11.1×)
```

Latency, not query cost, was the deployed bottleneck: DB time was 0.6–41 ms per request while
wall time was 90–170 ms.

### Fixes
1. **Independent queries now run together** (`Promise.all`) instead of one after another —
   dashboard, balance sheet, sales, customers detail.
2. **The dashboard was 10 statements; it is now 4** (scalars in one query, three `json_agg`
   lists, one 365-day series) with identical output.
3. **Non-sargable date predicates.** `created_at::date = $1` and
   `date_trunc(...)` wrappers defeated every index. `lib/date-range.js` provides
   `dayGte/dayLte/dayLt/sameBusinessDay/sameBusinessMonth` that keep the column bare and put
   the arithmetic on the parameter. EXPLAIN evidence (9 001 sales):

   | query | before | after |
   | --- | --- | --- |
   | dashboard "today" | Seq Scan, 8 945 rows removed — **8.300 ms** | Index Scan on `sales_created_idx` — **0.129 ms** (64×) |
   | 365-day series | Seq Scan + Sort — **19.387 ms** | index-assisted |
   | receivables `MIN(created_at)` | correlated subquery, 1 257 buffer hits over 200 loops | one grouped aggregate |

   Equivalence was proved, not assumed: `/tmp`-side harness compared old and new predicates
   over **84 combinations × 6 timezones** (including UTC+14 and UTC−11) — **0 mismatches** —
   and confirmed the new plan is an Index Only Scan.
4. **Response compression.** `okGzip()` in `lib/validate.js` (gzip level 6, ≥ 1 kB, honours
   `Accept-Encoding`, sets `Vary`) applied to the 11 list endpoints. Measured on the wire:

   ```
   /api/products             630.0 KB →  42.3 KB   (93.3% smaller)
   /api/reports/inventory    102.6 KB →  14.6 KB   (85.7% smaller)
   /api/sales                 61.8 KB →   7.6 KB   (87.6% smaller)
   /api/customers             33.6 KB →   3.0 KB   (90.9% smaller)
   ```
   `compress: true` in `next.config.mjs` does **not** do this in Next.js 15 — the server no
   longer bundles the `compression` middleware, so the flag was inert for these responses.
   That is documented in `next.config.mjs` rather than left as a false reassurance.
5. **Connection handling.** `lib/db.js` now sets `keepAlive: true` and
   `connectionTimeoutMillis: 10_000`, so an idle connection dropped by a NAT/load balancer is
   not discovered by paying a full reconnect, and an unreachable database fails fast.
6. **Client-side waste removed.** `lib/api-client.js` cached the *string* and re-parsed it on
   every read (`JSON.parse` 2.7 ms + `JSON.stringify` 2.0 ms measured per call on the products
   payload); it now caches the parsed value. `PosClient.jsx` rebuilt a product index by
   scanning the full list on every keystroke and quantity change; it now uses one memoised
   `Map`.
7. **Indexes — only where a query pattern justifies them.** Of 48 existing indexes, two were
   added: `customer_transactions(created_at)` (the ledger's `ORDER BY created_at DESC, id DESC`)
   and `purchase_payments(payment_date)` (payables/account queries filter and sort on it).
   Explicitly **rejected** after profiling: `sales(customer_id)` (only used in a `NOT EXISTS`
   in `data/clear`), `products(name)` (in-memory sort of 803 rows measured at 0.771 ms), and
   `customers(outstanding_balance)` (200 rows).

### What was investigated and deliberately **not** changed
* **Bundle size is not the problem** — First Load JS is 103–120 kB per route.
* **No result caching was added for POS or financial data.** The 8-second client cache that
  already existed was kept, and nothing else was cached, because stale stock or balances are
  worse than a slower request.
* **A session+settings query merge was tried and reverted.** Profiling showed the statement
  count did not drop (Next.js instantiates the module twice per request, so React's `cache()`
  does not dedupe across the two import sites). Shipping complexity without a measured gain
  was not acceptable, so `lib/session.js` and `lib/settings.js` are unchanged.

---

## 5. Regression audit of the chain

Item → Category → Variant(size) → Cost → Inventory → Dashboard was re-checked after the fixes:

* create / edit / delete / add a size → the total moves by exactly the delta (verified below)
* `products.stock` mirror stays consistent with the size rows
* the dashboard total tracks edits immediately, with no reload
* deleting a category/product cascades without leaving orphan value
* blank, zero and decimal costs are all safe
* POS cart, search, quantity and checkout paths were re-run through the API suite
* auth, roles, permissions, shifts, purchases, vendors, expenses, reports, settings and the
  data-clear endpoints are covered by the existing 203-assertion smoke suite, which still passes

---

## 6. Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| Build | `npm run build` | ✓ Compiled successfully |
| Migrations on a virgin database | `node scripts/migrate.mjs` (001–009) | all 9 applied, seed OK |
| Existing API regression suite | `node scripts/smoke.mjs` | **203 passed, 0 failed** |
| New acceptance suite | `node scripts/e2e/total-cost-ledger.mjs` | **71 passed, 0 failed** |
| Performance | `node scripts/e2e/perf-audit.mjs` | before/after tables above |
| Wire compression | `curl` with/without `Accept-Encoding: gzip` | 85–93% smaller |

### The acceptance suite (`scripts/e2e/total-cost-ledger.mjs`)
Every API figure is cross-checked against an **independent SQL query** written from the data
model, so it cannot pass by agreeing with the application's own SQL. It covers:

* the brief's worked example — items 100 + 200 + 300 + 400 + 500 = **1 500** ✓
* a nested product with 500 ml / 1000 ml / 1500 ml sizes (plus a zero-cost size and a decimal
  cost), where the product-level cost is `0` — the old code reported **0**, the new code
  reports the true **959.52** ✓
* dashboard == balance sheet == inventory report == product list == database ✓
* category and sub-category scoped subtotals ✓
* editing a size cost moves the total by exactly the delta; deleting removes exactly its value;
  adding adds exactly its value ✓
* blank/zero/decimal costs contribute 0, never `NaN` ✓
* ledger: opening balance → 1 000; credit sale 10 000 paying 4 000 → 7 000; payments 3 000 and
  2 000 → 2 000; a second invoice of 20 000 with payments 5 000 + 5 000 + 3 000 → 9 000; all
  **five payments remain separate rows** ✓
* `Opening + Debits − Credits == stored balance`, and the running balance is correct on every
  row ✓
* a second opening balance → `409`; over-payment, zero, negative, absurd amount, missing
  method → `400`; an absurd sale `paid` is now a clean `400` (it used to be a `500`) ✓
* history pagination past 200 entries returns every entry exactly once ✓
* receivables total equals the sum of stored balances ✓
* a historical edit recalculates and the account stays in sync; explicit recalculation is
  idempotent ✓

---

## 7. Environment limitations — stated plainly

These are limits of this sandbox, not of the application. They are recorded so no claim is
overstated:

1. **`npm run build` cannot reach `fonts.googleapis.com`** here, so `next/font/google` fails.
   The build and every test were run with a temporary local shim for `Inter` in
   `app/layout.js`; **the shim has been reverted** and `git diff` confirms `app/layout.js` is
   byte-identical to the committed version. Only font loading is affected — no logic.
2. **Playwright browsers cannot be downloaded**, so the UI-level suites
   (`scripts/e2e/final-audit.mjs`, `phase5-ui.mjs`, `variant-ui.mjs`) could not be executed.
   Coverage here is API-level: the 203-assertion smoke suite plus the 71-assertion acceptance
   suite. The browser-side changes (`CustomersClient.jsx`, `InventoryClient.jsx`,
   `PosClient.jsx`) were verified by build + the API contracts they consume, **not** by driving
   a real browser.
3. **No real Neon instance was available.** Remote-database behaviour was reproduced with a
   TCP proxy adding a 20 ms round trip against a local PostgreSQL 17. That is a faithful model
   of round-trip multiplication, but it is not Neon's actual latency, cold-start or connection
   behaviour.

---

## 8. Genuine remaining issues

1. `products.variants` (a legacy JSONB column) is still present alongside `product_variants`.
   Nothing in the value calculation reads it, but it is dead weight and a future source of
   confusion. Removing it needs a data review, so it was left alone.
2. `InventoryClient.jsx` still requests the full product list (803 products) rather than
   paging. Compression takes it from 630 kB to 42 kB on the wire, but a catalogue that grows to
   tens of thousands of products will want server-side paging on that screen.
3. The UI suites listed in §7.2 are unexecuted in this environment and should be run in CI
   before release.
4. `scripts/smoke.mjs` is not idempotent — it creates fixed names, so a second run against the
   same database fails on `409 already exists`. Run it against a fresh database.

---

# Round 2 — lightweight pass (2026-10-01)

A second pass focused on round trips, payload size and frontend rendering,
after the first round had already fixed the total-cost rule, the ledger and the
dashboard/report queries.

## 9. The dominant production cost of checkout

`scripts/e2e/checkout-perf.mjs` (new) builds a real 4-line sale — two plain
products plus two sizes of one sized product — and counts the statements the
single `POST /api/sales` request executes.

```
BEFORE:  39 statements, wall p50 456.4 ms   (20 ms RTT database)
AFTER :  30 statements, wall p50 249.6 ms   (-45%)
```

Of those 39, **18 were foreign-key `FOR KEY SHARE` checks** that PostgreSQL runs
inside the parent INSERT — they ride along on the same round trip and cost no
extra latency. The application itself issued **21 round trips**, and 456 ms /
21 ≈ 21.7 ms, i.e. the wall time was *entirely* network round trips. On
localhost the same code is fast, which is exactly why this only shows up after
deployment.

What changed (identical values written, fewer trips):

| Before | After |
| --- | --- |
| `SELECT lpad(id,5,'0')` then `UPDATE sales SET sale_no` | one `UPDATE … SET sale_no = lpad(id::text,5,'0') … RETURNING` |
| one `INSERT INTO sale_items` **per cart line** | one multi-row INSERT |
| one `UPDATE products SET stock` **per product** | one `UPDATE … FROM unnest(ids[], qtys[])` |
| one `INSERT INTO stock_movements` **per product** | one multi-row INSERT |
| one `UPDATE product_variants SET stock` **per size** | one `UPDATE … FROM unnest(…)` |

The old code had two separate branches for the variant deduction (single-size
and mixed-size sales). Both reduce to "deduct each size by its own accumulated
quantity" — in the single-size case that size's accumulated quantity *is* the
product total — so one rule now covers both. This equivalence is asserted by the
203-assertion smoke suite (stock levels, one movement per sale, variant sales)
and the 71-assertion acceptance suite, both re-run after the change.

## 10. Three more N+1 write paths

| Path | Before | After |
| --- | --- | --- |
| `PUT /api/users/:id` (permissions) | one INSERT **per permission** | one multi-row INSERT |
| `POST /api/products`, `PUT /api/products/:id` (barcode uniqueness) | one query **per size** | one `unnest()` query for all sizes |
| `POST /api/import/apply` | one INSERT (+ one stock movement) **per CSV row** | validated up front, then 100-row batched INSERTs with a single batched stock-movement insert |

A 500-row CSV import previously made ~1000 round trips inside one transaction —
roughly 20 seconds against a remote database. Validation order is unchanged, so
the same row still produces the same error.

## 11. POS payload: only the fields the screen reads

`GET /api/products?view=pos` and `GET /api/customers?view=pos` return a
projection derived from what `components/pos/PosClient.jsx` and `lib/pricing.js`
actually read — not guessed. The POS never shows cost, stock value, category
names or the purchasing fields (reorder level, batch, supplier, tax), and it
filters by `category_id` from the category list it already has, so the category
join and the variant-aggregate lateral are not executed at all.

```
/api/products    630.0 KB -> 436.5 KB   (-30.7%)     gzipped 42 KB -> 26 KB
/api/customers    33.6 KB ->  20.9 KB   (-37.6%)
POS open total   663.6 KB -> 457.4 KB   (-31.1%)     p50 147.9 -> 131.6 ms
```

The default response is unchanged, so no admin screen or existing caller is
affected. The projection is verified at runtime: every field the POS and the
pricing module read is present, the heavy unused fields are gone, and a real
sale built from projection data is accepted (201).

## 12. POS grid: mounted cards were the per-keystroke cost

The grid rendered **every** matching product — 819 cards on the audited
catalogue — recomputing prices, expiry and stock badges for each on every
keystroke and category change. It now mounts 60 at a time, resetting when the
filter changes, with a "Show more" control and an always-visible
"Showing N of M (catalogue: T)". Search and the category filter still cover the
whole catalogue; nothing is hidden, only not mounted.

## 13. Investigated and deliberately not changed

* **Bundle size is not a problem.** First Load JS is 103 kB base / 103–118 kB
  per route; the only heavy dependency, `jsbarcode`, is already behind a dynamic
  import in the one screen that uses it. There is nothing to tree-shake or split
  that would be measurable.
* **No unused dependencies, components or modules.** Every entry in
  `package.json` is used (`react-dom` is a Next.js peer; `tailwindcss`/`postcss`
  are build-time), and a scan found no component or `lib/` module that nothing
  imports. Nothing was removed because nothing was unused.
* **A session+settings query merge was tried and reverted** — see §4. Profiling
  showed Next.js instantiates the module twice per request, so React's `cache()`
  never dedupes and the statement count does not drop.
* **The POS still loads the whole catalogue** rather than paging it. That is a
  deliberate trade: it keeps search and add-to-cart instant and offline-capable,
  and the projection plus the render cap remove the cost that mattered. A
  catalogue of tens of thousands of items would want server-side paging, and
  `?search=` / `?categoryId=` are already there to support it.

## 14. Verification for round 2

| Check | Result |
| --- | --- |
| `npm run build` | ✓ Compiled successfully |
| `scripts/smoke.mjs` on a virgin database | **203 passed, 0 failed** |
| `scripts/e2e/total-cost-ledger.mjs` | **71 passed, 0 failed** |
| `scripts/e2e/checkout-perf.mjs` | 456.4 ms → 249.6 ms, 39 → 30 statements |
| POS-view field audit | every required field present; sale from projection accepted |
| Payload sizes (identity + gzip via `curl`) | −30.7% products, −37.6% customers |

The same environment limitations from §7 still apply: no browser automation
(Playwright will not download here), so the grid change is verified by build and
code review rather than by driving a real browser; and remote-database latency is
modelled with a 20 ms TCP proxy rather than a real Neon instance.
