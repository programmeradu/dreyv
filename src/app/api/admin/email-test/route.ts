import { NextRequest, NextResponse } from 'next/server';
import {
export const runtime = "edge";
  sendWelcomeEmail,
  sendTeamInviteEmail,
  sendNotificationEmail,
  sendTierExpiryEmail,
  sendGasAlertEmail,
  sendGasAlertVerificationEmail,
  sendWaitlistConfirmationEmail,
  sendWaitlistInviteEmail,
  sendAgentInsightEmail,
  sendOpportunityEmail,
  sendVaultCommandsEmail,
  sendWeeklyDigestEmail,
  sendMonthlyReportEmail,
  sendAnomalyAlertEmail,
  sendApprovalNudgeEmail,
  sendUpgradeNudgeEmail,
  sendReengagementEmail,
  sendOnboardingDay1Email,
  sendOnboardingDay3Email,
  sendOnboardingDay7Email,
} from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/email-test
 * Body: { to: string, secret: string }
 * Fires every email template to `to`. Gated by EMAIL_TEST_SECRET (or CRON_SECRET fallback).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const to = body?.to as string | undefined;
  const secret = body?.secret as string | undefined;
  const expected = process.env.EMAIL_TEST_SECRET || process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'EMAIL_TEST_SECRET not configured' }, { status: 500 });
  if (secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!to) return NextResponse.json({ error: 'to is required' }, { status: 400 });

  const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com';
  const results: { template: string; success: boolean; id?: string; error?: string }[] = [];
  const run = async (name: string, p: Promise<{ success: boolean; id?: string; error?: string }>) => {
    const r = await p;
    results.push({ template: name, ...r });
  };

  await run('welcome', sendWelcomeEmail(to, 'Samuel'));
  await run('team-invite', sendTeamInviteEmail({ to, teamName: 'Aurora Treasury', inviterName: 'Dreyv', role: 'admin', inviteToken: 'test-token-123' }));
  await run('notification', sendNotificationEmail({ to, title: 'Your export is ready', message: 'The PnL export you requested has finished.', actionUrl: `${APP}/app/analytics`, actionLabel: 'Open analytics' }));
  await run('tier-expiry', sendTierExpiryEmail(to, 'mini', 7));
  await run('gas-alert', sendGasAlertEmail({ to, gasPrice: 12.4, ethPrice: 3450, costUsd: 0.86, gasUnits: 21000, thresholdUsd: 1.0 }));
  await run('gas-alert-verify', sendGasAlertVerificationEmail({ to, verificationUrl: `${APP}/api/alerts/verify?token=test`, thresholdUsd: 1.0, minGasUnits: 21000 }));
  await run('waitlist-confirmation', sendWaitlistConfirmationEmail({ to, name: 'Samuel', position: 42 }));
  await run('waitlist-invite', sendWaitlistInviteEmail({ to, name: 'Samuel', inviteUrl: `${APP}/r/test-token`, expiresInDays: 7 }));

  await run('agent-insight', sendAgentInsightEmail({
    to, displayName: 'Samuel',
    headline: 'SOL concentration crossed 35%',
    detail: 'Your SOL allocation drifted from a 28% target to 35.4% this week. Foresight flagged it as the top portfolio risk.',
    metrics: [
      { label: 'SOL weight', value: '35.4%', accent: true },
      { label: 'Target', value: '28%' },
      { label: 'Drift since Mon', value: '+7.4 pp' },
    ],
  }));

  await run('opportunity', sendOpportunityEmail({
    to, displayName: 'Samuel',
    headline: 'Marinade just opened a +42 bps yield route',
    detail: 'A fresh mSOL route beats your current staking yield by 42 basis points on roughly 1,200 SOL of idle balance.',
    metrics: [
      { label: 'Current yield', value: '6.81%' },
      { label: 'New route', value: '7.23%', accent: true },
      { label: 'Edge', value: '+42 bps' },
    ],
  }));

  await run('vault-commands', sendVaultCommandsEmail({
    to, displayName: 'Samuel',
    commands: [
      { title: 'Sweep idle USDC into Kamino', why: '$84k stables sitting at 0% — pre-routed.' },
      { title: 'Trim SOL drift back to 28%', why: 'Reduces single-asset risk by 7.4 pp.' },
      { title: 'Close stale Squads proposal #47', why: 'Pending 9 days, blocking treasury rotation.' },
    ],
  }));

  await run('weekly-digest', sendWeeklyDigestEmail({
    to, displayName: 'Samuel', weekLabel: 'Nov 4 – Nov 10',
    pnlUsd: 12480, pnlPct: 1.84, topMover: 'JTO (+18.3%)',
    feesUsd: 142.18, agentActions: 7, pendingApprovals: 2,
  }));

  await run('monthly-report', sendMonthlyReportEmail({
    to, displayName: 'Samuel', monthLabel: 'October 2026',
    performanceVsBenchmark: '+3.2 pp vs SOL spot',
    driftSummary: '2 of 5 positions outside band',
    scenariosRun: 14,
  }));

  await run('anomaly-alert', sendAnomalyAlertEmail({
    to,
    headline: 'Unusual outflow detected',
    detail: 'A 4,200 USDC transfer hit a counterparty your treasury has never used before. Review the signer and destination.',
    metrics: [
      { label: 'Amount', value: '4,200 USDC', accent: true },
      { label: 'Counterparty', value: 'New (0x9f…a13)' },
      { label: 'Signer', value: 'ops@dreyv' },
    ],
  }));

  await run('approval-nudge', sendApprovalNudgeEmail({
    to, displayName: 'Samuel', count: 3, oldestHours: 36,
  }));

  await run('upgrade-nudge', sendUpgradeNudgeEmail({
    to, displayName: 'Samuel',
    currentTier: 'Mini', suggestedTier: 'Max',
    reason: 'You\'ve hit your agent slot ceiling 4 times this week. Max gives you unlimited agents and priority Foresight runs.',
  }));

  await run('reengagement', sendReengagementEmail({
    to, displayName: 'Samuel', daysAway: 17,
    vaultActivity: 'Two transfers, one Squads proposal opened, and your SOL position is up 11.4%.',
  }));

  await run('onboarding-day1', sendOnboardingDay1Email(to, 'Samuel'));
  await run('onboarding-day3', sendOnboardingDay3Email(to, 'Samuel'));
  await run('onboarding-day7', sendOnboardingDay7Email(to, 'Samuel'));

  const ok = results.filter((r) => r.success).length;
  return NextResponse.json({ ok: true, sent: ok, total: results.length, results });
}
