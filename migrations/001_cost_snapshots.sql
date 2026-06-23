-- Migration: cost_snapshots cache for Hub cost tracker
-- Date: 2026-06-22 · Reason: cache daily GCP cost data for the history graph (G7 / C1)
--
-- ADDITIVE ONLY. One new table + two indexes. No DROP/DELETE/ALTER of anything.
-- Lives in the Hub-owned data/hub.db (NOT the read-only trevor.db replica, which
-- is atomically overwritten every tailsync cycle and would destroy this table).
-- B4 populates it from BigQuery via UPSERT on the UNIQUE(snapshot_date,service,sku) key.
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS cost_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date  TEXT    NOT NULL,            -- ISO date this row's cost is FOR (usage day)
    service        TEXT    NOT NULL,            -- GCP service.description (e.g. 'Cloud Storage')
    sku            TEXT    DEFAULT '',          -- optional sku.description for per-resource detail
    net_cost_usd   REAL    NOT NULL DEFAULT 0,  -- net cost (cost + credits) for that service/day
    gross_cost_usd REAL    NOT NULL DEFAULT 0,  -- gross before credits
    fetched_at     TEXT    NOT NULL,            -- when this snapshot was pulled from BigQuery
    UNIQUE(snapshot_date, service, sku)         -- one row per service/sku/day; upsert-friendly
);
CREATE INDEX IF NOT EXISTS idx_cost_snap_date ON cost_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_cost_snap_service ON cost_snapshots(service);
COMMIT;
