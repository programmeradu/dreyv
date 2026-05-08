-- Migration 0005: Add evm_wallet_address to users (read-only EVM link)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "evm_wallet_address" text;

CREATE INDEX IF NOT EXISTS "users_evm_wallet_idx" ON "users" ("evm_wallet_address");
