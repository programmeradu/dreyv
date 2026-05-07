#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }
const sql = neon(url);
const file = process.argv[2] || 'migrations/sql/0023_email_preferences.sql';
const ddl = readFileSync(file, 'utf8');
// neon-http can't run multi-statement transactions in one go; split on ; at line end.
const statements = ddl
  .split(/;\s*$/m)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('--'));
for (const stmt of statements) {
  console.log('»', stmt.slice(0, 80).replace(/\s+/g, ' '));
  await sql.query(stmt);
}
console.log('✓ applied');
