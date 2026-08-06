// Friendly error explanation endpoint — calls the LLM error-explainer
// when our static classifier doesn't have a mapping. Used by ToolError
// for the "unknown" bucket.

import { NextRequest, NextResponse } from "next/server";
import { explainError } from "@/lib/llm/error-explainer";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      code?: string;
      context?: Record<string, unknown>;
    };

    if (!body?.message || typeof body.message !== "string") {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const explanation = await explainError({
      message: body.message,
      code: body.code,
      context: body.context,
    });

    return NextResponse.json(explanation);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "explain failed" },
      { status: 500 },
    );
  }
}
