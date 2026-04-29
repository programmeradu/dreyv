-- Phase 14 / Block B Step 3 — Treasury materialized views
--
-- Two daily roll-ups that drive the /app/analytics charts at scale.
-- Refreshed every 30 minutes by the `treasury-mv-refresh` Inngest watcher.
--
-- 1) mv_vault_pnl_daily
--    One row per (wallet, day) with signed USD impact bucketed by kind:
--    inflow / outflow / yield / fee. The Foresight engine reads this for
--    burn-rate priors instead of scanning the raw event stream.
--
-- 2) mv_vault_composition_daily
--    One row per (wallet, day, symbol) with the latest priced amount and
--    USD value drawn from the most recent snapshot of that day. Powers the
--    composition drift chart without an O(N) scan over snapshots.
--
-- Both views require a unique index for REFRESH MATERIALIZED VIEW
-- CONCURRENTLY (which is what the watcher uses on every tick after the
-- first one).

-- ─── MV 1: daily PnL by wallet ───────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_vault_pnl_daily AS
SELECT
  wallet_address,
  date_trunc('day', occurred_at)::date AS day,
  COALESCE(SUM(CASE WHEN kind = 'inflow'  THEN amount_usd END), 0) AS inflow_usd,
  COALESCE(SUM(CASE WHEN kind = 'outflow' THEN amount_usd END), 0) AS outflow_usd,
  COALESCE(SUM(CASE WHEN kind = 'yield'   THEN amount_usd END), 0) AS yield_usd,
  COALESCE(SUM(CASE WHEN kind = 'fee'     THEN amount_usd END), 0) AS fee_usd,
  COALESCE(SUM(amount_usd), 0)                                     AS net_usd,
  COUNT(*)                                                         AS event_count
FROM treasury_events
GROUP BY wallet_address, date_trunc('day', occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS mv_vault_pnl_daily_pk
  ON mv_vault_pnl_daily (wallet_address, day);

CREATE INDEX IF NOT EXISTS mv_vault_pnl_daily_day_idx
  ON mv_vault_pnl_daily (day DESC);

-- ─── MV 2: daily composition by wallet × symbol ──────────────────────
-- Picks the latest snapshot of each (wallet, day) and explodes its
-- jsonb composition array into one row per held symbol.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_vault_composition_daily AS
WITH latest_per_day AS (
  SELECT DISTINCT ON (wallet_address, date_trunc('day', captured_at))
    wallet_address,
    date_trunc('day', captured_at)::date AS day,
    captured_at,
    composition,
    total_usd
  FROM treasury_snapshots
  ORDER BY wallet_address, date_trunc('day', captured_at), captured_at DESC
)
SELECT
  l.wallet_address,
  l.day,
  COALESCE(elem->>'symbol', 'UNKNOWN')                                  AS symbol,
  COALESCE((elem->>'amount')::numeric, 0)                               AS amount,
  COALESCE((elem->>'priceUsd')::numeric, 0)                             AS price_usd,
  COALESCE((elem->>'valueUsd')::numeric, 0)                             AS value_usd,
  COALESCE((elem->>'isStable')::boolean, false)                         AS is_stable,
  l.total_usd                                                           AS day_total_usd
FROM latest_per_day l,
     LATERAL jsonb_array_elements(l.composition) AS elem
WHERE jsonb_typeof(l.composition) = 'array';

CREATE UNIQUE INDEX IF NOT EXISTS mv_vault_composition_daily_pk
  ON mv_vault_composition_daily (wallet_address, day, symbol);

CREATE INDEX IF NOT EXISTS mv_vault_composition_daily_day_idx
  ON mv_vault_composition_daily (day DESC);

-- Initial population so the first CONCURRENT refresh in the cron succeeds.
REFRESH MATERIALIZED VIEW mv_vault_pnl_daily;
REFRESH MATERIALIZED VIEW mv_vault_composition_daily;
