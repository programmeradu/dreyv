import { describe, it, expect } from "vitest";
import { getCapability } from "../lib/agents/capabilities/registry";
import type { CapabilityContext } from "../lib/agents/capabilities/types";

describe("E2E Read-Only Integration Suite", () => {
  // A robust mock context that mirrors a live frontend session
  const mockContext: CapabilityContext = {
    walletAddress: "DreyvDummyWalletAddress11111111111111111111111",
    rpcEndpoint: "https://api.mainnet-beta.solana.com",
    vaultState: {
      tokens: [
        { symbol: "USDC", amount: 10000, price: 1.0 },
        { symbol: "SOL", amount: 100, price: 150.0 },
        { symbol: "BONK", amount: 5000000, price: 0.000015 },
      ],
    },
    walletState: null,
    executionState: {},
    promptMode: "auto",
    isStudioBuildIntent: false,
    blockExecutionForBuildIntent: () => null,
    resolveSplitAmount: (token, amount) => ({ amount, adjusted: false, reason: undefined }),
  };

  it("should successfully execute risk_assessment with live mock data", async () => {
    const riskAssessment = getCapability("risk_assessment");
    expect(riskAssessment).toBeDefined();

    const result: any = await riskAssessment!.execute({ threshold: 40, minNotionalUsd: 100 }, mockContext);
    
    // Ensure the capability actually ran logic and didn't just return a mock shell
    expect(result.success).toBe(true);
    expect(result.operation).toBe("risk_assessment");
    expect(result.totalValue).toBeGreaterThan(0);
    expect(result.groups).toBeInstanceOf(Array);
    expect(result.groups.length).toBeGreaterThan(0);
    
    // Assert math logic ran correctly on our mock context
    const solGroup = result.groups.find((g: any) => g.group === "SOL+LSTs");
    expect(solGroup).toBeDefined();
    expect(solGroup.value).toBe(15000); // 100 SOL * $150
  });

  it("should successfully execute foresight_simulation (runway_projection)", async () => {
    const foresight = getCapability("foresight_simulation");
    expect(foresight).toBeDefined();

    const input = {
      scenario: "runway_projection",
      variables: { monthlyBurn: 5000 },
      timeframeMonths: 12
    };

    const result: any = await foresight!.execute(input, mockContext);

    expect(result.success).toBe(true);
    expect(result.operation).toBe("foresight_simulation");
    expect(result.runwayMonths).toBeDefined();
    
    // Treasury has $25,075 (10k USDC + 15k SOL + 75 BONK). Burn is 5k. Runway should be ~5-6 months.
    expect(result.runwayMonths).toBeGreaterThanOrEqual(5);
  });
});
