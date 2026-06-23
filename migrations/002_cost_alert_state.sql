-- Migration: cost_alert_state — anti-spam state for the Discord budget alert (B5)
-- Date: 2026-06-22 · Reason: one-alert-per-UTC-day guard for the cost-forecast Discord alert (G5)
--
-- ADDITIVE ONLY. One new single-row table. No DROP/DELETE/ALTER of anything, and
-- NO change to cost_snapshots (B4/C1). Lives in the Hub-owned data/hub.db (NOT the
-- read-only trevor.db replica, which is atomically overwritten every tailsync cycle).
--
-- Single row, id=1 (CHECK pins it). cost_alert_notify.py records last_alert_date
-- ONLY after a successful Discord post, so a webhook failure leaves it untouched and
-- the next refresh retries. An empty table (no row yet) means "never alerted".
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS cost_alert_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row sentinel
    last_alert_date     TEXT,        -- 'YYYY-MM-DD' (UTC) of the last alert ACTUALLY sent
    last_forecast_usd   REAL,        -- the projected month-end $ at that alert
    last_threshold_usd  REAL,        -- the threshold it crossed
    updated_at          TEXT         -- ISO-8601 UTC of the last write
);
COMMIT;
