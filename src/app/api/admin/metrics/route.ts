export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { users, dcaBots, dcaExecutions, agentExecutions, agentApprovals, miniApps, userInstalledApps, 
         reviews, purchases, teams, teamMembers, teamInvitations, notificationPreferences, 
         alerts, monitors, rateLimits, knowledgeEntries, atlasSessions, foresightPredictions, 
         transactionCache, analyticsSnapshots, airdropClaims, runs, protocolFees } from "@/db/schema";
import { jwtVerify } from "jose";

// Force Node.js runtime for JWT and heavy aggregations
export const dynamic = "force-dynamic";

// Use 60 second revalidation for the dashboard to keep it fresh but avoid DB spam
export const revalidate = 60; 

function getAdminToken(req: NextRequest) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    const siwsCookie = req.cookies.get("keystone-siws-session")?.value;
    if (siwsCookie) return siwsCookie;
    
    // Fallback for Better Auth / Neon Auth users
    const neonCookie = req.cookies.get("better-auth.session_token")?.value 
                    || req.cookies.get("__Secure-neon-auth.session_token")?.value
                    || req.cookies.get("neon-auth.session_token")?.value;
    if (neonCookie) return neonCookie;

    return null;
}

export async function GET(req: NextRequest) {
    try {
        if (!db) {
            return NextResponse.json({ error: "Database not configured" }, { status: 500 });
        }
        // Local non-null alias so the rest of the function type-checks cleanly.
        const dbx = db;

        // verify admin status
        const token = getAdminToken(req);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        let decoded: any;
        try {
            const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
            if (!jwtSecret) return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
            const secret = new TextEncoder().encode(jwtSecret);
            const result = await jwtVerify(token, secret);
            decoded = result.payload;
            
            // Check Live DB Role (JWT might be stale)
            const wallet = decoded.wallet || decoded.sub;
            const liveUser = await dbx.query.users.findFirst({
                where: (u, { eq }) => eq(u.walletAddress, wallet as string)
            });
            
            if (!liveUser || liveUser.role !== "admin") {
                return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
            }
        } catch {
            return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 });
        }

        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Run all queries concurrently
        const [
            totalUsersData, newUsers24hData, newUsers7dData, onboardingData, emailUsersData,
            tierBreakdownData, marketplaceRevenueData, marketplaceVolumeData, creatorPayoutsData,
            totalExecutionsData, executions24hData, executionsStatusData, totalGasAgentData, approvalsData, aiRunsData,
            activeBotsData, botsStatusData, dcaVolumeData, dcaVolume24hData, dcaExecutions24hData,
            totalAppsData, publishedAppsData, totalInstallsData, activeInstallsData,
            totalTeamsData, vaultLinkedTeamsData, teamInvitesData,
            txVolumeData, airdropClaimsData,
            monitorsData, rateLimitsData, atlasSessionsData, foresightData,
            protoFeesData,
        ] = await Promise.all([
            // Panel 1: User Growth
            dbx.select({ count: sql<number>`count(*)::int` }).from(users),
            dbx.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`created_at >= ${oneDayAgo}`),
            dbx.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`created_at >= ${sevenDaysAgo}`),
            dbx.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`onboarding_completed = true`),
            dbx.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`email IS NOT NULL`),

            // Panel 2: Revenue & Tiers
            dbx.select({ tier: users.tier, count: sql<number>`count(*)::int` }).from(users).groupBy(users.tier),
            dbx.select({ rev: sql<number>`sum(keystone_fee)` }).from(purchases),
            dbx.select({ vol: sql<number>`sum(amount_usdc)` }).from(purchases),
            dbx.select({ payout: sql<number>`sum(creator_payout)` }).from(purchases),

            // Panel 3: AI Agents
            dbx.select({ count: sql<number>`count(*)::int` }).from(agentExecutions),
            dbx.select({ count: sql<number>`count(*)::int` }).from(agentExecutions).where(sql`created_at >= ${oneDayAgo}`),
            dbx.select({ status: agentExecutions.status, count: sql<number>`count(*)::int` }).from(agentExecutions).groupBy(agentExecutions.status),
            dbx.select({ gas: sql<number>`sum(actual_gas)` }).from(agentExecutions),
            dbx.select({ 
                total: sql<number>`count(*)::int`, 
                approved: sql<number>`sum(case when approved = true then 1 else 0 end)::int` 
            }).from(agentApprovals),
            dbx.select({ count: sql<number>`count(*)::int` }).from(runs),

            // Panel 4: DCA Bots
            dbx.select({ count: sql<number>`count(*)::int` }).from(dcaBots).where(sql`status = 'active'`),
            dbx.select({ status: dcaBots.status, count: sql<number>`count(*)::int` }).from(dcaBots).groupBy(dcaBots.status),
            dbx.select({ vol: sql<number>`sum(total_invested)` }).from(dcaBots),
            dbx.select({ vol: sql<number>`sum(payment_amount)` }).from(dcaExecutions).where(sql`executed_at >= ${oneDayAgo}`),
            dbx.select({ count: sql<number>`count(*)::int` }).from(dcaExecutions).where(sql`executed_at >= ${oneDayAgo}`),

            // Panel 5: Marketplace
            dbx.select({ count: sql<number>`count(*)::int` }).from(miniApps),
            dbx.select({ count: sql<number>`count(*)::int` }).from(miniApps).where(sql`is_published = true`),
            dbx.select({ count: sql<number>`sum(installs)::int` }).from(miniApps),
            dbx.select({ count: sql<number>`count(*)::int` }).from(userInstalledApps).where(sql`uninstalled_at IS NULL`),

            // Panel 6: Teams
            dbx.select({ count: sql<number>`count(*)::int` }).from(teams),
            dbx.select({ count: sql<number>`count(*)::int` }).from(teams).where(sql`vault_address IS NOT NULL`),
            dbx.select({ 
                total: sql<number>`count(*)::int`,
                accepted: sql<number>`sum(case when accepted_at IS NOT NULL then 1 else 0 end)::int`
            }).from(teamInvitations),

            // Panel 7: On-Chain & Analytics
            dbx.select({ 
                txCount: sql<number>`count(*)::int`,
                usdVol: sql<number>`sum(value_usd)`
            }).from(transactionCache),
            dbx.select({
                claims: sql<number>`count(*)::int`,
                claimedValue: sql<number>`sum(estimated_value)`
            }).from(airdropClaims).where(sql`status = 'claimed'`),

            // Panel 8: System Health
            dbx.select({ count: sql<number>`count(*)::int` }).from(monitors).where(sql`active = true`),
            dbx.select({ hits: sql<number>`sum(count)::int` }).from(rateLimits).where(sql`window_start >= ${oneDayAgo}`),
            dbx.select({ count: sql<number>`count(*)::int` }).from(atlasSessions).where(sql`expires_at > ${now}`),
            dbx.select({ 
                total: sql<number>`count(*)::int`,
                correct: sql<number>`sum(case when correct = true then 1 else 0 end)::int`,
                resolved: sql<number>`sum(case when resolved = true then 1 else 0 end)::int`
            }).from(foresightPredictions),

            // Panel 9: Protocol fees (Dreyv 0.05% ledger)
            dbx.select({
                feesAll: sql<number>`coalesce(sum(fee_usd), 0)::float`,
                volAll: sql<number>`coalesce(sum(estimated_value_usd), 0)::float`,
                txAll: sql<number>`count(*)::int`,
                fees24h: sql<number>`coalesce(sum(fee_usd) filter (where created_at >= ${oneDayAgo}), 0)::float`,
                vol24h: sql<number>`coalesce(sum(estimated_value_usd) filter (where created_at >= ${oneDayAgo}), 0)::float`,
                tx24h: sql<number>`(count(*) filter (where created_at >= ${oneDayAgo}))::int`,
                fees7d: sql<number>`coalesce(sum(fee_usd) filter (where created_at >= ${sevenDaysAgo}), 0)::float`,
                fees30d: sql<number>`coalesce(sum(fee_usd) filter (where created_at >= ${thirtyDaysAgo}), 0)::float`,
                vol30d: sql<number>`coalesce(sum(estimated_value_usd) filter (where created_at >= ${thirtyDaysAgo}), 0)::float`,
                payers30d: sql<number>`(count(distinct wallet_address) filter (where created_at >= ${thirtyDaysAgo}))::int`,
            }).from(protocolFees),
        ]);

        const protoRow = (protoFeesData?.[0] ?? {}) as any;

        // Process data
        const totalUsers = totalUsersData[0]?.count || 0;
        const metrics = {
            users: {
                total: totalUsers,
                new24h: newUsers24hData[0]?.count || 0,
                new7d: newUsers7dData[0]?.count || 0,
                onboarded: onboardingData[0]?.count || 0,
                onboardingRate: totalUsers > 0 ? (onboardingData[0]?.count || 0) / totalUsers : 0,
                withEmail: emailUsersData[0]?.count || 0,
                emailRate: totalUsers > 0 ? (emailUsersData[0]?.count || 0) / totalUsers : 0,
            },
            revenue: {
                tiers: tierBreakdownData.reduce((acc, row) => ({ ...acc, [row.tier]: row.count }), {} as Record<string, number>),
                totalMarketplaceRev: marketplaceRevenueData[0]?.rev || 0,
                totalMarketplaceVol: marketplaceVolumeData[0]?.vol || 0,
                creatorPayouts: creatorPayoutsData[0]?.payout || 0,
            },
            ai: {
                totalExecutions: totalExecutionsData[0]?.count || 0,
                executions24h: executions24hData[0]?.count || 0,
                executionStatus: executionsStatusData.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {} as Record<string, number>),
                totalGas: totalGasAgentData[0]?.gas || 0,
                totalApprovals: approvalsData[0]?.total || 0,
                approvedCount: approvalsData[0]?.approved || 0,
                totalRuns: aiRunsData[0]?.count || 0,
            },
            dca: {
                activeBots: activeBotsData[0]?.count || 0,
                botsStatus: botsStatusData.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {} as Record<string, number>),
                totalInvested: dcaVolumeData[0]?.vol || 0,
                volume24h: dcaVolume24hData[0]?.vol || 0,
                executions24h: dcaExecutions24hData[0]?.count || 0,
            },
            marketplace: {
                totalApps: totalAppsData[0]?.count || 0,
                publishedApps: publishedAppsData[0]?.count || 0,
                totalInstalls: totalInstallsData[0]?.count || 0,
                activeInstalls: activeInstallsData[0]?.count || 0,
            },
            teams: {
                total: totalTeamsData[0]?.count || 0,
                vaultLinked: vaultLinkedTeamsData[0]?.count || 0,
                invitesTotal: teamInvitesData[0]?.total || 0,
                invitesAccepted: teamInvitesData[0]?.accepted || 0,
            },
            onchain: {
                txCount: txVolumeData[0]?.txCount || 0,
                usdVol: txVolumeData[0]?.usdVol || 0,
                airdropClaims: airdropClaimsData[0]?.claims || 0,
                airdropValue: airdropClaimsData[0]?.claimedValue || 0,
            },
            system: {
                activeMonitors: monitorsData[0]?.count || 0,
                rateLimitHits24h: rateLimitsData[0]?.hits || 0,
                activeAtlasSessions: atlasSessionsData[0]?.count || 0,
                foresightTotal: foresightData[0]?.total || 0,
                foresightCorrect: foresightData[0]?.correct || 0,
                foresightResolved: foresightData[0]?.resolved || 0,
                foresightAccuracy: (foresightData[0]?.resolved || 0) > 0 ? (foresightData[0]?.correct || 0) / foresightData[0]?.resolved : 0,
            },
            protocol: {
                feesAll: Number(protoRow.feesAll || 0),
                volAll: Number(protoRow.volAll || 0),
                txAll: Number(protoRow.txAll || 0),
                fees24h: Number(protoRow.fees24h || 0),
                vol24h: Number(protoRow.vol24h || 0),
                tx24h: Number(protoRow.tx24h || 0),
                fees7d: Number(protoRow.fees7d || 0),
                fees30d: Number(protoRow.fees30d || 0),
                vol30d: Number(protoRow.vol30d || 0),
                payers30d: Number(protoRow.payers30d || 0),
                takeRateBps: Number(protoRow.volAll) > 0 ? (Number(protoRow.feesAll) / Number(protoRow.volAll)) * 10_000 : 5,
            },
            fetchedAt: new Date().toISOString()
        };

        return NextResponse.json(metrics);
    } catch (e: any) {
        console.error("Admin metrics API error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
