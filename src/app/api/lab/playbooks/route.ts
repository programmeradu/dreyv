import { NextResponse } from "next/server";
import { PLAYBOOK_LIBRARY } from "@/lib/lab/playbooks-library";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({ playbooks: PLAYBOOK_LIBRARY });
}
