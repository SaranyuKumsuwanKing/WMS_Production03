# PROGRESS.md — KFT WMS

Live status & what's next. Full spec in **CONTEXT.md**. _Last updated: 2026-06-26._

## Status

**In production** on the Windows server (10.66.20.34) — backend under PM2 (`king-wms-api`, :4100),
static frontend served on :3006, PostgreSQL 18 (`king_wms`) on the server. Active feature work
continues; deploys are done **manually by the user** (never auto-copied — see CONTEXT.md).

## Done

- **Postgres migration** — SQLite → PostgreSQL 18 (`king_wms`); Serializable inventory engine + retry.
- **FE/BE split** — decoupled Express API (~44 routes / 15 routers) + static Next export + JWT Bearer
  auth. Backend feature-complete; frontend migrated and builds.
- **Production deploy** — self-contained backend bundle (no pnpm needed on server) under PM2; static
  `out/` frontend; DB on server. CORS + firewall configured for 10.66.20.34.
- **Android cookie → Bearer (code done)** — `LoginResponse.token`, `SessionManager.token`, OkHttp
  Bearer interceptor, in-app server address. **APK rebuild + install on devices still pending.**
- **Recent features (2026-06-24 → 26):**
  - **Print labels** — QR generated client-side (`components/qr-image.tsx`); fixed **8cm × 5cm** label,
    bigger solid-black text, no frame when printing (`globals.css` `.label-card`, `public/web.config`).
  - **Nav loader** — `components/nav-progress.tsx` (link-click based; no `history.pushState` patch).
  - **Stock page** — split **Item** (code) and **Description** into separate columns; new **Reference**
    column = the reference from the latest movement per item+bin+lot (backend `lib/stock.ts`).
  - **Android "Scan item"** — each lot now shows **on-hand quantity** (backend `lookup.router.ts`).
  - **Pagination — 12 / page** on Stock, Cycle Count, Movements, Items, Warehouses, Bins
    (`components/pagination.tsx`, client-side).

## Pending deploy (user copies manually)

- **Frontend** `apps\frontend\out` → server `frontend` — carries Stock columns, nav-loader fix,
  pagination, and the label changes. Hard-refresh after.
- **Backend** `apps\backend\src` → server `backend\src` + `pm2 restart king-wms-api` — carries the
  Stock **Reference** data + Android **lot-quantity** API. (Skip if already deployed.)
- **Android APK** — rebuild + install (Bearer auth + lot quantity).

## Next / backlog

- (Optional) `web.config` gzip/brotli + cache headers for the static frontend — **user is doing this
  themselves**; offer to bake it into `public/web.config` so it survives `out` copies.
- (Optional) **True server-side pagination** for Stock/Items if data outgrows the current fetch cap
  (those endpoints already cap + show a "showing first N" banner).
- Browser click-through QA of the static `out/`.
- Git: consolidation/decision — **organization GitHub only** (King Living org account; personal
  GitHub is not allowed).
- (Optional) pin quantity columns to `@db.Decimal(18,4)`.

## Notes / gotchas

- `pnpm dev` is slow per page (on-demand compilation) — that's dev only; the built `out/` on the
  server is fast.
- No DB schema changes in the recent work → **no migration to apply**. A new folder under
  `packages/database/prisma/migrations/` is the signal that the server DB needs `prisma migrate deploy`.
- Don't copy `node_modules` between machines (hoisted pnpm) — rebuild the bundle.
