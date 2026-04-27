import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
const sql = neon(url);
const text = readFileSync('/dev-server/scripts/migrations/0019_treasury_payments_ops.sql', 'utf8');
const statements = text.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('--'));
for (const stmt of statements) {
  try { await sql(stmt); console.log('OK:', stmt.slice(0, 60).replace(/\s+/g, ' ')); }
  catch (e) { console.error('FAIL:', stmt.slice(0, 80), '\n  ->', e.message); process.exit(1); }
}
console.log('done');
