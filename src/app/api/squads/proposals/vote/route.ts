/**
 * POST /api/squads/proposals/vote
 * Body: { multisig, transactionIndex, action: "Approve"|"Reject"|"Execute", member }
 *
 * Returns a base64-serialized transaction for the connected wallet to sign &
 * broadcast. We never hold private keys server-side; the wallet executes the
 * vote/execute against the Squads program.
 */
import { NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { SquadsClient } from "@/lib/squads";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  multisig: z.string().min(32),
  transactionIndex: z.number().int().min(1),
  action: z.enum(["Approve", "Reject", "Cancel", "Execute"]),
  member: z.string().min(32),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "invalid_body" }, { status: 400 });
  }

  try {
    const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const conn = new Connection(rpc, "confirmed");
    const client = new SquadsClient(conn, null);
    const member = new PublicKey(body.member);

    let ix;
    if (body.action === "Execute") {
      ix = await client.getExecuteInstruction(body.multisig, body.transactionIndex, member);
    } else {
      ix = client.getVoteInstruction(body.multisig, body.transactionIndex, body.action, member);
    }

    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: member });
    tx.add(ix as any);
    const serialized = Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64");

    return NextResponse.json({
      ok: true,
      action: body.action,
      transactionIndex: body.transactionIndex,
      multisig: body.multisig,
      serializedTransaction: serialized,
    });
  } catch (e: any) {
    console.warn("[squads/proposals/vote]", e?.message);
    return NextResponse.json({ ok: false, error: e?.message ?? "vote_build_failed" }, { status: 500 });
  }
}
