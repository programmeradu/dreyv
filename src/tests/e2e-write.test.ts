import { describe, it, expect } from "vitest";
import { getCapability } from "../lib/agents/capabilities/registry";
import type { CapabilityContext } from "../lib/agents/capabilities/types";
import { Keypair, Transaction } from "@solana/web3.js";

describe("E2E Write Integration Suite (Devnet)", () => {
  // Generate a random wallet for the test. We do not need it to be funded
  // because we are only testing the Transaction construction logic, not broadcasting.
  const dummyWallet = Keypair.generate();
  const dummyRecipient = Keypair.generate();

  const mockContext: CapabilityContext = {
    walletAddress: dummyWallet.publicKey.toBase58(),
    rpcEndpoint: "https://api.devnet.solana.com", // Target devnet for write tests
    vaultState: null,
    walletState: null,
    executionState: {},
    promptMode: "auto",
    isStudioBuildIntent: false,
    blockExecutionForBuildIntent: () => null,
    resolveSplitAmount: (token, amount) => ({ amount, adjusted: false, reason: undefined }),
  };

  it("should successfully build a SOL transfer transaction", async () => {
    const transfer = getCapability("transfer");
    expect(transfer).toBeDefined();

    const input = {
      token: "SOL",
      amount: 1.5,
      recipient: dummyRecipient.publicKey.toBase58(),
    };

    const result: any = await transfer!.execute(input, mockContext);
    
    // Ensure the transaction was built successfully
    expect(result.success).toBe(true);
    expect(result.operation).toBe("transfer");
    expect(result.status).toBe("READY_FOR_SIGNATURE");
    expect(result.serializedTransactions).toBeDefined();
    expect(result.serializedTransactions.length).toBe(1);

    // Verify it deserializes into a valid Solana transaction
    const txBuffer = Buffer.from(result.serializedTransactions[0], "base64");
    const tx = Transaction.from(txBuffer);
    expect(tx.instructions.length).toBe(1);
    expect(tx.feePayer?.toBase58()).toBe(dummyWallet.publicKey.toBase58());
  });

  it("should successfully build a create_multisig transaction (Squads v4)", async () => {
    const createMultisig = getCapability("create_multisig");
    expect(createMultisig).toBeDefined();

    const input = {
      members: [dummyRecipient.publicKey.toBase58()],
      threshold: 2, // 2-of-2 (creator + recipient)
      timeLock: 0,
    };

    const result: any = await createMultisig!.execute(input, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.operation).toBe("create_multisig");
    expect(result.status).toBe("READY_FOR_SIGNATURE");
    expect(result.serializedTransactions).toBeDefined();
    expect(result.serializedTransactions.length).toBe(1);
    expect(result.extraSigners).toBeDefined(); // Ephemeral Squads createKey
    expect(result.vaultPda).toBeDefined();

    const txBuffer = Buffer.from(result.serializedTransactions[0], "base64");
    const tx = Transaction.from(txBuffer);
    // Squads V4 multisig create uses multiple instructions or a large inner one
    expect(tx.instructions.length).toBeGreaterThanOrEqual(1);
  });
});
