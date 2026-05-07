#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const url = process.env.DATABASE_URL;
const sql = neon(url);
const file = process.argv[2];
const ddl = readFileSync(file, 'utf8');
// Strip inline -- comments to keep single-statement parsing safe
const cleaned = ddl
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n');
const statements = cleaned.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
for (const stmt of statements) {
  console.log('»', stmt.slice(0, 100).replace(/\s+/g, ' '));
  await sql.query(stmt);
}
console.log('✓ applied');
