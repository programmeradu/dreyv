import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Prevent Next.js "server-only" module from crashing in Vitest
vi.mock("server-only", () => ({}));

function findApiRoutes(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findApiRoutes(fullPath, fileList);
    } else if (file === "route.ts" || file === "route.js") {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe("Next.js API Routes", () => {
  const apiDir = path.join(process.cwd(), "src/app/api");
  
  let routes: string[] = [];
  try {
    routes = findApiRoutes(apiDir);
  } catch (e) {
    console.warn("API directory not found or inaccessible", e);
  }

  it("should discover API routes", () => {
    expect(routes.length).toBeGreaterThan(0);
    console.log(`Discovered ${routes.length} API routes.`);
  });

  describe.each(routes)("Route: $route", (routeFile) => {
    it("should export standard HTTP methods", async () => {
      // We dynamically import the route to ensure it parses without syntax errors
      // and exports at least one standard HTTP method (GET, POST, PUT, DELETE, etc.)
      const route = await import(routeFile);
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"];
      
      const exportedMethods = Object.keys(route).filter(key => methods.includes(key));
      
      // Some routes might only export a default, but standard Next.js app dir routes
      // must export named HTTP methods.
      expect(exportedMethods.length).toBeGreaterThan(0);
    });
  });
});
