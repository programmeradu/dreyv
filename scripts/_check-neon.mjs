import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL.replace(/['"\r\n]/g,'').trim());
const rows = await sql`select tablename from pg_tables where schemaname='public' and tablename like 'public_api%' order by 1`;
console.log(rows.map(r=>r.tablename).join("\n"));
