# Beverage POS

A simple, reliable, installable (PWA) beverage point of sale.

- **One application**, one login screen. The role decides the interface:
  - `admin / Admin123` → Admin dashboard + management
  - `cashier / Cashier123` → POS + sales history + account
- **Stack:** Next.js (App Router) + PostgreSQL (Neon) + Tailwind CSS.
- **Deploys to:** Vercel (serverless API routes) + Neon PostgreSQL. No VPS, no Docker, no Redis, no WebSockets, no background workers, no queues, no external services.

## Features

| Area | What it does |
| --- | --- |
| POS | Product search (barcode friendly), category filter, cart, quantity, discount, cash/card/other payment, customer paid + change, printable receipt |
| Products | Add / edit / disable, barcode, category, selling price, cost, stock, minimum stock |
| Categories | Add / rename / enable-disable (no destructive deletes) |
| Inventory | Current stock, low stock, manual adjustments (logged), per-product movement history |
| Vendors | Add / edit / enable-disable |
| Purchases | Record stock purchases; **stock increases automatically** (database transaction) |
| Sales | Transactional checkout; **stock decreases automatically**; admin filters by date / cashier / payment; CSV export |
| Daily Records | Sales, orders, purchases, cash/card/other, discounts — by business date |
| Reports | Daily sales, date range, by cashier, product sales, purchase summary, inventory summary — CSV export + copyable text summary |
| Users | Admin manages cashiers/admins (create, enable/disable, reset password). Last admin is protected |
| Settings | Business name, currency label, business timezone, receipt footer, manual CSV export |
| PWA | Web app manifest, service worker (app-shell caching only), install button when the browser offers it, standalone display |

**Deliberately omitted** (kept out to stay simple, safe and cheap to host):
refunds/returns, shifts, branches, CRM, offline sale sync, real-time WebSockets,
payment gateways, WhatsApp, cloud backups, analytics.

## Local development

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a PostgreSQL database** (Neon or local both work).

   For local development you can use any PostgreSQL 14+ instance.

3. **Configure environment**

   ```bash
   cp .env.example .env.local
   # set DATABASE_URL, e.g.:
   # DATABASE_URL=postgres://postgres:password@127.0.0.1:5432/beverage_pos
   ```

   `DATABASE_URL` is the **only** environment variable the app needs.

4. **Run the database migration** (additive, non-destructive, idempotent)

   ```bash
   npm run db:migrate
   ```

5. **Seed the initial accounts** (creates `admin` and `cashier` only if missing)

   ```bash
   npm run db:seed
   ```

6. **Start the app**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 and log in:

   | Role | Username | Password |
   | --- | --- | --- |
   | Admin | `admin` | `Admin123` |
   | Cashier | `cashier` | `Cashier123` |

   > Change these passwords after first login (Settings → My Account, or
   > Account page for cashiers).

## Deploy to Vercel + Neon

1. Create a project in [Neon](https://neon.tech) (PostgreSQL).
2. Push this repository to GitHub and import it in Vercel (framework: Next.js — auto-detected).
3. In Vercel, set the environment variable `DATABASE_URL` to your **Neon pooled
   connection string** (from the Neon console → Connection Details → Pooled).
   It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.region.aws.neon.tech/DBNAME?sslmode=require
   ```

4. Run the migration and seed once, against your Neon **direct** (non-pooled)
   connection string:

   ```bash
   npx vercel env pull .env.vercel   # pulls Vercel env vars (or copy them manually)
   DATABASE_URL="postgres://...direct-connection..." npm run db:migrate
   DATABASE_URL="postgres://...direct-connection..." npm run db:seed
   ```

5. Deploy:

   ```bash
   npx vercel --prod
   ```

That's it. Vercel hosts the app and the API; Neon hosts the data.

## PWA

- Open the site in Chrome/Edge (desktop) or Chrome (Android).
- When the browser offers installation, a clean **Install App** button appears at
  the bottom of the sidebar. The app then launches in standalone mode from the
  home screen / app launcher.
- The service worker caches only the app shell (static assets). It never caches
  API responses, sessions or credentials. Online operation is the primary mode;
  the offline shell is a convenience.
- Icons are generated with `npm run icons` (requires Python 3 + Pillow) and are
  already committed, so you normally do not need to regenerate them.

## Barcode scanning

Barcode scanners that act as keyboards work out of the box: keep the search box
focused, scan, and the product is added on Enter. You can also store a barcode
on each product; search matches name **or** barcode. No camera/hardware SDK.

## Reliability notes

- Sales and purchases run in **database transactions** (`BEGIN/COMMIT` with
  automatic rollback). A sale locks the products it touches (`SELECT ... FOR
  UPDATE`), re-computes prices on the server, and never allows stock below zero.
- Admin and cashier work simultaneously from the same database. No real-time
  service: the dashboard refreshes every 60 s, the POS product grid every 30 s,
  and every page refetches after its own actions. Use refresh if you need
  numbers immediately.
- Daily records and reports group by **business date** using the configured
  business timezone (default `Asia/Karachi`).
- Errors are user-friendly ("Invalid username or password.", "Product X is out
  of stock."). Technical details are logged server-side.
- Sessions are random tokens in the database behind an `httpOnly` cookie, valid
  7 days. Passwords are hashed with scrypt (no plaintext ever stored).

## Backup

Use **Neon's own backup/PITR features** for real backups. The CSV exports in
Settings are convenient working copies, not a disaster-recovery backup.

## Project structure

```
app/
  login/            single login screen
  pos/              POS (admin + cashier)
  sales/            sales list + receipt (cashier: own only)
  account/          cashier account page
  admin/            dashboard, products, categories, inventory,
                    purchases, vendors, daily, reports, users, settings
  api/              simple serverless API routes (validation + authz)
components/         small client components (POS, admin pages, UI kit)
lib/                db pool, sessions, password hashing, validation
db/schema.sql       additive schema (single initial migration)
scripts/            migrate.mjs, seed.mjs, make_icons.py
public/             manifest.webmanifest, sw.js, icons
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run the production build locally |
| `npm run db:migrate` | Apply additive schema migrations |
| `npm run db:seed` | Create the two initial accounts (if missing) |
| `npm run icons` | Regenerate PWA icons (Python 3 + Pillow) |
