/**
 * POST /api/auth/link-wallet
 * 
 * Links a Solana wallet to an existing social auth account.
 * Used when users signed in via Google/Discord and want to connect their wallet.
 * 
 * Requires: active Supabase session + wallet signature proof.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-utils';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export async function POST(request: NextRequest) {
    try {
        const { walletAddress, message, signature } = await request.json();

        if (!walletAddress || !message || !signature) {
            return NextResponse.json(
                { error: 'Missing walletAddress, message, or signature' },
                { status: 400 }
            );
        }

        // Verify the user has an active session via the unified auth util
        const authUser = await getAuthUser(request);

        if (!authUser) {
            return NextResponse.json(
                { error: 'Not authenticated. Sign in first.' },
                { status: 401 }
            );
        }

        // Verify wallet signature
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = bs58.decode(signature);
        const publicKeyBytes = bs58.decode(walletAddress);

        const isValid = nacl.sign.detached.verify(
            messageBytes,
            signatureBytes,
            publicKeyBytes
        );

        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid wallet signature' },
                { status: 401 }
            );
        }

        // Link wallet to Neon user
        if (db) {
            // Check if this wallet is already linked to another account
            const existingWallet = await db
                .select()
                .from(users)
                .where(eq(users.walletAddress, walletAddress))
                .limit(1);

            if (existingWallet.length > 0 && existingWallet[0].id !== authUser.id) {
                return NextResponse.json(
                    { error: 'This wallet is already linked to another account.' },
                    { status: 409 }
                );
            }

            // Update the social user's record with the real wallet address
            // This replaces their placeholder neon_id wallet address with the real Phantom one
            await db
                .update(users)
                .set({
                    walletAddress,
                })
                .where(eq(users.id, authUser.id));

            // We no longer update Supabase metadata, Neon Auth doesn't require mirroring
        }

        return NextResponse.json({
            ok: true,
            walletAddress,
            message: 'Wallet successfully linked to your account.',
        });
    } catch (err: any) {
        console.error('[Link Wallet] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to link wallet' },
            { status: 500 }
        );
    }
}
