import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const url = process.env.DATABASE_URL.replace(/['"\r\n]/g, '').trim();
const sql = neon(url);
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
// split on semicolons but keep simple statements
const stmts = text.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
for (const s of stmts) {
  console.log('>', s.slice(0, 80).replace(/\n/g, ' '));
  await sql.query(s);
}
console.log('OK');
