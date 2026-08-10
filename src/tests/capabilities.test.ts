import { describe, it, expect } from "vitest";
import { capabilityRegistry, LEGACY_COMMAND_BAR_TOOL_IDS } from "../../src/lib/agents/capabilities/registry";
import { z } from "zod";

describe("Capability Registry", () => {
  const registry = capabilityRegistry();
  const capabilities = Array.from(registry.values());

  it("should load capabilities successfully", () => {
    expect(capabilities.length).toBeGreaterThan(0);
    console.log(`Loaded ${capabilities.length} capabilities from registry.`);
  });

  it("should contain all legacy command bar tool ids", () => {
    const missing = LEGACY_COMMAND_BAR_TOOL_IDS.filter((id) => !registry.has(id));
    expect(missing).toEqual([]);
  });

  describe.each(capabilities)("Capability: $id", (cap) => {
    it("should have a valid description and domain", () => {
      expect(cap.id).toBeDefined();
      expect(typeof cap.id).toBe("string");
      expect(cap.description).toBeDefined();
      expect(cap.description.length).toBeGreaterThan(5);
      expect(cap.domain).toBeDefined();
    });

    it("should declare sideEffects properly", () => {
      expect(["read", "sim", "write", "meta"]).toContain(cap.sideEffects);
    });

    it("should have valid sensitivity flags", () => {
      expect(["low", "medium", "high", "critical"]).toContain(cap.sensitivity);
    });

    it("should have a valid Zod schema", () => {
      expect(cap.inputSchema).toBeDefined();
      expect(typeof cap.inputSchema.parse).toBe("function");
    });

    it("should have an executor function", () => {
      expect(typeof cap.execute).toBe("function");
    });
  });
});
