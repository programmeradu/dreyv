import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  
  console.log("Adding evm_wallet_address column...");
  try {
    await sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "evm_wallet_address" text`;
  } catch (err) {
    console.log("Column might already exist or error:", err.message);
  }

  console.log("Creating rent_contributions table...");
  await sql`
    CREATE TABLE IF NOT EXISTS "rent_contributions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "amount_usd" numeric NOT NULL,
      "amount_eur" numeric NOT NULL,
      "amount_minor" integer NOT NULL,
      "currency" text NOT NULL,
      "status" text NOT NULL,
      "payment_provider" text,
      "provider_invoice_id" text,
      "message" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log("Migration complete!");
}

run().catch(console.error);
