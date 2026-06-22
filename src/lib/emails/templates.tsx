import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

// ─── Premium Light brand tokens (matches /pricing, /app shell) ──────
const v = {
  bg: '#ffffff',
  ink: '#0f172a',
  muted: '#475569',
  faint: '#94a3b8',
  violet: '#7c3aed',
  violetDeep: '#6d28d9',
  violet50: '#f5f3ff',
  violet100: '#ede9fe',
  violet200: '#ddd6fe',
  amber: '#f59e0b',
  font:
    "'Manrope', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const APP = 'https://dreyv.com';
const MASCOT = `${APP}/mascot`;

type MascotPose = 'greet' | 'think' | 'celebrate' | 'alert';

function Mascot({ pose, size = 96 }: { pose: MascotPose; size?: number }) {
  return (
    <Img
      src={`${MASCOT}/dreyv-${pose}.png`}
      alt={`Dreyv ${pose}`}
      width={size}
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
}

function PearlMark() {
  return (
    <Img
      src={`${APP}/dreyv-mark.png`}
      alt="dreyv"
      width="32"
      height="32"
      style={{ display: 'block', margin: '0 auto', borderRadius: '8px' }}
    />
  );
}

// ─── Shared Premium Layout ──────────────────────────────────────────
export function DreyvLayout({
  preview,
  eyebrow,
  mascot,
  children,
  footerNote,
}: {
  preview: string;
  eyebrow?: string;
  mascot?: MascotPose;
  children: React.ReactNode;
  footerNote?: string;
}) {
  return (
    <Html>
      <Head>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
          * { box-sizing: border-box; }
          body { -webkit-font-smoothing: antialiased; }
        `}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: v.bg,
          fontFamily: v.font,
          margin: 0,
          padding: 0,
          color: v.ink,
        }}
      >
        <Container
          style={{
            maxWidth: '560px',
            margin: '0 auto',
            padding: '48px 24px',
          }}
        >
          {/* Brand row */}
          <Section style={{ textAlign: 'center', marginBottom: '28px' }}>
            <PearlMark />
            {eyebrow && (
              <Text
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: v.violet,
                  margin: '12px 0 0',
                }}
              >
                {eyebrow}
              </Text>
            )}
          </Section>

          {/* Card */}
          <Section
            style={{
              backgroundColor: v.bg,
              border: `1px solid ${v.violet200}`,
              borderRadius: '24px',
              padding: '40px 32px',
            }}
          >
            {mascot && (
              <Section style={{ textAlign: 'center', marginBottom: '20px' }}>
                <Mascot pose={mascot} />
              </Section>
            )}
            {children}
          </Section>

          {/* Footer */}
          <Section style={{ textAlign: 'center', marginTop: '24px' }}>
            <Text
              style={{
                fontSize: '11px',
                color: v.faint,
                lineHeight: '1.7',
                margin: 0,
              }}
            >
              dreyv — the non-custodial Command-Ops workspace for treasuries.
              {footerNote ? <><br />{footerNote}</> : null}
              <br />
              <Link href={APP} style={{ color: v.faint, textDecoration: 'none' }}>
                dreyv.com
              </Link>
              {' · '}
              <Link href={`${APP}/pricing`} style={{ color: v.faint, textDecoration: 'none' }}>
                pricing
              </Link>
              {' · '}
              <Link href={`${APP}/legal/privacy`} style={{ color: v.faint, textDecoration: 'none' }}>
                privacy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Shared atoms ────────────────────────────────────────────────────
function H1({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      style={{
        fontSize: '28px',
        lineHeight: '1.15',
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: v.ink,
        margin: '0 0 12px',
        textAlign: 'center',
      }}
    >
      {children}
    </Heading>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: '15px',
        lineHeight: '1.6',
        color: v.muted,
        margin: '0 0 28px',
        textAlign: 'center',
      }}
    >
      {children}
    </Text>
  );
}

function PrimaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ textAlign: 'center', margin: '8px 0 16px' }}>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          backgroundColor: v.violet,
          color: '#ffffff',
          fontSize: '14px',
          fontWeight: 700,
          letterSpacing: '0.01em',
          padding: '14px 28px',
          borderRadius: '14px',
          textDecoration: 'none',
        }}
      >
        {children}
      </Link>
    </Section>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <Section
      style={{
        marginTop: '24px',
        padding: '20px',
        backgroundColor: v.violet50,
        border: `1px solid ${v.violet100}`,
        borderRadius: '16px',
      }}
    >
      {items.map((line, i) => (
        <Text
          key={i}
          style={{
            fontSize: '13px',
            lineHeight: '1.6',
            color: v.ink,
            margin: i === 0 ? '0' : '8px 0 0',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '22px',
              color: v.violet,
              fontWeight: 700,
            }}
          >
            {`0${i + 1}`}
          </span>
          {line}
        </Text>
      ))}
    </Section>
  );
}

function FallbackUrl({ href }: { href: string }) {
  return (
    <>
      <Hr style={{ border: 'none', borderTop: `1px solid ${v.violet100}`, margin: '24px 0 14px' }} />
      <Text
        style={{
          fontSize: '11px',
          color: v.faint,
          lineHeight: '1.6',
          textAlign: 'center',
          margin: 0,
          wordBreak: 'break-all',
        }}
      >
        Trouble with the button? Paste this URL into your browser:
        <br />
        <Link href={href} style={{ color: v.violet, textDecoration: 'none' }}>
          {href}
        </Link>
      </Text>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. Welcome ──────────────────────────────────────────────────────
export function WelcomeEmail({ displayName }: { displayName: string }) {
  return (
    <DreyvLayout
      preview="Welcome to dreyv — your sovereign treasury workspace is ready."
      eyebrow="dreyv · welcome"
      mascot="greet"
    >
      <H1>{`Welcome, ${displayName}.`}</H1>
      <Lead>
        Your non-custodial Command-Ops workspace is live. Connect a wallet,
        wire your treasury, and run your first command — Dreyv will keep watch.
      </Lead>
      <PrimaryCTA href={`${APP}/app`}>Open workspace</PrimaryCTA>
      <NumberedList
        items={[
          'Connect a Solana or EVM wallet — read-only first.',
          'Wire your treasury or Squads multisig.',
          'Run your first Command in the workspace.',
        ]}
      />
    </DreyvLayout>
  );
}

// ─── 2. Team Invite ──────────────────────────────────────────────────
export function TeamInviteEmail({
  teamName,
  inviterName,
  role,
  acceptUrl,
}: {
  teamName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  return (
    <DreyvLayout
      preview={`${inviterName} invited you to join ${teamName} on dreyv`}
      eyebrow="dreyv · team invite"
      mascot="greet"
      footerNote="This invite expires in 7 days."
    >
      <H1>{`You're invited to ${teamName}.`}</H1>
      <Lead>
        <strong style={{ color: v.ink }}>{inviterName}</strong> added you as{' '}
        <span style={{ color: v.violet, fontWeight: 700 }}>{role}</span>. Accept to
        join the vault, propose actions, and operate alongside the team.
      </Lead>
      <PrimaryCTA href={acceptUrl}>Accept invitation</PrimaryCTA>
      <FallbackUrl href={acceptUrl} />
    </DreyvLayout>
  );
}

// ─── 3. Notification ─────────────────────────────────────────────────
export function NotificationEmail({
  title,
  message,
  actionUrl,
  actionLabel,
}: {
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}) {
  return (
    <DreyvLayout preview={title} eyebrow="dreyv · notification" mascot="think">
      <H1>{title}</H1>
      <Lead>{message}</Lead>
      {actionUrl && (
        <>
          <PrimaryCTA href={actionUrl}>{actionLabel || 'Open in dreyv'}</PrimaryCTA>
          <FallbackUrl href={actionUrl} />
        </>
      )}
    </DreyvLayout>
  );
}

// ─── 4. Tier Expiry ──────────────────────────────────────────────────
export function TierExpiryEmail({
  tier,
  daysLeft,
}: {
  tier: string;
  daysLeft: number;
}) {
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const renewUrl = `${APP}/pricing`;
  return (
    <DreyvLayout
      preview={`Your dreyv ${tierLabel} plan expires in ${daysLeft} days`}
      eyebrow="dreyv · billing"
      mascot="alert"
    >
      <H1>{`Your ${tierLabel} plan expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`}</H1>
      <Lead>
        Renew to keep extra agent slots, team seats, priority support and the
        full Command surface. Your data stays — only tier-gated features pause.
      </Lead>
      <PrimaryCTA href={renewUrl}>Renew plan</PrimaryCTA>
      <Text
        style={{
          fontSize: '12px',
          color: v.faint,
          textAlign: 'center',
          margin: '8px 0 0',
        }}
      >
        After expiry your account reverts to the Free tier — nothing is deleted.
      </Text>
    </DreyvLayout>
  );
}

// ─── 5. Gas Alert (firing) ───────────────────────────────────────────
export function GasAlertEmail({
  gasPrice,
  ethPrice,
  costUsd,
  gasUnits,
  thresholdUsd,
}: {
  gasPrice: number;
  ethPrice: number;
  costUsd: number;
  gasUnits: number;
  thresholdUsd: number;
}) {
  return (
    <DreyvLayout
      preview="Gas just dropped below your threshold."
      eyebrow="dreyv · gas alert"
      mascot="celebrate"
    >
      <H1>Gas is low — good window to ship.</H1>
      <Lead>
        Mainnet gas dropped under your threshold. Dreyv flagged it so you can
        batch settlements, sweep dust, or rotate positions while it&apos;s cheap.
      </Lead>

      <Section
        style={{
          backgroundColor: v.violet50,
          border: `1px solid ${v.violet100}`,
          borderRadius: '16px',
          padding: '20px 24px',
          margin: '0 0 16px',
        }}
      >
        <table style={{ width: '100%', fontSize: '13px', color: v.ink }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 0', color: v.muted }}>Gas (fast)</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>
                {gasPrice.toFixed(2)} gwei
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: v.muted }}>ETH</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>
                ${ethPrice.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: v.muted }}>
                Cost ({gasUnits.toLocaleString()} gas)
              </td>
              <td
                style={{
                  padding: '4px 0',
                  textAlign: 'right',
                  fontWeight: 700,
                  color: v.violet,
                }}
              >
                ${costUsd.toFixed(4)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: v.muted }}>Your threshold</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>
                ${thresholdUsd.toFixed(4)}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <PrimaryCTA href={`${APP}/app`}>Open workspace</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 6. Gas Alert Verification ───────────────────────────────────────
export function GasAlertVerificationEmail({
  verificationUrl,
  thresholdUsd,
  minGasUnits,
}: {
  verificationUrl: string;
  thresholdUsd: number;
  minGasUnits: number;
}) {
  return (
    <DreyvLayout
      preview="Confirm your dreyv gas alert subscription."
      eyebrow="dreyv · verify alert"
      mascot="think"
    >
      <H1>Confirm your gas alert.</H1>
      <Lead>
        One click and Dreyv starts watching mainnet for you. We&apos;ll only ping
        when gas drops below your threshold — no marketing, no noise.
      </Lead>
      <PrimaryCTA href={verificationUrl}>Verify email</PrimaryCTA>

      <Section
        style={{
          marginTop: '20px',
          padding: '20px',
          backgroundColor: v.violet50,
          border: `1px solid ${v.violet100}`,
          borderRadius: '16px',
        }}
      >
        <Text style={{ fontSize: '12px', color: v.muted, margin: 0 }}>Threshold</Text>
        <Text
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: v.ink,
            margin: '2px 0 12px',
          }}
        >
          ${thresholdUsd.toFixed(2)} per {minGasUnits.toLocaleString()} gas
        </Text>
        <Text style={{ fontSize: '12px', color: v.muted, margin: 0 }}>
          You can change or cancel this alert any time from your dreyv workspace.
        </Text>
      </Section>

      <FallbackUrl href={verificationUrl} />
    </DreyvLayout>
  );
}

// ─── 7. Waitlist confirmation ────────────────────────────────────────
export function WaitlistConfirmationEmail({
  name,
  position,
}: {
  name: string | null;
  position: number;
}) {
  return (
    <DreyvLayout
      preview={`You're #${position} on the dreyv waitlist`}
      eyebrow="dreyv · waitlist"
      mascot="greet"
    >
      <H1>{name ? `${name}, you're in line.` : `You're in line.`}</H1>
      <Lead>
        Position{' '}
        <span style={{ color: v.violet, fontWeight: 700 }}>#{position}</span>. We
        onboard treasuries, DAOs, funds and protocols in small cohorts so every
        new account gets a real walkthrough — not a generic onboarding flow.
      </Lead>
      <PrimaryCTA href={`${APP}/compare`}>See how it compares</PrimaryCTA>
      <NumberedList
        items={[
          'Read the comparison vs Squads, Den, Multis.',
          'Skim the developer surface — APIs, MCP, llms.txt.',
          'Watch your inbox — cohort invites go out weekly.',
        ]}
      />
    </DreyvLayout>
  );
}

// ─── 8. Waitlist invite ──────────────────────────────────────────────
export function WaitlistInviteEmail({
  name,
  inviteUrl,
  expiresInDays,
}: {
  name: string | null;
  inviteUrl: string;
  expiresInDays: number;
}) {
  return (
    <DreyvLayout
      preview="Your dreyv access is open — claim your seat"
      eyebrow="dreyv · invite"
      mascot="celebrate"
      footerNote="You received this because you joined the dreyv waitlist."
    >
      <H1>{name ? `${name}, your seat is ready.` : 'Your seat is ready.'}</H1>
      <Lead>
        You&apos;re in the next cohort. Single-use link, expires in{' '}
        <span style={{ color: v.violet, fontWeight: 700 }}>{expiresInDays} days</span>
        . Connect a wallet — non-custodial by design, multisig-native from day one.
      </Lead>
      <PrimaryCTA href={inviteUrl}>Claim your seat</PrimaryCTA>
      <NumberedList
        items={[
          'Connect a Solana or EVM wallet — read-only first.',
          'Wire your treasury or Squads multisig.',
          'Run your first Command in the workspace.',
        ]}
      />
      <FallbackUrl href={inviteUrl} />
    </DreyvLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PROACTIVE / AGENTIC EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════

// ─── Shared atoms for proactive emails ───────────────────────────────
function MetricRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '6px 0', color: v.muted, fontSize: '13px' }}>{label}</td>
      <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700, fontSize: '13px', color: accent ? v.violet : v.ink }}>
        {value}
      </td>
    </tr>
  );
}

function MetricCard({ rows }: { rows: { label: string; value: string; accent?: boolean }[] }) {
  return (
    <Section style={{ backgroundColor: v.violet50, border: `1px solid ${v.violet100}`, borderRadius: '16px', padding: '18px 22px', margin: '0 0 16px' }}>
      <table style={{ width: '100%' }}>
        <tbody>
          {rows.map((r, i) => <MetricRow key={i} {...r} />)}
        </tbody>
      </table>
    </Section>
  );
}

// ─── 9. Agent Insight ────────────────────────────────────────────────
export function AgentInsightEmail({
  displayName,
  headline,
  detail,
  metrics,
  actionUrl,
  actionLabel,
}: {
  displayName?: string | null;
  headline: string;
  detail: string;
  metrics?: { label: string; value: string; accent?: boolean }[];
  actionUrl?: string;
  actionLabel?: string;
}) {
  return (
    <DreyvLayout preview={headline} eyebrow="dreyv · agent insight" mascot="think">
      <H1>{headline}</H1>
      <Lead>
        {displayName ? `${displayName}, ` : ''}{detail}
      </Lead>
      {metrics && metrics.length > 0 && <MetricCard rows={metrics} />}
      <PrimaryCTA href={actionUrl || `${APP}/app/analytics`}>{actionLabel || 'Open analytics'}</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 10. Opportunity ─────────────────────────────────────────────────
export function OpportunityEmail({
  displayName,
  headline,
  detail,
  metrics,
  actionUrl,
}: {
  displayName?: string | null;
  headline: string;
  detail: string;
  metrics?: { label: string; value: string; accent?: boolean }[];
  actionUrl?: string;
}) {
  return (
    <DreyvLayout preview={headline} eyebrow="dreyv · opportunity" mascot="celebrate">
      <H1>{headline}</H1>
      <Lead>{displayName ? `${displayName}, ` : ''}{detail}</Lead>
      {metrics && metrics.length > 0 && <MetricCard rows={metrics} />}
      <PrimaryCTA href={actionUrl || `${APP}/app`}>Review in workspace</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 11. Vault Commands (weekly tailored) ────────────────────────────
export function VaultCommandsEmail({
  displayName,
  commands,
}: {
  displayName?: string | null;
  commands: { title: string; why: string }[];
}) {
  return (
    <DreyvLayout preview="Three commands to run on your vault this week" eyebrow="dreyv · weekly commands" mascot="greet">
      <H1>{displayName ? `${displayName}, three moves this week.` : 'Three moves this week.'}</H1>
      <Lead>Generated from your live positions. Each one is one click in the workspace — Dreyv pre-builds the plan, you approve.</Lead>
      <Section style={{ margin: '0 0 16px' }}>
        {commands.map((c, i) => (
          <Section key={i} style={{ border: `1px solid ${v.violet100}`, borderRadius: '14px', padding: '14px 18px', margin: '0 0 10px', backgroundColor: v.violet50 }}>
            <Text style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: v.ink }}>
              <span style={{ color: v.violet, marginRight: 8 }}>{`0${i + 1}`}</span>{c.title}
            </Text>
            <Text style={{ margin: '4px 0 0', fontSize: '12px', color: v.muted, lineHeight: 1.5 }}>{c.why}</Text>
          </Section>
        ))}
      </Section>
      <PrimaryCTA href={`${APP}/app`}>Run in workspace</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 12. Weekly Digest ───────────────────────────────────────────────
export function WeeklyDigestEmail({
  displayName,
  weekLabel,
  pnlUsd,
  pnlPct,
  topMover,
  feesUsd,
  agentActions,
  pendingApprovals,
}: {
  displayName?: string | null;
  weekLabel: string;
  pnlUsd: number;
  pnlPct: number;
  topMover: string;
  feesUsd: number;
  agentActions: number;
  pendingApprovals: number;
}) {
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return (
    <DreyvLayout preview={`Your dreyv weekly digest — ${weekLabel}`} eyebrow={`dreyv · weekly · ${weekLabel}`} mascot="think">
      <H1>{displayName ? `${displayName}, your week in dreyv.` : 'Your week in dreyv.'}</H1>
      <Lead>PnL, attribution, agent activity and what&apos;s waiting on you. One screen, no spreadsheet.</Lead>
      <MetricCard rows={[
        { label: 'PnL (week)', value: `${fmt(pnlUsd)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`, accent: true },
        { label: 'Top mover', value: topMover },
        { label: 'Fees paid', value: `$${feesUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
        { label: 'Agent actions', value: `${agentActions}` },
        { label: 'Pending approvals', value: `${pendingApprovals}`, accent: pendingApprovals > 0 },
      ]} />
      <PrimaryCTA href={`${APP}/app/analytics`}>Open full report</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 13. Monthly Report ──────────────────────────────────────────────
export function MonthlyReportEmail({
  displayName,
  monthLabel,
  performanceVsBenchmark,
  driftSummary,
  scenariosRun,
}: {
  displayName?: string | null;
  monthLabel: string;
  performanceVsBenchmark: string;
  driftSummary: string;
  scenariosRun: number;
}) {
  return (
    <DreyvLayout preview={`Your dreyv monthly report — ${monthLabel}`} eyebrow={`dreyv · monthly · ${monthLabel}`} mascot="think">
      <H1>{`${monthLabel} in review.`}</H1>
      <Lead>{displayName ? `${displayName}, ` : ''}performance vs benchmark, drift, and what Foresight ran for you.</Lead>
      <MetricCard rows={[
        { label: 'Vs benchmark', value: performanceVsBenchmark, accent: true },
        { label: 'Drift', value: driftSummary },
        { label: 'Scenarios run', value: `${scenariosRun}` },
      ]} />
      <PrimaryCTA href={`${APP}/app/analytics`}>Open monthly report</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 14. Anomaly Alert ───────────────────────────────────────────────
export function AnomalyAlertEmail({
  headline,
  detail,
  metrics,
  actionUrl,
}: {
  headline: string;
  detail: string;
  metrics?: { label: string; value: string; accent?: boolean }[];
  actionUrl?: string;
}) {
  return (
    <DreyvLayout preview={headline} eyebrow="dreyv · anomaly" mascot="alert">
      <H1>{headline}</H1>
      <Lead>{detail}</Lead>
      {metrics && metrics.length > 0 && <MetricCard rows={metrics} />}
      <PrimaryCTA href={actionUrl || `${APP}/app`}>Investigate now</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 15. Approval Nudge ──────────────────────────────────────────────
export function ApprovalNudgeEmail({
  displayName,
  count,
  oldestHours,
  actionUrl,
}: {
  displayName?: string | null;
  count: number;
  oldestHours: number;
  actionUrl?: string;
}) {
  return (
    <DreyvLayout preview={`${count} approval${count === 1 ? '' : 's'} waiting in your vault`} eyebrow="dreyv · approval pending" mascot="alert">
      <H1>{`${count} approval${count === 1 ? '' : 's'} waiting.`}</H1>
      <Lead>
        {displayName ? `${displayName}, ` : ''}
        the oldest has been pending {oldestHours}h. Multi-sig actions can&apos;t move without your signature.
      </Lead>
      <PrimaryCTA href={actionUrl || `${APP}/app`}>Review approvals</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 16. Upgrade Nudge ───────────────────────────────────────────────
export function UpgradeNudgeEmail({
  displayName,
  currentTier,
  suggestedTier,
  reason,
}: {
  displayName?: string | null;
  currentTier: string;
  suggestedTier: string;
  reason: string;
}) {
  return (
    <DreyvLayout preview={`${suggestedTier} fits your usage better`} eyebrow="dreyv · plan suggestion" mascot="greet">
      <H1>{`${suggestedTier} fits your usage.`}</H1>
      <Lead>
        {displayName ? `${displayName}, ` : ''}you&apos;re on <strong style={{ color: v.ink }}>{currentTier}</strong>. {reason}
      </Lead>
      <PrimaryCTA href={`${APP}/pricing`}>See plans</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 17. Re-engagement ───────────────────────────────────────────────
export function ReengagementEmail({
  displayName,
  daysAway,
  vaultActivity,
}: {
  displayName?: string | null;
  daysAway: number;
  vaultActivity: string;
}) {
  return (
    <DreyvLayout preview="Your vault kept moving while you were away" eyebrow="dreyv · check-in" mascot="think">
      <H1>{`${daysAway} days — but your vault didn't pause.`}</H1>
      <Lead>{displayName ? `${displayName}, ` : ''}{vaultActivity} Worth a look.</Lead>
      <PrimaryCTA href={`${APP}/app`}>Open workspace</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── 18-20. Onboarding drip (Day 1, 3, 7) ────────────────────────────
export function OnboardingDay1Email({ displayName }: { displayName?: string | null }) {
  return (
    <DreyvLayout preview="Step one: connect a wallet (read-only is fine)" eyebrow="dreyv · day 1" mascot="greet">
      <H1>{displayName ? `${displayName}, start with a read-only wallet.` : 'Start with a read-only wallet.'}</H1>
      <Lead>You don&apos;t need to move anything. Connect a Solana or EVM wallet and Dreyv will profile your treasury in seconds.</Lead>
      <PrimaryCTA href={`${APP}/app`}>Connect a wallet</PrimaryCTA>
      <NumberedList items={[
        'Non-custodial — keys never leave your device.',
        'Read-only first — no signatures required.',
        'Multisig-native — Squads & Safe supported.',
      ]} />
    </DreyvLayout>
  );
}

export function OnboardingDay3Email({ displayName }: { displayName?: string | null }) {
  return (
    <DreyvLayout preview="Run your first simulation — Foresight is where it gets fun" eyebrow="dreyv · day 3" mascot="think">
      <H1>{displayName ? `${displayName}, run your first sim.` : 'Run your first simulation.'}</H1>
      <Lead>Foresight runs &quot;what if&quot; on your live positions — yield rotations, drawdowns, drift, runway. Pick a scenario and watch.</Lead>
      <PrimaryCTA href={`${APP}/app/analytics`}>Open Foresight</PrimaryCTA>
    </DreyvLayout>
  );
}

export function OnboardingDay7Email({ displayName }: { displayName?: string | null }) {
  return (
    <DreyvLayout preview="Invite your team — treasuries shouldn't be solo" eyebrow="dreyv · day 7" mascot="celebrate">
      <H1>{displayName ? `${displayName}, bring the team.` : 'Bring your team in.'}</H1>
      <Lead>Roles, approvals, and per-vault permissions are built in. Your CFO, ops lead, or co-founder can join in a click.</Lead>
      <PrimaryCTA href={`${APP}/app`}>Invite teammates</PrimaryCTA>
    </DreyvLayout>
  );
}

// ─── Agent Deliverable (snapshot / report ready) ─────────────────────
// Premium light, mascot=celebrate. Renders 3 headline stats from `summary`,
// the truncated target wallet, the agent-key label, and a deep link to the
// permalink view page on the dashboard.
function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <Section
      style={{
        marginTop: '24px',
        padding: '18px 12px',
        backgroundColor: v.violet50,
        border: `1px solid ${v.violet100}`,
        borderRadius: '16px',
      }}
    >
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            {stats.map((s, i) => (
              <td
                key={i}
                style={{
                  width: `${100 / stats.length}%`,
                  textAlign: 'center',
                  padding: '4px 8px',
                  borderLeft: i === 0 ? 'none' : `1px solid ${v.violet100}`,
                }}
              >
                <Text style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: v.violet, margin: 0 }}>
                  {s.label}
                </Text>
                <Text style={{ fontSize: '18px', fontWeight: 700, color: v.ink, margin: '6px 0 0', lineHeight: '1.2' }}>
                  {s.value}
                </Text>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function MetaRow({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <Section style={{ marginTop: '20px' }}>
      {rows.map((r, i) => (
        <Text
          key={i}
          style={{
            fontSize: '12px',
            color: v.muted,
            margin: i === 0 ? '0' : '6px 0 0',
            lineHeight: '1.5',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ color: v.faint, display: 'inline-block', minWidth: '92px' }}>{r.label}</span>
          <span style={{ color: v.ink, fontWeight: 600 }}>{r.value}</span>
        </Text>
      ))}
    </Section>
  );
}

export interface AgentDeliverableEmailProps {
  kind: 'snapshot' | 'report';
  skuName: string;
  targetWallet: string;
  agentKeyLabel: string;
  amountUsdc: string;
  stats: { label: string; value: string }[];
  viewUrl: string;
  pdfUrl?: string | null;
  paidAt: string;
}

export function AgentDeliverableEmail(props: AgentDeliverableEmailProps) {
  const verb = props.kind === 'snapshot' ? 'snapshot' : 'report';
  return (
    <DreyvLayout
      preview={`Your treasury ${verb} is ready — paid via agent in USDC.`}
      eyebrow={`dreyv · ${verb} ready`}
      mascot="celebrate"
      footerNote={`Triggered by agent key “${props.agentKeyLabel}”.`}
    >
      <H1>{`Your ${props.skuName} is ready.`}</H1>
      <Lead>
        Your agent paid {props.amountUsdc} USDC on Solana mainnet and we've generated a fresh
        {' '}{verb} for the wallet below. It's permanently saved to your workspace.
      </Lead>
      <StatGrid stats={props.stats} />
      <MetaRow
        rows={[
          { label: 'Wallet', value: props.targetWallet },
          { label: 'Agent key', value: props.agentKeyLabel },
          { label: 'Paid', value: props.paidAt },
        ]}
      />
      <PrimaryCTA href={props.viewUrl}>{`Open ${verb}`}</PrimaryCTA>
      {props.pdfUrl ? (
        <Section style={{ textAlign: 'center', marginTop: '4px' }}>
          <Link href={props.pdfUrl} style={{ fontSize: '12px', color: v.violet, textDecoration: 'none', fontWeight: 600 }}>
            Download PDF →
          </Link>
        </Section>
      ) : null}
      <FallbackUrl href={props.viewUrl} />
    </DreyvLayout>
  );
}

// ─── Subscription Activated ──────────────────────────────────────────
export interface SubscriptionActivatedEmailProps {
  tier: 'mini' | 'max';
  renewalDate: string;
  agentKeyLabel: string;
  amountUsdc: string;
  manageUrl: string;
}

export function SubscriptionActivatedEmail(props: SubscriptionActivatedEmailProps) {
  const tierName = props.tier === 'max' ? 'Max' : 'Mini';
  const perks =
    props.tier === 'max'
      ? [
          'Unlimited Foresight simulations + multi-agent runs.',
          'Priority RPC tier and 10× higher rate limits across the API.',
          'Direct line to the team via Slack Connect for incidents.',
        ]
      : [
          'Full /app workspace: Analytics, Atlas, Studio, Agent Store.',
          '10× higher rate limits than Free across every endpoint.',
          'Email + in-app alerts for anomalies, drift, and approvals.',
        ];
  return (
    <DreyvLayout
      preview={`Your dreyv ${tierName} plan is active — paid via agent in USDC.`}
      eyebrow={`dreyv · ${tierName.toLowerCase()} active`}
      mascot="celebrate"
      footerNote={`Activated by agent key “${props.agentKeyLabel}”.`}
    >
      <H1>{`Welcome to dreyv ${tierName}.`}</H1>
      <Lead>
        Your agent paid {props.amountUsdc} USDC on Solana mainnet. Your plan is active and
        renews on {props.renewalDate}.
      </Lead>
      <NumberedList items={perks} />
      <PrimaryCTA href={props.manageUrl}>Manage subscription</PrimaryCTA>
      <FallbackUrl href={props.manageUrl} />
    </DreyvLayout>
  );
}

