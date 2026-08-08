import fs from 'node:fs';
import path from 'node:path';

const apiDir = path.resolve(process.cwd(), 'src/app/api');

function walk(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    if (f.isDirectory()) {
      walk(fullPath);
    } else if (f.isFile() && (f.name === 'route.ts' || f.name === 'route.js' || f.name === 'route.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('runtime = "edge"') && !content.includes("runtime = 'edge'")) {
        content = `export const runtime = "edge";\n` + content;
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Restored edge runtime flag in: ${fullPath}`);
      }
    }
  }
}

walk(apiDir);
console.log('Finished restoring edge runtime flags across src/app/api.');
