import {
    Connection,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { SquadsClient } from "./squads";
import { AppEventBus } from "./events";
import { IntentRegistry } from "./agents/registry";
import { PluginRegistry } from "./plugins/registry";
import { JinaClient } from "./jina";
import { FirecrawlClient } from "./firecrawl";
import { TavilyClient } from "./tavily";
import { HeliusClient } from "./helius";
import { KnowledgeBase } from "./knowledge";
import { simulationFirewall } from "./studio/simulation-firewall";
import { DEFAULT_POLICY, FirewallBlockedError, enforce, enforceProgramAllowlist } from "./firewall/policy";
import {
    flattenJupiterInstructions,
    resolveLookupTables,
    type JupiterSwapInstructionsResponse,
} from "./firewall/instruction-deserializer";

export interface ActionContext {
    connection: Connection;
    wallet: any;
    squadsClient: SquadsClient;
    heliusClient?: HeliusClient;
    vaultAddress: string;
}

export async function executeAction(plan: any, context: ActionContext): Promise<string> {
    const { actions } = plan;

    if (!actions || !Array.isArray(actions)) {
        // Fallback for single operation plans if any still exist
        return executeSingleAction(plan.operation, plan.parameters, context, plan);
    }

    const results = [];
    const txOps = new Set(["swap", "transfer", "stake", "bridge", "yield_deposit", "yield_withdraw"]);

    for (const action of actions) {
        const op = action.operation.toLowerCase();

        // Simulation Firewall: log pre-execution check for transaction-producing ops
        if (txOps.has(op)) {
            // Full transaction simulation happens after the tx is built — see SimulationFirewall.simulate()
            // Pre-check: ensure the operation has required parameters
            if (op === "swap" && (!action.parameters?.inputToken || !action.parameters?.outputToken)) {
                throw new Error(`Simulation Firewall BLOCKED: swap missing inputToken/outputToken`);
            }
            if (op === "transfer" && !action.parameters?.recipient) {
                throw new Error(`Simulation Firewall BLOCKED: transfer missing recipient`);
            }
        }

        const result = await executeSingleAction(action.operation, action.parameters, context, plan);
        results.push(result);
    }

    return results.join(" | ");
}

async function executeSingleAction(operation: string, parameters: any, context: ActionContext, plan: any): Promise<string> {
    switch (operation.toLowerCase()) {
        case "swap":
            return executeSwap(parameters, context);
        case "transfer":
            return executeTransfer(parameters, context);
        case "navigate":
            AppEventBus.emit("NAVIGATE", parameters.path);
            return `Navigating to ${parameters.path}`;
        case "refresh":
            AppEventBus.emit("REFRESH_DASHBOARD");
            return "Dashboard refresh triggered";
        case "ui_query":
            AppEventBus.emit("UI_NOTIFICATION", { message: plan.estimatedOutcome });
            return "Query processed";
        case "governance_list":
            const proposals = await context.squadsClient.getProposals(context.vaultAddress);
            const proposalSummary = proposals.map(p => `#${p.index}: ${p.title} (${p.status}) - ${p.signatures}/${p.threshold}`).join("\n");
            AppEventBus.emit("UI_NOTIFICATION", { message: `Pending Proposals:\n${proposalSummary}` });
            return proposalSummary;
        case "governance_approve":
            return await context.squadsClient.voteOnProposal(context.vaultAddress, parameters.proposalIndex, "Approve");
        case "governance_reject":
            return await context.squadsClient.voteOnProposal(context.vaultAddress, parameters.proposalIndex, "Reject");
        case "governance_execute":
            return await context.squadsClient.executeProposal(context.vaultAddress, parameters.proposalIndex);
        case "external_balance":
            const pubkey = new PublicKey(parameters.address);
            const balance = await context.connection.getBalance(pubkey);
            const solBalance = balance / LAMPORTS_PER_SOL;
            AppEventBus.emit("UI_NOTIFICATION", { message: `Balance for ${parameters.address}: ${solBalance.toFixed(4)} SOL` });
            return `${solBalance} SOL`;
        case "bridge":
            return await context.squadsClient.createVaultTransaction(
                context.vaultAddress,
                [], // instructions
                0,
                `Bridge ${parameters.amount} ${parameters.token} from ${parameters.sourceChain} to ${parameters.destinationChain}`
            );
        case "yield_deposit":
            return await context.squadsClient.createVaultTransaction(
                context.vaultAddress,
                [], // instructions
                0,
                `Deposit ${parameters.amount} ${parameters.token} into ${parameters.protocol} for yield`
            );
        case "yield_withdraw":
            return await context.squadsClient.createVaultTransaction(
                context.vaultAddress,
                [], // instructions
                0,
                `Withdraw ${parameters.amount} ${parameters.token} from ${parameters.protocol}`
            );
        case "rebalance":
            const { targetAllocations } = parameters;
            const rebalanceSummary = Object.entries(targetAllocations)
                .map(([token, percent]) => `${token}: ${percent}%`)
                .join(", ");
            AppEventBus.emit("UI_NOTIFICATION", { message: `Rebalancing started: ${rebalanceSummary}` });
            return await context.squadsClient.createVaultTransaction(
                context.vaultAddress,
                [],
                0,
                `Rebalance portfolio to: ${rebalanceSummary}`
            );
        case "monitor":
            const intent = IntentRegistry.register({
                type: parameters.type === "PRICE" ? "PRICE_ALERT" : "BALANCE_THRESHOLD",
                condition: {
                    target: parameters.target,
                    operator: parameters.operator,
                    value: parameters.value
                },
                actions: []
            });
            AppEventBus.emit("UI_NOTIFICATION", { message: `Agent Monitor Active: ${parameters.target} ${parameters.operator} ${parameters.value}` });
            return `Monitor ID: ${intent.id}`;
        case "plugin_register":
            // Infinite Discovery Stack (Phase 10.3)
            let learnedIntelligence = "";
            if (parameters.discoveryUrl || parameters.searchQuery || parameters.name) {
                try {
                    const knowledgeBase = new KnowledgeBase();
                    const query = parameters.searchQuery || `${parameters.name} Solana protocol SDK documentation`;
                    const research = await knowledgeBase.study(query);

                    if (research.rawContent) {
                        learnedIntelligence = research.rawContent;

                        // Auto-enrich operations from learned intelligence if not provided
                        if (!parameters.operations || parameters.operations.length === 0) {
                            parameters.operations = [{
                                name: `${parameters.name}_default`,
                                description: research.summary || `Interact with ${parameters.name}`,
                                parameters: {}
                            }];
                        }
                        if (!parameters.description) {
                            parameters.description = research.summary || `Learned protocol: ${parameters.name}`;
                        }
                    }
                } catch (err) {
                    // Discovery Stack failed, register with provided data
                }
            }

            const plugin = PluginRegistry.register({
                name: parameters.name,
                description: parameters.description || `Learned protocol: ${parameters.name}`,
                programId: parameters.programId || "unknown",
                operations: parameters.operations || [],
                isLearned: true
            });
            AppEventBus.emit("UI_NOTIFICATION", {
                message: `God-Mode Active: Learned protocol ${plugin.name}${learnedIntelligence ? " (with intelligence)" : ""} (${plugin.programId.substring(0, 4)}...)`
            });
            return `Plugin Registered: ${plugin.id}`;
        default:
            // Dynamic Plugin Resolution Fallback
            const dynamicOp = PluginRegistry.findOperation(operation);
            if (dynamicOp) {
                // In a real execution, we would build a dynamic transaction using the programId and ABI
                // Here we simulate via Squads proposal
                return await context.squadsClient.createVaultTransaction(
                    context.vaultAddress,
                    [], // Instructions would be built dynamicly here
                    0,
                    `Execute ${dynamicOp.name} via Plugin ${dynamicOp.programId.substr(0, 6)}...`
                );
            }
            throw new Error(`Unsupported operation: ${operation}`);
    }
}

async function buildAndGateTransaction(
    instructions: TransactionInstruction[],
    context: ActionContext,
    quote?: any
): Promise<{ tx: VersionedTransaction; serialized: string }> {
    const { connection, vaultAddress } = context;
    const payer = new PublicKey(vaultAddress);

    const lookupTables = quote?._lookupTables || [];
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message(lookupTables);
    const tx = new VersionedTransaction(message);

    // Block transactions touching policy-blocked programs
    enforceProgramAllowlist(
        instructions.map((ix) => ix.programId.toBase58()),
        DEFAULT_POLICY
    );

    // Pre-flight quote validation (when applicable)
    const report = quote ? simulationFirewall.protect(quote) : null;

    // On-chain simulation — throws FirewallBlockedError on any failure
    const simResult = await simulationFirewall.simulate(tx, vaultAddress);

    // Hard policy enforcement — throws on violation
    enforce(report, simResult, DEFAULT_POLICY);

    return { tx, serialized: Buffer.from(tx.serialize()).toString("base64") };
}

async function executeSwap(params: any, context: ActionContext): Promise<string> {
    const { inputToken, outputToken, amount } = params;
    const { connection, squadsClient, vaultAddress } = context;

    const inputMint = inputToken === "USDC"
        ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        : "So11111111111111111111111111111111111111112";
    const outputMint = outputToken === "SOL"
        ? "So11111111111111111111111111111111111111112"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    const amountInSmallestUnit = Math.floor(amount * (inputToken === "USDC" ? 1e6 : 1e9));
    const jupiterApiKey = process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";
    const jupiterHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (jupiterApiKey) jupiterHeaders["x-api-key"] = jupiterApiKey;
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnit}&slippageBps=50`;

    // Fetch real Jupiter quote — fail-closed on any error (no mock fallback)
    const quoteRes = await fetch(quoteUrl, { headers: jupiterHeaders });
    if (!quoteRes.ok) {
        throw new FirewallBlockedError(
            `Jupiter quote fetch failed (${quoteRes.status}) — firewall blocked swap`
        );
    }
    const quoteData = await quoteRes.json();
    if (!quoteData || quoteData.error) {
        throw new FirewallBlockedError(
            `Jupiter quote error: ${quoteData?.error || "empty response"}`
        );
    }

    // Fetch real swap instructions
    const instructionsRes = await fetch("https://lite-api.jup.ag/swap/v1/swap-instructions", {
        method: "POST",
        headers: jupiterHeaders,
        body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: vaultAddress,
            wrapAndUnwrapSol: true,
        }),
    });
    if (!instructionsRes.ok) {
        throw new FirewallBlockedError(
            `Jupiter swap-instructions fetch failed (${instructionsRes.status})`
        );
    }
    const instructionsData = (await instructionsRes.json()) as JupiterSwapInstructionsResponse;
    if (instructionsData.error) {
        throw new FirewallBlockedError(`Jupiter swap-instructions error: ${instructionsData.error}`);
    }

    // Real instruction deserialization (no Buffer.from([]) placeholder)
    const realInstructions = flattenJupiterInstructions(instructionsData);
    const lookupTables = await resolveLookupTables(
        connection,
        instructionsData.addressLookupTableAddresses
    );

    // Build, simulate, and policy-gate the real transaction
    const { tx } = await buildAndGateTransaction(
        realInstructions,
        context,
        { ...quoteData, _lookupTables: lookupTables }
    );

    return await squadsClient.createVaultTransaction(
        vaultAddress,
        realInstructions,
        0,
        `Swap ${amount} ${inputToken} to ${outputToken} (firewall passed, ${realInstructions.length} ix)`
    );
}

async function executeTransfer(params: any, context: ActionContext): Promise<string> {
    const { recipient, token, amount } = params;
    const { squadsClient, vaultAddress } = context;

    if (!recipient) {
        throw new FirewallBlockedError("Transfer missing recipient");
    }
    if (token && token !== "SOL") {
        // SPL transfers require ATA resolution — out of scope for this hardening pass.
        // Fail-closed rather than silently building a wrong instruction.
        throw new FirewallBlockedError(
            `SPL token transfers (${token}) not yet supported by firewall path — use swap or vault tooling`
        );
    }

    const fromPubkey = new PublicKey(vaultAddress);
    const toPubkey = new PublicKey(recipient);
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

    const realInstructions = [
        SystemProgram.transfer({ fromPubkey, toPubkey, lamports }),
    ];

    await buildAndGateTransaction(realInstructions, context);

    return await squadsClient.createVaultTransaction(
        vaultAddress,
        realInstructions,
        0,
        `Transfer ${amount} SOL to ${recipient} (firewall passed)`
    );
}
