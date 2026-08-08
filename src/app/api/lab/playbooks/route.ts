import { NextResponse } from "next/server";
import { PLAYBOOK_LIBRARY } from "@/lib/lab/playbooks-library";


export async function GET() {
  return NextResponse.json({ playbooks: PLAYBOOK_LIBRARY });
}
