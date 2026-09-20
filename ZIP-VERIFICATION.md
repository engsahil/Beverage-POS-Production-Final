# ZIP Verification — Beverage POS (Per-Item Pricing Modes + Cashier Minimums + Performance + Final Audit)

Archive: `Beverage-POS-PerItem-Pricing-Final.zip`

Supersedes `Beverage-POS-Pricing-Performance-Enhancement.zip` (previous delivery, retained for reference).

## Structure
- Source at the **archive root** — `package.json` is at the top level (no nested project folder).
- 166 files; ZIP integrity test (`unzip -t`) passes; full extraction verified non-empty (881 KB).

## Included
- `app/`, `components/`, `lib/`, `db/`, `scripts/`, `public/`
- `package.json`, `package-lock.json`, `next.config.mjs`, `jsconfig.json`,
  `postcss.config.mjs`, `.env.example`
- `db/schema.sql` + `db/schema-002.sql` … `db/schema-007.sql`
  - 006 (previous release): products.wholesale_price / products.special_price,
    product_variants.special_price, cashier_price_limits, sales.pricing_mode,
    sale_items.pricing_mode — additive
  - 007 (this release): widens the `sales_pricing_mode_check` constraint to add
    `'mixed'` (a sale storing per-line modes) — additive, non-destructive
- `lib/pricing.js` (priceForMode with fallback + `summarizeModes`)
- `components/pos/PosClient.jsx` (per-line mode control in the cart area,
  row selection, per-line mode tags, zero-network mode switching)
- `components/sales/Receipts.jsx` (per-line mode tags on mixed sales)
- `scripts/migrate.mjs` (migration runner; schema_migrations tracks 001–007)
- Regression test suites in `scripts/e2e/` (incl. `pricing-api.mjs`) and
  `scripts/smoke.mjs`
- `README.md`, `PHASE5-REPORT.md`, `ZIP-VERIFICATION.md`

## Excluded
- `node_modules/` (install with `npm ci`)
- `.next/` (build output; run `npm run build`)
- `.env.local` (environment-specific; copy `.env.example` and set `DATABASE_URL`)
- no secrets, passwords, temp files, debug logs, or build artifacts
  (verified by extraction scan: 0 forbidden entries)

## Runnability
Fresh extraction verified end-to-end:
1. `npm ci` (from package-lock) — clean install
2. `node scripts/migrate.mjs` — no-op on an already-migrated DB (idempotent,
   additive only; never drops or resets data)
3. `npm run build` — production build compiles with zero errors
   (✓ Compiled successfully in 4.8s)
4. `npm run start -- -p 3001` — boots; login, POS, products and sales APIs respond
5. Regression suites run green against the built app (see final report §H)

## Notes
- PostgreSQL required (development and testing verified on PostgreSQL 17).
- No new runtime dependencies were added by this release; `package-lock.json`
  is unchanged.
