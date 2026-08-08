export const runtime = "edge";
/**
 * POST   /api/auth/link-evm  → persist a connected EVM wallet on the current user
 * DELETE /api/auth/link-evm  → unlink the EVM wallet from the current user
 *
 * Read-only-only for the MVP: we do *not* verify a SIWE signature here. The EVM
 * address is treated as a "linked" address used for read-only analytics and
 * watchers. Native EVM execution still requires a future SIWE link step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth-utils';
import { EVM_ENABLED } from '@/lib/feature-flags';

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const DISABLED = NextResponse.json(
    { error: 'evm_paused', detail: 'EVM support is temporarily paused.' },
    { status: 410 },
);

function normalizeEvm(addr: string): string | null {
    if (typeof addr !== 'string') return null;
    const trimmed = addr.trim();
    if (!HEX_ADDRESS.test(trimmed)) return null;
    return trimmed.toLowerCase();
}

export async function POST(request: NextRequest) {
    if (!EVM_ENABLED) return DISABLED;
    try {
        const user = await getAuthUser(request);
        if (!user) {
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        if (!db) {
            return NextResponse.json({ error: 'db_unavailable' }, { status: 500 });
        }

        const body = (await request.json().catch(() => null)) as { address?: string } | null;
        const evm = normalizeEvm(body?.address ?? '');
        if (!evm) {
            return NextResponse.json(
                { error: 'invalid_address', detail: 'Expected 0x-prefixed 20-byte hex address' },
                { status: 400 },
            );
        }

        await db.update(users).set({ evmWalletAddress: evm }).where(eq(users.id, user.id));
        return NextResponse.json({ ok: true, evmWalletAddress: evm });
    } catch (err: any) {
        console.error('[link-evm] error:', err);
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    if (!EVM_ENABLED) return DISABLED;
    try {
        const user = await getAuthUser(request);
        if (!user) {
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        if (!db) {
            return NextResponse.json({ error: 'db_unavailable' }, { status: 500 });
        }
        await db.update(users).set({ evmWalletAddress: null }).where(eq(users.id, user.id));
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[link-evm:DELETE] error:', err);
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    if (!EVM_ENABLED) {
        // GET is also used by UI to check link state; return null so UI hides cleanly.
        const user = await getAuthUser(request);
        if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        return NextResponse.json({ ok: true, evmWalletAddress: null, paused: true });
    }
    const user = await getAuthUser(request);
    if (!user) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json({
        ok: true,
        evmWalletAddress: user.evmWalletAddress ?? null,
    });
}
