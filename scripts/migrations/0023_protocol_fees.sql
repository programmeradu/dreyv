-- Dreyv 0.05% protocol fee ledger
CREATE TABLE IF NOT EXISTS protocol_fees (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  parent_signature TEXT NOT NULL,
  fee_signature TEXT NOT NULL UNIQUE,
  operation TEXT,
  source TEXT NOT NULL DEFAULT 'commandbar',
  estimated_value_usd NUMERIC(20,6),
  fee_usd NUMERIC(20,8) NOT NULL,
  fee_lamports NUMERIC(20,0) NOT NULL,
  treasury_wallet TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_fees_wallet_idx ON protocol_fees(wallet_address, created_at);
CREATE INDEX IF NOT EXISTS protocol_fees_parent_sig_idx ON protocol_fees(parent_signature);
CREATE INDEX IF NOT EXISTS protocol_fees_created_at_idx ON protocol_fees(created_at);
