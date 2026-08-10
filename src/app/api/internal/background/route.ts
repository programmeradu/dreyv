import { NextRequest, NextResponse } from "next/server";
import { verifyCron } from "@/lib/cron-auth";
import {
  handleTick10s,
  handleSweep1m,
  handleDeep5m,
  handleReflect1h,
} from "@/lib/agents/functions";
import {
  handleTxProposalReaper,
  handleTxProposalReconciler,
  handleJitoMevPoll,
} from "@/lib/agents/brains/functions";

export async function POST(req: NextRequest) {
  const authErr = verifyCron(req);
  if (authErr) return authErr;

  try {
    const { action } = await req.json();

    switch (action) {
      case "1m_pulse":
        await Promise.all([handleTick10s(), handleSweep1m()]);
        break;
      case "tick10s":
        await handleTick10s();
        break;
      case "sweep1m":
        await handleSweep1m();
        break;
      case "deep5m":
        await handleDeep5m();
        break;
      case "reflect1h":
        await handleReflect1h();
        break;
      case "txProposalReaper":
        await handleTxProposalReaper();
        break;
      case "txProposalReconciler":
        await handleTxProposalReconciler();
        break;
      case "jitoMevPoll":
        await handleJitoMevPoll();
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action });
  } catch (err: any) {
    console.error(`[internal/background] Error executing action:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
