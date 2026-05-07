import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify Vercel Cron secret. Vercel sets `Authorization: Bearer <CRON_SECRET>`.
 * Returns NextResponse on failure, null on success.
 */
export function verifyCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
