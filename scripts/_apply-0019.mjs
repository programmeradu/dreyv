import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
const sql = neon(url);
const text = readFileSync('scripts/migrations/0019_treasury_payments_ops.sql', 'utf8');
// Run as one transaction-ish blob
try {
  await sql.query(text);
  console.log('done');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
