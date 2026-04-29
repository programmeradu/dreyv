"use client";

/**
 * Phantom SDK ↔ @solana/wallet-adapter-react compatibility shim.
 *
 * Phase 12 Track B: lets all 46 existing `useWallet()` / `useConnection()` /
 * `useWalletModal()` callsites keep their current destructuring shape while the
 * underlying provider is `@phantom/react-sdk`. Once stable we can migrate
 * call sites to native `usePhantom()` hooks file-by-file.
 */

import { ReactNode, useCallback, useMemo } from "react";
import {
  PhantomProvider,
  usePhantom,
  useSolana,
  useConnect,
  useDisconnect,
  useModal,
  AddressType,
} from "@phantom/react-sdk";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useNetwork } from "@/lib/contexts/NetworkContext";

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

interface PhantomCompatProviderProps {
  children: ReactNode;
  appId?: string;
  appName?: string;
  appIcon?: string;
}

export function PhantomCompatProvider({
  children,
  appId,
  appName = "Dreyv",
  appIcon,
}: PhantomCompatProviderProps) {
  const config = useMemo(() => {
    const resolvedAppId =
      appId ?? process.env.NEXT_PUBLIC_PHANTOM_APP_ID ?? "";
    // Embedded providers (google/apple/phantom) require an appId from the
    // Phantom dashboard. If it's not configured, fall back to wallet-only
    // providers so the app still loads instead of crashing the React tree.
    const hasAppId = resolvedAppId.length > 0;
    const providers = (
      hasAppId
        ? ["google", "apple", "phantom", "injected", "deeplink"]
        : ["injected", "deeplink"]
    ) as Array<"google" | "apple" | "phantom" | "injected" | "deeplink">;

    return {
      appId: resolvedAppId,
      addressTypes: [AddressType.solana] as AddressType[],
      providers,
      embeddedWalletType: "user-wallet" as const,
      authOptions: {
        redirectUrl:
          (typeof window !== "undefined" ? window.location.origin : "") +
          "/auth/callback",
      },
    };
  }, [appId]);

  return (
    <PhantomProvider config={config} appName={appName} appIcon={appIcon}>
      {children}
    </PhantomProvider>
  );
}

// --------------------------------------------------------------------------
// useWallet() shim — exact shape of @solana/wallet-adapter-react useWallet
// --------------------------------------------------------------------------

export interface WalletAdapterShape {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  wallet: { adapter: { name: string; icon?: string } } | null;
  signMessage: ((msg: Uint8Array) => Promise<Uint8Array>) | undefined;
  signTransaction:
    | (<T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>)
    | undefined;
  signAllTransactions:
    | (<T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>)
    | undefined;
  sendTransaction:
    | ((
        tx: Transaction | VersionedTransaction,
        connection: Connection
      ) => Promise<string>)
    | undefined;
  disconnect: () => Promise<void>;
  select: (walletName: string | null) => void;
}

export function useWallet(): WalletAdapterShape {
  const phantom = usePhantom();
  const { solana, isAvailable } = useSolana();
  const { disconnect } = useDisconnect();
  const { open } = useModal();

  const publicKey = useMemo(() => {
    const pkStr = solana?.publicKey ?? null;
    if (!pkStr) return null;
    try {
      return new PublicKey(pkStr);
    } catch {
      return null;
    }
  }, [solana?.publicKey]);

  const connected = !!phantom.isConnected && !!publicKey;

  const signMessage = useCallback(
    async (msg: Uint8Array): Promise<Uint8Array> => {
      if (!solana) throw new Error("Solana provider not available");
      const res = await solana.signMessage(msg);
      return res.signature;
    },
    [solana]
  );

  const signTransaction = useCallback(
    async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (!solana) throw new Error("Solana provider not available");
      return (await solana.signTransaction(tx as any)) as T;
    },
    [solana]
  );

  const signAllTransactions = useCallback(
    async <T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> => {
      if (!solana) throw new Error("Solana provider not available");
      return (await solana.signAllTransactions(txs as any)) as T[];
    },
    [solana]
  );

  const sendTransaction = useCallback(
    async (
      tx: Transaction | VersionedTransaction,
      connection: Connection
    ): Promise<string> => {
      if (!solana) throw new Error("Solana provider not available");
      // Phantom's signAndSendTransaction broadcasts via its own RPC; fall back
      // to sign-then-send through the caller-supplied connection so we keep
      // RPC routing (Helius, Triton, etc.) consistent across the app.
      const signed = await solana.signTransaction(tx);
      const raw = (signed as Transaction | VersionedTransaction).serialize();
      return await connection.sendRawTransaction(raw as Uint8Array);
    },
    [solana]
  );

  const select = useCallback(
    (_name: string | null) => {
      // In Phantom SDK there is no per-wallet "select" — opening the modal
      // lets the user choose embedded / extension / discovered wallets.
      open();
    },
    [open]
  );

  return {
    publicKey,
    connected,
    connecting: phantom.isConnecting || phantom.isLoading,
    disconnecting: false,
    wallet: connected ? { adapter: { name: "Phantom" } } : null,
    signMessage: isAvailable ? signMessage : undefined,
    signTransaction: isAvailable ? signTransaction : undefined,
    signAllTransactions: isAvailable ? signAllTransactions : undefined,
    sendTransaction: isAvailable ? sendTransaction : undefined,
    disconnect,
    select,
  };
}

// --------------------------------------------------------------------------
// useConnection() shim
// --------------------------------------------------------------------------

export function useConnection(): { connection: Connection } {
  const { endpoint } = useNetwork();
  const connection = useMemo(
    () => new Connection(endpoint, "confirmed"),
    [endpoint]
  );
  return { connection };
}

// --------------------------------------------------------------------------
// useWalletModal() shim
// --------------------------------------------------------------------------

export function useWalletModal(): {
  visible: boolean;
  setVisible: (v: boolean) => void;
} {
  const { open, close, isOpened } = useModal();
  const setVisible = useCallback(
    (v: boolean) => {
      if (v) open();
      else close();
    },
    [open, close]
  );
  return { visible: isOpened, setVisible };
}

// --------------------------------------------------------------------------
// Re-exports for convenience
// --------------------------------------------------------------------------

export { useConnect, useDisconnect, usePhantom, useSolana };


export type WalletContextState = WalletAdapterShape;
