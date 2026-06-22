import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const sql = neon(process.env.DATABASE_URL.replace(/['"\r\n]/g,'').trim());
const file = process.argv[2];
const text = readFileSync(file, "utf8");

// Split on semicolons that are NOT inside $bootstrap$ ... $bootstrap$ dollar-quoted blocks.
function splitStatements(src) {
  const out = [];
  let buf = "";
  let i = 0;
  let inDollar = null;
  while (i < src.length) {
    if (!inDollar) {
      const m = src.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        inDollar = m[0];
        buf += inDollar;
        i += inDollar.length;
        continue;
      }
      if (src[i] === ";") {
        const stmt = buf.trim();
        if (stmt) out.push(stmt);
        buf = "";
        i++;
        continue;
      }
    } else {
      if (src.startsWith(inDollar, i)) {
        buf += inDollar;
        i += inDollar.length;
        inDollar = null;
        continue;
      }
    }
    buf += src[i++];
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

const stmts = splitStatements(text);
console.log(`Applying ${stmts.length} statements from ${file}…`);
for (let i = 0; i < stmts.length; i++) {
  const s = stmts[i];
  const preview = s.replace(/\s+/g, " ").slice(0, 100);
  try {
    await sql.query(s);
    console.log(`  [${i+1}/${stmts.length}] ok — ${preview}`);
  } catch (e) {
    console.error(`  [${i+1}/${stmts.length}] FAIL — ${preview}\n    ${e.message}`);
    process.exit(1);
  }
}
console.log("✅ All statements applied.");
