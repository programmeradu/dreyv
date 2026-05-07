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
      src={`${MASCOT}/dryv-${pose}.png`}
      alt={`Dryv ${pose}`}
      width={size}
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
}

function PearlMark() {
  return (
    <Img
      src={`${APP}/dreyv-mark.svg`}
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
        wire your treasury, and run your first command — Dryv will keep watch.
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
        Mainnet gas dropped under your threshold. Dryv flagged it so you can
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
        One click and Dryv starts watching mainnet for you. We&apos;ll only ping
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
