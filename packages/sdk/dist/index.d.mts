/**
 * @keystone-os/sdk — Type definitions for Keystone Studio Mini-Apps
 */
interface Token {
    symbol: string;
    name: string;
    balance: number;
    price: number;
    mint?: string;
    decimals?: number;
    logoURI?: string;
}
interface VaultState {
    activeVault: string;
    balances: Record<string, number>;
    tokens: Token[];
}
interface ObservabilityConfig {
    provider?: "langfuse" | "helicone";
    traceId?: string;
}
interface FetchOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    body?: unknown;
    observability?: ObservabilityConfig;
}
interface FetchResult<T = unknown> {
    data: T | null;
    error: string | null;
    loading: boolean;
    refetch: () => Promise<void>;
}
interface EventBus {
    emit: (type: string, payload?: unknown) => void;
}
interface SIWSState {
    signIn: () => Promise<{
        message: string;
        signature: string;
    }>;
    verify: (message: string, signature: string) => Promise<boolean>;
    session: {
        address: string;
        chainId: number;
    } | null;
}
interface ImpactReport {
    before: VaultState;
    after: VaultState;
    diff: {
        symbol: string;
        delta: number;
        percentChange: number;
    }[];
    simulationHash?: string;
    zkspProof?: string;
    carbonKg?: number;
    greenScore?: number;
    socialScore?: number;
    breakdown?: {
        symbol: string;
        protocol?: string;
        carbonKg?: number;
        score?: number;
    }[];
    recommendations?: string[];
}
interface JupiterSwapParams {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
}
interface JupiterSwapResult {
    swapTransaction: string;
    lastValidBlockHeight: number;
    prioritizationFeeLamports?: number;
    txid?: string;
}
interface YieldPath {
    protocol: string;
    apy: number;
    riskScore: number;
    tvl: number;
    instructions: unknown[];
}
interface AgentHandoffPayload {
    fromAgent: string;
    toAgent: string;
    context: Record<string, unknown>;
}

/**
 * Hook to access vault state (balances, tokens).
 * In Studio iframe, the host injects a version with live prices/logos.
 */
declare function useVault(): VaultState;

/**
 * Proxy-gated fetch. Routes through Keystone host — no direct fetch in sandbox.
 */
declare function useFetch<T = unknown>(url: string, options?: FetchOptions): FetchResult<T>;

declare const AppEventBus: EventBus;

/**
 * Lit Protocol-based encrypted secret management.
 * Wallet-based access control — only treasury owner can decrypt.
 */
interface UseEncryptedSecretResult {
    encrypt: (plaintext: string, keyId?: string) => Promise<string>;
    decrypt: (ciphertext: string, keyId?: string) => Promise<string>;
    loading: boolean;
    error: string | null;
}
declare function useEncryptedSecret(): UseEncryptedSecretResult;

/**
 * Solana ACE (Access Control Engine) integration.
 * Automated regulatory reporting and audit logging.
 */
interface ACEReportEntry {
    timestamp: string;
    action: string;
    actor: string;
    resource: string;
    allowed: boolean;
    policyId?: string;
}
interface UseACEReportResult {
    report: ACEReportEntry[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}
declare function useACEReport(options?: {
    since?: Date;
}): UseACEReportResult;

/**
 * Federated Handoff Protocol — Multi-Agent Handoff.
 * Triage → Lookup → Builder without losing state or new user handshake.
 */
interface UseAgentHandoffResult {
    handoffTo: (toAgent: string, context: Record<string, unknown>) => Promise<unknown>;
}
declare function useAgentHandoff(fromAgent: string): UseAgentHandoffResult;

interface UseMCPClientResult {
    call: (tool: string, params?: Record<string, unknown>) => Promise<unknown>;
    loading: boolean;
    error: string | null;
}
declare function useMCPClient(serverUrl: string): UseMCPClientResult;

/**
 * MCP (Model Context Protocol) Server.
 * Expose Mini-App tools to external MCP clients.
 */
interface MCPTool {
    name: string;
    description: string;
    params?: Record<string, {
        type: string;
        description?: string;
    }>;
}
interface UseMCPServerResult {
    registerTools: (tools: MCPTool[]) => void;
    handleCall: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
}
declare function useMCPServer(tools: MCPTool[], handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>): UseMCPServerResult;

/**
 * Sign-In With Solana — One-click auth with session persistence.
 */

declare function useSIWS(): SIWSState;

/**
 * Jupiter Swap — Deep routing with dynamic fee estimation.
 */

interface JupiterQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    routePlan: unknown[];
}
interface UseJupiterSwapResult {
    swap: (params: JupiterSwapParams) => Promise<JupiterSwapResult>;
    getQuote: (params: JupiterSwapParams) => Promise<JupiterQuote | null>;
    loading: boolean;
    error: string | null;
}
declare function useJupiterSwap(): UseJupiterSwapResult;

/**
 * Impact Report — Human-readable Before/After treasury snapshots.
 * Extends Simulation Firewall with verifiable state diff.
 */

interface UseImpactReportResult {
    report: ImpactReport | null;
    loading: boolean;
    error: string | null;
    simulate: (transaction: unknown) => Promise<ImpactReport>;
}
declare function useImpactReport(): UseImpactReportResult;

/**
 * Tax Forensics — Real-time tax basis and gain/loss for Solana assets.
 */
interface TaxLot {
    mint: string;
    amount: number;
    costBasis: number;
    acquiredAt: string;
}
interface TaxForensicsResult {
    lots: TaxLot[];
    totalCostBasis: number;
    unrealizedGainLoss: number;
    realizedGainLoss: number;
}
interface UseTaxForensicsResult {
    result: TaxForensicsResult | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}
declare function useTaxForensics(options?: {
    since?: Date;
}): UseTaxForensicsResult;

/**
 * Institutional Earn Stack — Jito MEV + Kamino yield optimization.
 * Risk-scored deployment paths.
 */

interface UseYieldOptimizerResult {
    paths: YieldPath[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}
declare function useYieldOptimizer(asset: string): UseYieldOptimizerResult;

/**
 * Gasless Transaction Hub — Treasury centralizes fee management.
 * Sub-wallets/DAO members don't need SOL for approved tasks.
 */
interface UseGaslessTxResult {
    submit: (transaction: unknown, description?: string) => Promise<{
        signature: string;
    }>;
    loading: boolean;
    error: string | null;
}
declare function useGaslessTx(): UseGaslessTxResult;

interface PortfolioToken {
    symbol: string;
    name: string;
    balance: number;
    price: number;
    mint?: string;
    logoURI?: string;
    usdValue: number;
    percentage: number;
}
interface PortfolioData {
    tokens: PortfolioToken[];
    totalValue: number;
    change24h: number;
    changePercent24h: number;
}
interface UsePortfolioResult {
    data: PortfolioData | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
}
/**
 * Hook to access portfolio data with USD values, percentages, and totals.
 * Wraps useVault with computed fields for portfolio display.
 */
declare function usePortfolio(): UsePortfolioResult;

type ThemeMode = "dark" | "light" | "system";
interface UseThemeResult {
    isDark: boolean;
    theme: ThemeMode;
    toggleTheme: () => void;
    setTheme: (theme: ThemeMode) => void;
}
/**
 * Hook for theme management in mini-apps.
 * Defaults to dark mode (Keystone OS aesthetic).
 * In the Studio iframe, the host controls the actual theme.
 */
declare function useTheme(): UseThemeResult;

interface UseTokenPriceResult {
    price: number | null;
    loading: boolean;
    error: string | null;
    refetch: () => void;
}
/**
 * Hook to get the current price of a token by mint address.
 * Uses Jupiter Price API in production, falls back to defaults in dev.
 */
declare function useTokenPrice(mint: string): UseTokenPriceResult;

type NotificationType = "info" | "success" | "warning" | "error";
interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message?: string;
    timestamp: number;
    read: boolean;
}
interface UseNotificationResult {
    notifications: Notification[];
    send: (title: string, options?: {
        type?: NotificationType;
        message?: string;
    }) => string;
    dismiss: (id: string) => void;
    markRead: (id: string) => void;
    clearAll: () => void;
    unreadCount: number;
}
/**
 * Hook for in-app notifications within mini-apps.
 * Notifications are ephemeral (per session) in the SDK;
 * the Studio host can persist and relay them.
 */
declare function useNotification(): UseNotificationResult;

interface UseStorageResult {
    get: (key: string) => string | null;
    set: (key: string, value: string) => void;
    remove: (key: string) => void;
    keys: () => string[];
    clear: () => void;
}
/**
 * Hook for persistent key-value storage scoped to the mini-app.
 * Uses localStorage under the hood, prefixed to avoid collisions.
 * In the Studio iframe, the host may intercept and sync storage.
 */
declare function useStorage(namespace?: string): UseStorageResult;

/**
 * Bridge interface — host injects implementation (postMessage in Studio, mock in tests)
 */
interface KeystoneBridge {
    call(method: string, params?: object, timeoutMs?: number): Promise<unknown>;
    notify(method: string, params?: object): void;
}
declare const BridgeMethods: {
    readonly PROXY_REQUEST: "proxy.fetch";
    readonly EVENT_EMIT: "event.emit";
    readonly LIT_ENCRYPT: "lit.encryptSecret";
    readonly LIT_DECRYPT: "lit.decryptSecret";
    readonly ACE_REPORT: "ace.report";
    readonly ZKSP_VERIFY: "zksp.verify";
    readonly AGENT_HANDOFF: "agent.handoff";
    readonly MCP_CALL: "mcp.call";
    readonly MCP_SERVE: "mcp.serve";
    readonly IMPACT_REPORT: "simulation.impactReport";
    readonly SIWS_SIGN: "siws.sign";
    readonly SIWS_VERIFY: "siws.verify";
    readonly JUPITER_SWAP: "jupiter.swap";
    readonly JUPITER_QUOTE: "jupiter.quote";
    readonly YIELD_OPTIMIZE: "yield.optimize";
    readonly GASLESS_SUBMIT: "gasless.submit";
    readonly BLINK_EXPORT: "blink.export";
    readonly TAX_FORENSICS: "tax.forensics";
};

/**
 * Bridge getter — host sets via setBridge() or globalThis.keystoneBridge
 */

declare function setBridge(bridge: KeystoneBridge): void;

/**
 * Blinks-in-a-Box — Export any Mini-App function as a Solana Blink.
 * Vote/sign from X, Discord via metadata-rich links.
 */
interface BlinkAction {
    label: string;
    payload: Record<string, unknown>;
    type?: "vote" | "sign" | "transfer" | "custom";
}
interface BlinkExportResult {
    url: string;
    actionId: string;
}
/**
 * Export an action as a Solana Blink. Returns shareable URL.
 */
declare function toBlink(action: BlinkAction): Promise<BlinkExportResult>;

/**
 * Zero-Knowledge Simulation Proofs (ZKSP) — stub for future integration.
 * Verifies that the Impact Report is mathematically proven outcome of the transaction.
 */
interface ZKSPVerifyParams {
    simulationHash: string;
    transactionPayload: string;
    proof?: string;
}
interface ZKSPVerifyResult {
    verified: boolean;
    attestation?: string;
}
/**
 * Verify a simulation proof. Returns verified status.
 * Full ZKSP integration requires Solana ZK stack (Light Protocol, Elusiv).
 */
declare function verifyZKSP(params: ZKSPVerifyParams): Promise<ZKSPVerifyResult>;

export { type AgentHandoffPayload, AppEventBus, BridgeMethods, type EventBus, type FetchOptions, type FetchResult, type ImpactReport, type JupiterSwapParams, type JupiterSwapResult, type KeystoneBridge, type ObservabilityConfig, type SIWSState, type Token, type VaultState, type YieldPath, setBridge, toBlink, useACEReport, useAgentHandoff, useEncryptedSecret, useFetch, useGaslessTx, useImpactReport, useJupiterSwap, useMCPClient, useMCPServer, useNotification, usePortfolio, useSIWS, useStorage, useTaxForensics, useTheme, useTokenPrice, useVault, useYieldOptimizer, verifyZKSP };
