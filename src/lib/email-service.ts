import { Resend } from 'resend';
import { render } from '@react-email/components';
import {
  WelcomeEmail,
  TeamInviteEmail,
  NotificationEmail,
  TierExpiryEmail,
  GasAlertEmail,
  GasAlertVerificationEmail,
  AgentDeliverableEmail,
  SubscriptionActivatedEmail,
  type AgentDeliverableEmailProps,
  type SubscriptionActivatedEmailProps,
} from './emails/templates';


// ─── Singleton Resend client ─────────────────────────────────────────
let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email-service] RESEND_API_KEY not set — emails disabled');
    return null;
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || 'dreyv <noreply@stauniverse.tech>';
}

// ─── Core send function ──────────────────────────────────────────────
export async function sendEmail({
  to,
  subject,
  react,
}: {
  to: string;
  subject: string;
  react: React.ReactElement;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email-service] Skipped email to ${to}: no RESEND_API_KEY`);
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const html = await render(react);
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject,
      html,
    });

    if (error) {
      console.error(`[email-service] Failed to send to ${to}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[email-service] Sent "${subject}" to ${to} (id: ${data?.id})`);
    return { success: true, id: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[email-service] Error sending to ${to}:`, msg);
    return { success: false, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HIGH-LEVEL SENDERS
// ═══════════════════════════════════════════════════════════════════════

export async function sendWelcomeEmail(to: string, displayName: string) {
  return sendEmail({
    to,
    subject: 'Welcome to dreyv Treasury OS',
    react: WelcomeEmail({ displayName }),
  });
}

export async function sendTeamInviteEmail({
  to,
  teamName,
  inviterName,
  role,
  inviteToken,
}: {
  to: string;
  teamName: string;
  inviterName: string;
  role: string;
  inviteToken: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com';
  const acceptUrl = `${baseUrl}/accept-team-invite/${inviteToken}`;

  return sendEmail({
    to,
    subject: `${inviterName} invited you to ${teamName} on dreyv`,
    react: TeamInviteEmail({ teamName, inviterName, role, acceptUrl }),
  });
}

export async function sendNotificationEmail({
  to,
  title,
  message,
  actionUrl,
  actionLabel,
}: {
  to: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}) {
  return sendEmail({
    to,
    subject: `dreyv: ${title}`,
    react: NotificationEmail({ title, message, actionUrl, actionLabel }),
  });
}

export async function sendTierExpiryEmail(to: string, tier: string, daysLeft: number) {
  return sendEmail({
    to,
    subject: `Your dreyv ${tier} plan expires in ${daysLeft} days`,
    react: TierExpiryEmail({ tier, daysLeft }),
  });
}

export async function sendGasAlertEmail({
  to,
  gasPrice,
  ethPrice,
  costUsd,
  gasUnits,
  thresholdUsd,
}: {
  to: string;
  gasPrice: number;
  ethPrice: number;
  costUsd: number;
  gasUnits: number;
  thresholdUsd: number;
}) {
  return sendEmail({
    to,
    subject: '⛽ Gas Alert: Low prices detected!',
    react: GasAlertEmail({ gasPrice, ethPrice, costUsd, gasUnits, thresholdUsd }),
  });
}

export async function sendGasAlertVerificationEmail({
  to,
  verificationUrl,
  thresholdUsd,
  minGasUnits,
}: {
  to: string;
  verificationUrl: string;
  thresholdUsd: number;
  minGasUnits: number;
}) {
  return sendEmail({
    to,
    subject: 'Confirm your dreyv gas alert',
    react: GasAlertVerificationEmail({ verificationUrl, thresholdUsd, minGasUnits }),
  });
}

// ─── Waitlist senders ────────────────────────────────────────────────
import {
  WaitlistConfirmationEmail,
  WaitlistInviteEmail,
} from './emails/templates';

export async function sendWaitlistConfirmationEmail({
  to,
  name,
  position,
}: {
  to: string;
  name: string | null;
  position: number;
}) {
  return sendEmail({
    to,
    subject: `You're #${position} on the dreyv waitlist`,
    react: WaitlistConfirmationEmail({ name, position }),
  });
}

export async function sendWaitlistInviteEmail({
  to,
  name,
  inviteUrl,
  expiresInDays,
}: {
  to: string;
  name: string | null;
  inviteUrl: string;
  expiresInDays: number;
}) {
  return sendEmail({
    to,
    subject: 'Your dreyv access is open',
    react: WaitlistInviteEmail({ name, inviteUrl, expiresInDays }),
  });
}

// ─── Proactive / Agentic senders ─────────────────────────────────────
import {
  AgentInsightEmail,
  OpportunityEmail,
  VaultCommandsEmail,
  WeeklyDigestEmail,
  MonthlyReportEmail,
  AnomalyAlertEmail,
  ApprovalNudgeEmail,
  UpgradeNudgeEmail,
  ReengagementEmail,
  OnboardingDay1Email,
  OnboardingDay3Email,
  OnboardingDay7Email,
} from './emails/templates';

type Metric = { label: string; value: string; accent?: boolean };

export async function sendAgentInsightEmail(args: {
  to: string;
  displayName?: string | null;
  headline: string;
  detail: string;
  metrics?: Metric[];
  actionUrl?: string;
  actionLabel?: string;
}) {
  return sendEmail({
    to: args.to,
    subject: `dreyv insight: ${args.headline}`,
    react: AgentInsightEmail(args),
  });
}

export async function sendOpportunityEmail(args: {
  to: string;
  displayName?: string | null;
  headline: string;
  detail: string;
  metrics?: Metric[];
  actionUrl?: string;
}) {
  return sendEmail({
    to: args.to,
    subject: `dreyv opportunity: ${args.headline}`,
    react: OpportunityEmail(args),
  });
}

export async function sendVaultCommandsEmail(args: {
  to: string;
  displayName?: string | null;
  commands: { title: string; why: string }[];
}) {
  return sendEmail({
    to: args.to,
    subject: 'Three commands to run this week',
    react: VaultCommandsEmail(args),
  });
}

export async function sendWeeklyDigestEmail(args: {
  to: string;
  displayName?: string | null;
  weekLabel: string;
  pnlUsd: number;
  pnlPct: number;
  topMover: string;
  feesUsd: number;
  agentActions: number;
  pendingApprovals: number;
}) {
  return sendEmail({
    to: args.to,
    subject: `Your dreyv weekly digest — ${args.weekLabel}`,
    react: WeeklyDigestEmail(args),
  });
}

export async function sendMonthlyReportEmail(args: {
  to: string;
  displayName?: string | null;
  monthLabel: string;
  performanceVsBenchmark: string;
  driftSummary: string;
  scenariosRun: number;
}) {
  return sendEmail({
    to: args.to,
    subject: `Your dreyv ${args.monthLabel} report`,
    react: MonthlyReportEmail(args),
  });
}

export async function sendAnomalyAlertEmail(args: {
  to: string;
  headline: string;
  detail: string;
  metrics?: Metric[];
  actionUrl?: string;
}) {
  return sendEmail({
    to: args.to,
    subject: `dreyv anomaly: ${args.headline}`,
    react: AnomalyAlertEmail(args),
  });
}

export async function sendApprovalNudgeEmail(args: {
  to: string;
  displayName?: string | null;
  count: number;
  oldestHours: number;
  actionUrl?: string;
}) {
  return sendEmail({
    to: args.to,
    subject: `${args.count} approval${args.count === 1 ? '' : 's'} waiting in your vault`,
    react: ApprovalNudgeEmail(args),
  });
}

export async function sendUpgradeNudgeEmail(args: {
  to: string;
  displayName?: string | null;
  currentTier: string;
  suggestedTier: string;
  reason: string;
}) {
  return sendEmail({
    to: args.to,
    subject: `${args.suggestedTier} fits your dreyv usage`,
    react: UpgradeNudgeEmail(args),
  });
}

export async function sendReengagementEmail(args: {
  to: string;
  displayName?: string | null;
  daysAway: number;
  vaultActivity: string;
}) {
  return sendEmail({
    to: args.to,
    subject: 'Your vault kept moving while you were away',
    react: ReengagementEmail(args),
  });
}

export async function sendOnboardingDay1Email(to: string, displayName?: string | null) {
  return sendEmail({ to, subject: 'Step one: connect a wallet', react: OnboardingDay1Email({ displayName }) });
}
export async function sendOnboardingDay3Email(to: string, displayName?: string | null) {
  return sendEmail({ to, subject: 'Run your first dreyv simulation', react: OnboardingDay3Email({ displayName }) });
}
export async function sendOnboardingDay7Email(to: string, displayName?: string | null) {
  return sendEmail({ to, subject: 'Invite your team to dreyv', react: OnboardingDay7Email({ displayName }) });
}
