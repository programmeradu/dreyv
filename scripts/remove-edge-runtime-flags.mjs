import fs from "node:fs";
import path from "node:path";

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      let content = fs.readFileSync(fullPath, "utf8");
      if (content.includes('export const runtime = "edge"') || content.includes("export const runtime = 'edge'")) {
        content = content.replace(/export const runtime = ["']edge["'];?\r?\n?/g, "");
        fs.writeFileSync(fullPath, content, "utf8");
      }
    }
  }
}

processDir("src/app/api");
console.log("Finished removing explicit runtime edge flags from API routes.");
