import 'dotenv/config';
import * as svc from '../src/lib/email-service';

const TO = process.env.TEST_TO || 'samueladu1970@gmail.com';
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com';

const tasks: [string, () => Promise<any>][] = [
  ['welcome', () => svc.sendWelcomeEmail(TO, 'Samuel')],
  ['team-invite', () => svc.sendTeamInviteEmail({ to: TO, teamName: 'Aurora Treasury', inviterName: 'Dreyv', role: 'admin', inviteToken: 'test-token-123' })],
  ['notification', () => svc.sendNotificationEmail({ to: TO, title: 'Your export is ready', message: 'The PnL export you requested has finished.', actionUrl: `${APP}/app/analytics`, actionLabel: 'Open analytics' })],
  ['tier-expiry', () => svc.sendTierExpiryEmail(TO, 'mini', 7)],
  ['gas-alert', () => svc.sendGasAlertEmail({ to: TO, gasPrice: 12.4, ethPrice: 3450, costUsd: 0.86, gasUnits: 21000, thresholdUsd: 1.0 })],
  ['gas-alert-verify', () => svc.sendGasAlertVerificationEmail({ to: TO, verificationUrl: `${APP}/api/alerts/verify?token=test`, thresholdUsd: 1.0, minGasUnits: 21000 })],
  ['waitlist-confirmation', () => svc.sendWaitlistConfirmationEmail({ to: TO, name: 'Samuel', position: 42 })],
  ['waitlist-invite', () => svc.sendWaitlistInviteEmail({ to: TO, name: 'Samuel', inviteUrl: `${APP}/r/test-token`, expiresInDays: 7 })],
  ['agent-insight', () => svc.sendAgentInsightEmail({ to: TO, displayName: 'Samuel', headline: 'SOL concentration crossed 35%', detail: 'Your SOL allocation drifted from a 28% target to 35.4% this week. Foresight flagged it as the top portfolio risk.', metrics: [{ label: 'SOL weight', value: '35.4%', accent: true }, { label: 'Target', value: '28%' }, { label: 'Drift since Mon', value: '+7.4 pp' }] })],
  ['opportunity', () => svc.sendOpportunityEmail({ to: TO, displayName: 'Samuel', headline: 'Marinade just opened a +42 bps yield route', detail: 'A fresh mSOL route beats your current staking yield by 42 basis points on roughly 1,200 SOL of idle balance.', metrics: [{ label: 'Current yield', value: '6.81%' }, { label: 'New route', value: '7.23%', accent: true }, { label: 'Edge', value: '+42 bps' }] })],
  ['vault-commands', () => svc.sendVaultCommandsEmail({ to: TO, displayName: 'Samuel', commands: [{ title: 'Sweep idle USDC into Kamino', why: '$84k stables sitting at 0% — pre-routed.' }, { title: 'Trim SOL drift back to 28%', why: 'Reduces single-asset risk by 7.4 pp.' }, { title: 'Close stale Squads proposal #47', why: 'Pending 9 days, blocking treasury rotation.' }] })],
  ['weekly-digest', () => svc.sendWeeklyDigestEmail({ to: TO, displayName: 'Samuel', weekLabel: 'Nov 4 – Nov 10', pnlUsd: 12480, pnlPct: 1.84, topMover: 'JTO (+18.3%)', feesUsd: 142.18, agentActions: 7, pendingApprovals: 2 })],
  ['monthly-report', () => svc.sendMonthlyReportEmail({ to: TO, displayName: 'Samuel', monthLabel: 'October 2026', performanceVsBenchmark: '+3.2 pp vs SOL spot', driftSummary: '2 of 5 positions outside band', scenariosRun: 14 })],
  ['anomaly-alert', () => svc.sendAnomalyAlertEmail({ to: TO, headline: 'Unusual outflow detected', detail: 'A 4,200 USDC transfer hit a counterparty your treasury has never used before. Review the signer and destination.', metrics: [{ label: 'Amount', value: '4,200 USDC', accent: true }, { label: 'Counterparty', value: 'New (0x9f…a13)' }, { label: 'Signer', value: 'ops@dreyv' }] })],
  ['approval-nudge', () => svc.sendApprovalNudgeEmail({ to: TO, displayName: 'Samuel', count: 3, oldestHours: 36 })],
  ['upgrade-nudge', () => svc.sendUpgradeNudgeEmail({ to: TO, displayName: 'Samuel', currentTier: 'Mini', suggestedTier: 'Max', reason: "You've hit your agent slot ceiling 4 times this week. Max gives you unlimited agents and priority Foresight runs." })],
  ['reengagement', () => svc.sendReengagementEmail({ to: TO, displayName: 'Samuel', daysAway: 17, vaultActivity: 'Two transfers, one Squads proposal opened, and your SOL position is up 11.4%.' })],
  ['onboarding-day1', () => svc.sendOnboardingDay1Email(TO, 'Samuel')],
  ['onboarding-day3', () => svc.sendOnboardingDay3Email(TO, 'Samuel')],
  ['onboarding-day7', () => svc.sendOnboardingDay7Email(TO, 'Samuel')],
];

(async () => {
  let ok = 0;
  for (const [name, fn] of tasks) {
    try {
      const r = await fn();
      console.log(`${r.success ? '✓' : '✗'} ${name}${r.success ? ` (${r.id})` : ` — ${r.error}`}`);
      if (r.success) ok++;
      await new Promise((res) => setTimeout(res, 600)); // gentle on Resend rate limit
    } catch (e: any) {
      console.log(`✗ ${name} — ${e?.message || e}`);
    }
  }
  console.log(`\n${ok}/${tasks.length} sent`);
})();
