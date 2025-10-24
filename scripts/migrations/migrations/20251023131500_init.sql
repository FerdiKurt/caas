-- extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- protocols
CREATE TABLE IF NOT EXISTS protocols (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  tier        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- tx_events (one row per wrapper event)
CREATE TABLE IF NOT EXISTS tx_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id  uuid NOT NULL REFERENCES protocols(id),
  chain_id     integer NOT NULL,
  tx_hash      text NOT NULL,
  block_number bigint,
  gas_used     bigint,
  payload      jsonb,
  observed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_tx_events_tx_hash ON tx_events (tx_hash);

-- emissions (calculated from tx_events)
CREATE TABLE IF NOT EXISTS emissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_event_id   uuid NOT NULL UNIQUE REFERENCES tx_events(id),
  kg_co2e       double precision NOT NULL,
  calc_version  text NOT NULL,
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- offset orders (mock vendor settles immediately)
CREATE TABLE IF NOT EXISTS offset_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id          uuid NOT NULL REFERENCES protocols(id),
  tx_event_id          uuid NOT NULL REFERENCES tx_events(id),
  target_kg_co2e       double precision NOT NULL,
  purchased_kg_co2e    double precision NOT NULL,
  vendor               text,
  product_type         text,
  status               text,
  cost_usd             double precision,
  created_at           timestamptz NOT NULL DEFAULT now()
);
