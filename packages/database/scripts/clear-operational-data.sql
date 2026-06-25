-- ============================================================================
--  WMS — clear operational data  (database: king_wms)
-- ----------------------------------------------------------------------------
--  CLEARS : Items, Lots, Bins, Stock levels, ALL Stock Movements
--           (this includes Goods Receipts type 'GR' and Goods Issues 'GI'),
--           and Stock Counts (sessions + lines).
--  KEEPS  : Users (logins), Warehouses, AuditLog, and the schema/migrations.
--  Also resets every id counter back to 1 (RESTART IDENTITY).
--
--  HOW TO RUN: in pgAdmin on the server, open the Query Tool *connected to the
--  king_wms database*, paste this, and Execute.  ⚠ BACK UP THE DATABASE FIRST.
--
--  Tables are listed children-first; CASCADE also catches any FK child so the
--  order can't cause a "referenced by foreign key" error.
-- ============================================================================

TRUNCATE TABLE
  "StockMovementLine",
  "StockMovement",
  "StockLevel",
  "CountLine",
  "CountSession",
  "Lot",
  "Item",
  "Bin"
RESTART IDENTITY CASCADE;

-- Optional add-ons (uncomment inside the list above if you also want them):
--   "Warehouse"   -- wipe warehouse master too (then re-create warehouses)
--   "AuditLog"    -- wipe the activity history

-- Verify afterwards (all should be 0):
-- SELECT 'Item' AS t, count(*) FROM "Item"
-- UNION ALL SELECT 'Bin',                count(*) FROM "Bin"
-- UNION ALL SELECT 'Lot',                count(*) FROM "Lot"
-- UNION ALL SELECT 'StockLevel',         count(*) FROM "StockLevel"
-- UNION ALL SELECT 'StockMovement',      count(*) FROM "StockMovement"
-- UNION ALL SELECT 'StockMovementLine',  count(*) FROM "StockMovementLine"
-- UNION ALL SELECT 'CountSession',       count(*) FROM "CountSession"
-- UNION ALL SELECT 'CountLine',          count(*) FROM "CountLine";
