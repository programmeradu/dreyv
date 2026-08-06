import { NextRequest } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
export const runtime = "edge";

export const dynamic = "force-dynamic";

// Proxy to Helius DAS getAssetsByOwner to fetch wallet holdings
// Docs: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api/get-assets-by-owner
export async function GET(req: NextRequest) {
  const apiKey = process.env.HELIUS_API_KEY;
  const mockMode = process.env.NODE_ENV !== "production" && String(process.env.MOCK_MODE || "").toLowerCase() === "true";

  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const page = Number(searchParams.get("page") || 1);
  const limit = Number(searchParams.get("limit") || 100);

  if (!address) {
    return new Response(JSON.stringify({ error: "address is required" }), { status: 400 });
  }

  // Mock mode: return deterministic token holdings for testing (server-side env only)
  if (mockMode && !apiKey) {
    const mockHoldings = [
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        address: "So11111111111111111111111111111111111111112",
        balance: "5000000000", // 5 SOL in lamports
        amount: "5000000000",
        decimals: 9,
      },
      {
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        name: "USD Coin",
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        balance: "1000000000", // 1000 USDC
        amount: "1000000000",
        decimals: 6,
      },
      {
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        symbol: "mSOL",
        name: "Marinade Staked SOL",
        address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        balance: "2500000000", // 2.5 mSOL
        amount: "2500000000",
        decimals: 9,
      },
    ];

    return new Response(
      JSON.stringify({ holdings: mockHoldings, total: mockHoldings.length }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing HELIUS_API_KEY" }), { status: 500 });
  }

  try {
    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    
    // Get fungible tokens owned by the address
    const body = {
      jsonrpc: "2.0",
      id: "atlas-wallet-holdings",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: address,
        page,
        limit,
        displayOptions: {
          showFungible: true,
          showNativeBalance: true,
        },
      },
    };

    const res = await fetch(heliusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await res.json();
    
    if (!res.ok || data?.error) {
      const msg = data?.error?.message || "Helius DAS request failed";
      return new Response(JSON.stringify({ error: msg }), { status: res.status || 502 });
    }

    // Parse fungible items returned by DAS
    const items = data?.result?.items || [];
    let holdings = items
      .filter((item: any) =>
        item.interface === "FungibleToken" ||
        item.interface === "FungibleAsset" ||
        item.interface === "Custom" ||
        // some pNFT/SPL-token-22 items show up as MplCoreAsset with token_info — only keep when there's a balance
        (item.token_info?.balance && Number(item.token_info?.balance) > 0)
      )
      .map((item: any) => {
        const files = item.content?.files || item.content?.links;
        const logo =
          item.content?.links?.image ||
          (Array.isArray(files) ? files.find((f: any) => f?.uri || f?.cdn_uri)?.cdn_uri || files.find((f: any) => f?.uri)?.uri : undefined) ||
          item.content?.metadata?.image ||
          undefined;
        return {
          mint: item.id,
          symbol: item.content?.metadata?.symbol || item.token_info?.symbol || item.content?.metadata?.name || "UNKNOWN",
          name: item.content?.metadata?.name || item.content?.metadata?.symbol || "Unknown Token",
          address: item.id,
          balance: item.token_info?.balance ?? "0",
          amount: item.token_info?.balance ?? "0",
          decimals: item.token_info?.decimals ?? 9,
          logo,
        };
      })
      .filter((h: any) => Number(h.balance) > 0);

    // CRITICAL: include native SOL balance — DAS returns it under `result.nativeBalance`, NOT in items.
    const nativeLamports = Number(data?.result?.nativeBalance?.lamports ?? 0);
    if (nativeLamports > 0) {
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      // Replace any wSOL entry to avoid double-count, then prepend native SOL.
      holdings = holdings.filter((h: any) => h.mint !== SOL_MINT);
      holdings.unshift({
        mint: SOL_MINT,
        symbol: "SOL",
        name: "Solana",
        address: SOL_MINT,
        balance: String(nativeLamports),
        amount: String(nativeLamports),
        decimals: 9,
        logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      });
    }

    // RPC fallback if we still got nothing (DAS occasionally returns empty for fresh wallets)
    if ((!holdings || holdings.length === 0) && address) {
      try {
        const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        const connection = new Connection(rpcUrl, "confirmed");
        const pub = new PublicKey(address);

        // Native SOL via getBalance
        const lamports = await connection.getBalance(pub);
        if (lamports > 0) {
          const SOL_MINT = "So11111111111111111111111111111111111111112";
          holdings.push({
            mint: SOL_MINT,
            symbol: "SOL",
            name: "Solana",
            address: SOL_MINT,
            balance: String(lamports),
            amount: String(lamports),
            decimals: 9,
          });
        }

        // SPL token accounts — correct program ID
        const SPL_TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        const resp = await connection.getParsedTokenAccountsByOwner(pub, { programId: SPL_TOKEN_PROGRAM });
        const parsed = resp.value || [];
        for (const p of parsed) {
          const info: any = p.account.data?.parsed?.info || {};
          const mint = info?.mint;
          const tokenAmount = info?.tokenAmount || {};
          const raw = Number(tokenAmount?.amount ?? 0);
          if (!mint || raw === 0) continue;
          holdings.push({
            mint,
            symbol: "UNKNOWN",
            name: "Unknown Token",
            address: mint,
            balance: String(raw),
            amount: String(raw),
            decimals: tokenAmount?.decimals ?? 0,
          });
        }
      } catch (rpcErr) {
        console.error("Helius RPC fallback failed:", rpcErr);
      }
    }


    return new Response(
      JSON.stringify({ holdings, total: holdings.length }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=30",
        },
      }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Failed to fetch wallet holdings" }), { status: 500 });
  }
}
