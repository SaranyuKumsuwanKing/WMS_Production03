# CONTEXT.md — KFT WMS

Source-of-truth spec for the King Furniture Thailand **Warehouse Management System**.
Live status & what's next live in **PROGRESS.md**. Thai-facing warehouse app; English code identifiers.

## What it is

Scan-driven warehouse stock control: items, bins, lots, on-hand stock, movements
(Goods Receipt, Goods Issue, Putaway, Transfer, Returns), cycle counts, and QR label
printing. Used on desktop browsers and Android kiosk scanners over the factory LAN.

Originally a Next.js + SQLite monolith; migrated to PostgreSQL and split into a
decoupled API + static frontend + native Android client.

## Architecture — 3 deployables + shared packages

- **Backend API** — Express 4 + **tsx** (runs TypeScript directly, no build step), port **4100**.
  Package `@king-wms/api` at `apps/backend`. Stateless **JWT Bearer** auth. Runs under PM2
  (process `king-wms-api`). `lib/*.ts` (logic) → `routes/*.router.ts` (auth + validation) →
  mounted in `src/index.ts`.
- **Frontend** — Next.js 16 App Router, **static export** (`output: 'export'`) → `apps/frontend/out`.
  Package `@king-wms/web`. React 19 + Tailwind v4. Served as static files by **IIS** (or `pm2 serve`).
  Calls the API cross-origin.
- **Android client** — native Kotlin/Compose + Retrofit/OkHttp, ZXing scanning, Device-Owner
  kiosk, at `android/`. Talks to the API over LAN; same Bearer token contract.
- **`packages/database`** (`@king-wms/database`) — Prisma 6 schema + migrations + generated client
  (`src/generated/client`); exports the shared prisma singleton + `Decimal`.

Monorepo: **pnpm + Turborepo**. `.npmrc` sets **`node-linker=hoisted`** → a single flat
`node_modules` at the repo root (no per-app `node_modules`).

## Stack

Next.js 16 (App Router, client pages, static export) · React 19 · Tailwind v4 · Express 4 ·
Prisma 6 · PostgreSQL 18 (single `public` schema) · tsx runtime · jose (JWT) + bcryptjs ·
client-side QR via `qrcode`. PM2 + IIS on Windows Server.

## Data model (`packages/database/prisma/schema.prisma`)

- **User** — username, passwordHash, role `ADMIN | OPERATOR`.
- **Warehouse** → Bins.
- **Bin** — warehouseId, code, `barcode` (unique), type `RECEIVING | STORAGE | QUARANTINE | RETURNS`.
- **Item** — `itemNumber` (unique), description, uom, category, inventoryType `RM | WIP | FG`,
  lotControlled, `barcode` (unique).
- **Lot** — itemId, lotCode, supplier, receivedDate. Unique (itemId, lotCode).
- **StockLevel** — (itemId, binId, lotId) unique, quantity `Decimal`, firstReceivedAt/lastReceivedAt.
  A **materialized cache**; the StockMovementLine ledger is the source of truth.
- **StockMovement** — type `GR | GI | PUTAWAY | TRANSFER | COUNT_ADJUST | RETURN`, `reference`, userId → lines.
- **StockMovementLine** — movementId (cascade), itemId, binId, lotId, qtyDelta `Decimal`.
- **CountSession** / **CountLine** — cycle counts.
- **AuditLog** — userId, action, entity, entityId, detail (JSON string).

Quantities are `Decimal`; statuses/types are validated Strings (not native enums); timestamps UTC.

## Auth invariants (do not break)

- Stateless **JWT Bearer**. `POST /api/auth/login` → `{ token, user }`; clients send
  `Authorization: Bearer <token>`. Logout = client drops the token.
- Every API route uses `requireUser(req)` / `requireAdmin(req)` (`apps/backend/src/lib/auth.ts`).
  No/invalid token → 401. **This is the real security boundary.**
- Frontend keeps the token in `localStorage['wms_token']` (`lib/auth-client.ts`); `lib/client.ts`
  attaches the header and redirects to `/login` on 401.
- All app pages render inside `components/shell.tsx`, which redirects to `/login` when there's no
  signed-in user. Never render app content outside Shell.
- Android keeps the token in SharedPreferences; an OkHttp interceptor adds the Bearer header
  (`android/.../data/Api.kt`).

## Conventions

- Backend JSON envelope: `{ success, data, meta? }` / `{ success:false, error:{ code, message } }`
  (`lib/http.ts` `ok`/`wrap`).
- Frontend: client pages under `app/(app)/<module>` (inside Shell), `app/login`, `app/print`.
  Shared UI in `components/ui.tsx` (Button/Input/Select/Field/Card/Badge…) + `Modal`. Data via
  `lib/client.ts` (`apiGet/apiPost/apiPatch/apiUpload`) — **plain fetch, not TanStack Query**.
  Pagination via `components/pagination.tsx` (client-side, **12/page**).
- **Static-export rules:** no dynamic `[param]` routes — detail screens use a static `…/view` page
  reading `?id=` via `useSearchParams` (wrapped in `<Suspense>`). `trailingSlash: true`,
  `images.unoptimized`. **`NEXT_PUBLIC_API_URL` is baked at BUILD time.** IIS needs `web.config`
  (kept in `public/`, auto-copied into `out/`).
- `next build` type-checks strictly — run a build before shipping.

## Run locally (Windows, no Docker)

```powershell
cd "D:\Stefan Project\WMS_Production03"
pnpm install      # hoisted; runs prisma generate
pnpm dev          # turbo: API :4100 + Next dev :3000
```

- `pnpm dev` is **development** — Next compiles each page on first visit (slow); not
  representative of production speed. Judge speed from the built `out/` on the server.
- Production frontend = `pnpm --filter @king-wms/web build` → `apps/frontend/out`.
- DB: PostgreSQL 18, database `king_wms`, login role `pgAdmin`. **Credentials live only in
  `apps/backend/.env` and `packages/database/.env` (gitignored) — never copied into docs.**
- Dev login = the seeded admin user (see `apps/backend/src/seed.ts`).

## Production deployment (Windows server)

- Server local path `D:\stefan_project\WMS_Production03` — reached from the dev PC as the mapped
  drive **`Y:\WMS_Production03`**. **Flat layout:** `backend\`, `frontend\` (no `apps/`).
- LAN address **10.66.20.34**. Frontend on **:3006** (IIS or `pm2 serve`); API on **:4100**
  (PM2 `king-wms-api`, tsx). PostgreSQL 18 + `king_wms` run on the server. The server has **no pnpm**.
- Backend is shipped as a **self-contained bundle** built on the dev PC:
  `pnpm --filter @king-wms/api --prod=false --config.node-linker=hoisted deploy <relative-dir>`
  → flat, symlink-free `node_modules` (tsx + `@king-wms/database` baked in as real files; the
  injected pkg's `prisma generate` postinstall fails harmlessly — the Windows client is already copied).
- `NEXT_PUBLIC_API_URL=http://10.66.20.34:4100` baked via `apps/frontend/.env.production`. Server
  `backend/.env` `CORS_ORIGIN` includes `http://10.66.20.34:3006`. Firewall: open TCP **3006 + 4100**.

## Deploy workflow (project rule — do NOT auto-copy to the server)

Make and verify all changes **locally** in `D:\Stefan Project\WMS_Production03`; the user copies to
`Y:\…` manually. By change type:

| Change                                 | Copy / action                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Backend **code** (no new deps)         | `apps\backend\src` → server `backend\src`, then `pm2 restart king-wms-api`. Leave server `.env`/`node_modules` alone.         |
| Backend **dependency** / Prisma client | rebuild the self-contained bundle, recopy `node_modules`.                                                                     |
| **Frontend**                           | `pnpm --filter @king-wms/web build`, copy `apps\frontend\out` → server `frontend`, hard-refresh.                              |
| **DB schema**                          | new folder appears under `packages/database/prisma/migrations/`; run `prisma migrate deploy` (or apply SQL) on the server DB. |
| **Android**                            | rebuild + install APK from Android Studio (Sync Gradle → Run ▶); set device server to `http://10.66.20.34:4100`.              |

## Useful scripts

- `packages/database/scripts/clear-operational-data.sql` — TRUNCATE Items/Lots/Bins/Stock/Movements/Counts
  (keeps Users + Warehouses), resets id counters. Run in pgAdmin against `king_wms` **after a backup**.

## Gotchas

- pnpm `node-linker=hoisted`: deps live in the **root** `node_modules`. Never copy `node_modules`
  between machines — rebuild the bundle on/for the target.
- Renaming the repo folder breaks pnpm's absolute workspace symlinks → re-run `pnpm install`.
- Changing the **API** port → edit `.env.production` + rebuild the frontend. Changing the **Web UI**
  port → only the serving port + `CORS_ORIGIN` + `pm2 restart king-wms-api` (no rebuild).
