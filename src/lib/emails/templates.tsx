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

// ─── dreyv brand tokens ───────────────────────────────────────────
const brand = {
  bg: '#0a0a0f',
  cardBg: '#111118',
  border: '#1e1e2e',
  accent: '#36e27b',
  accentMuted: 'rgba(54, 226, 123, 0.15)',
  text: '#e4e4e7',
  textMuted: '#71717a',
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

// ─── Shared Layout ───────────────────────────────────────────────────
export function DreyvLayout({
  preview,
  children,
}: {
  preview: string;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head>
        <style>{`* { box-sizing: border-box; }`}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: brand.bg,
          fontFamily: brand.fontFamily,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: '560px',
            margin: '0 auto',
            padding: '40px 20px',
          }}
        >
          {/* Logo */}
          <Section style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Text
              style={{
                fontSize: '14px',
                fontWeight: 900,
                letterSpacing: '0.15em',
                color: brand.accent,
                margin: 0,
              }}
            >
              ◆ dreyv
            </Text>
          </Section>

          {/* Main card */}
          <Section
            style={{
              backgroundColor: brand.cardBg,
              border: `1px solid ${brand.border}`,
              borderRadius: '16px',
              padding: '40px 32px',
            }}
          >
            {children}
          </Section>

          {/* Footer */}
          <Section style={{ textAlign: 'center', marginTop: '32px' }}>
            <Text
              style={{
                fontSize: '11px',
                color: brand.textMuted,
                lineHeight: '1.6',
                margin: 0,
              }}
            >
              dreyv Treasury OS — Sovereign infrastructure for on-chain teams.
              <br />
              <Link href="https://stauniverse.tech" style={{ color: brand.textMuted }}>
                stauniverse.tech
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Shared heading ──────────────────────────────────────────────────
function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      style={{
        fontSize: '22px',
        fontWeight: 900,
        color: '#ffffff',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        margin: '0 0 8px 0',
        textAlign: 'center',
      }}
    >
      {children}
    </Heading>
  );
}

function EmailSubtext({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: '14px',
        color: brand.textMuted,
        lineHeight: '1.6',
        textAlign: 'center',
        margin: '0 0 24px 0',
      }}
    >
      {children}
    </Text>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ textAlign: 'center', margin: '24px 0' }}>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          backgroundColor: brand.accent,
          color: '#000000',
          fontSize: '12px',
          fontWeight: 900,
          letterSpacing: '0.15em',
          textTransform: 'uppercase' as const,
          padding: '14px 32px',
          borderRadius: '12px',
          textDecoration: 'none',
        }}
      >
        {children}
      </Link>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. Welcome Email ────────────────────────────────────────────────
export function WelcomeEmail({ displayName }: { displayName: string }) {
  return (
    <DreyvLayout preview="Welcome to dreyv — your sovereign treasury is ready.">
      <EmailHeading>Welcome, {displayName}</EmailHeading>
      <EmailSubtext>
        Your sovereign treasury operating system is live. You&apos;re now part of a
        new generation of on-chain teams managing assets with full autonomy.
      </EmailSubtext>

      <Section
        style={{
          backgroundColor: brand.accentMuted,
          borderRadius: '12px',
          padding: '20px 24px',
          margin: '0 0 20px 0',
        }}
      >
        <Text style={{ fontSize: '12px', fontWeight: 700, color: brand.accent, margin: '0 0 8px 0', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
          WHAT YOU CAN DO NOW
        </Text>
        <Text style={{ fontSize: '13px', color: brand.text, margin: 0, lineHeight: '1.8' }}>
          → Connect and manage multi-sig vaults{'\n'}
          → Deploy AI agents for treasury ops{'\n'}
          → Invite your team with role-based access{'\n'}
          → Build custom mini-apps in the Studio
        </Text>
      </Section>

      <PrimaryButton href="https://stauniverse.tech/app">
        Open Dashboard →
      </PrimaryButton>
    </DreyvLayout>
  );
}

// ─── 2. Team Invite Email ────────────────────────────────────────────
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
    <DreyvLayout preview={`${inviterName} invited you to join ${teamName} on dreyv`}>
      <EmailHeading>You&apos;re Invited</EmailHeading>
      <EmailSubtext>
        <strong style={{ color: '#ffffff' }}>{inviterName}</strong> has invited you to
        join <strong style={{ color: '#ffffff' }}>{teamName}</strong> as
        a <strong style={{ color: brand.accent }}>{role}</strong>.
      </EmailSubtext>

      <Section
        style={{
          backgroundColor: brand.accentMuted,
          borderRadius: '12px',
          padding: '16px 24px',
          margin: '0 0 20px 0',
          textAlign: 'center',
        }}
      >
        <Text style={{ fontSize: '11px', color: brand.textMuted, margin: '0 0 4px 0', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
          TEAM
        </Text>
        <Text style={{ fontSize: '18px', fontWeight: 900, color: '#ffffff', margin: 0 }}>
          {teamName}
        </Text>
      </Section>

      <PrimaryButton href={acceptUrl}>
        Accept Invitation →
      </PrimaryButton>

      <Text style={{ fontSize: '11px', color: brand.textMuted, textAlign: 'center', margin: 0 }}>
        This invitation expires in 7 days.
      </Text>
    </DreyvLayout>
  );
}

// ─── 3. Notification Email ───────────────────────────────────────────
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
    <DreyvLayout preview={title}>
      <EmailHeading>{title}</EmailHeading>
      <EmailSubtext>{message}</EmailSubtext>

      {actionUrl && (
        <PrimaryButton href={actionUrl}>
          {actionLabel || 'View in dreyv →'}
        </PrimaryButton>
      )}
    </DreyvLayout>
  );
}

// ─── 4. Tier Expiry Warning ──────────────────────────────────────────
export function TierExpiryEmail({
  tier,
  daysLeft,
}: {
  tier: string;
  daysLeft: number;
}) {
  return (
    <DreyvLayout preview={`Your dreyv ${tier} plan expires in ${daysLeft} days`}>
      <EmailHeading>Plan Expiring Soon</EmailHeading>
      <EmailSubtext>
        Your <strong style={{ color: brand.accent }}>{tier.toUpperCase()}</strong> plan
        expires in <strong style={{ color: '#ffffff' }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong>.
        Renew to keep access to premium features.
      </EmailSubtext>

      <Section
        style={{
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '12px',
          padding: '16px 24px',
          margin: '0 0 20px 0',
        }}
      >
        <Text style={{ fontSize: '12px', color: '#fca5a5', margin: 0, lineHeight: '1.6' }}>
          After expiry, your account will revert to the Free tier.
          Existing data will be preserved, but tier-limited features
          (extra agents, team seats, priority support) will be disabled.
        </Text>
      </Section>

      <PrimaryButton href="https://stauniverse.tech/pricing">
        Renew Plan →
      </PrimaryButton>
    </DreyvLayout>
  );
}

// ─── 5. Gas Alert Email (replacing inline HTML) ──────────────────────
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
    <DreyvLayout preview="⛽ Gas prices are low — great time to transact!">
      <EmailHeading>⛽ Gas Alert</EmailHeading>
      <EmailSubtext>Gas prices have dropped below your threshold.</EmailSubtext>

      <Section
        style={{
          backgroundColor: brand.accentMuted,
          borderRadius: '12px',
          padding: '20px 24px',
          margin: '0 0 20px 0',
        }}
      >
        <table style={{ width: '100%', fontSize: '13px', color: brand.text }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 0', color: brand.textMuted }}>Gas Price (Fast)</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>{gasPrice.toFixed(2)} gwei</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: brand.textMuted }}>ETH Price</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>${ethPrice.toFixed(2)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: brand.textMuted }}>Cost ({gasUnits.toLocaleString()} gas)</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700, color: brand.accent }}>${costUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 0', color: brand.textMuted }}>Your Threshold</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>${thresholdUsd.toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <PrimaryButton href="https://stauniverse.tech/app">
        Open dreyv →
      </PrimaryButton>
    </DreyvLayout>
  );
}

// ─── Waitlist: confirmation ──────────────────────────────────────────
export function WaitlistConfirmationEmail({
  name,
  position,
}: {
  name: string | null;
  position: number;
}) {
  const greeting = name ? `${name}, you're in line.` : "You're in line.";
  return (
    <DreyvLayout preview={`You're #${position} on the dreyv waitlist`}>
      <EmailHeading>You're on the list</EmailHeading>
      <EmailSubtext>{greeting}</EmailSubtext>
      <Text
        style={{
          fontSize: '14px',
          color: brand.text,
          lineHeight: '1.6',
          textAlign: 'center',
          margin: '0 0 24px 0',
        }}
      >
        Position{' '}
        <span style={{ color: brand.accent, fontWeight: 700 }}>#{position}</span>.
        We onboard treasuries, DAOs, funds and protocols in small cohorts so every
        new account gets a real walkthrough.
      </Text>
      <Text
        style={{
          fontSize: '13px',
          color: brand.textMuted,
          lineHeight: '1.6',
          textAlign: 'center',
          margin: '0 0 24px 0',
        }}
      >
        While you wait — read how dreyv compares, or browse the developer surface.
      </Text>
      <PrimaryButton href="https://dreyv.com/compare">
        See how it compares
      </PrimaryButton>
    </DreyvLayout>
  );
}

// ─── Waitlist: invite ────────────────────────────────────────────────
// Premium light, Stitch-inspired. Solid violet only — no gradients, no
// fuchsia. Manrope. Violet-200 borders. Pearl/stone motif via inline SVG.
const v = {
  bg: '#ffffff',
  ink: '#0f172a',
  muted: '#475569',
  faint: '#94a3b8',
  violet: '#7c3aed',
  violet50: '#f5f3ff',
  violet100: '#ede9fe',
  violet200: '#ddd6fe',
  font:
    "'Manrope', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

function PearlMark() {
  // Inline SVG "stone" — solid violet, no gradients
  return (
    <Img
      src="https://dreyv.com/dreyv-mark.svg"
      alt="dreyv"
      width="36"
      height="36"
      style={{ display: 'block', margin: '0 auto', borderRadius: '10px' }}
    />
  );
}

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
    <Html>
      <Head>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
          * { box-sizing: border-box; }
          body { -webkit-font-smoothing: antialiased; }
        `}</style>
      </Head>
      <Preview>Your dreyv access is open — claim your seat</Preview>
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
              dreyv · invite
            </Text>
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
              {name ? `${name}, your seat is ready.` : 'Your seat is ready.'}
            </Heading>
            <Text
              style={{
                fontSize: '15px',
                lineHeight: '1.6',
                color: v.muted,
                margin: '0 0 28px',
                textAlign: 'center',
              }}
            >
              You&apos;re in cohort 03. Single-use link, expires in{' '}
              <span style={{ color: v.violet, fontWeight: 700 }}>
                {expiresInDays} days
              </span>
              . Connect a wallet — non-custodial by design, multisig-native from day one.
            </Text>

            {/* CTA */}
            <Section style={{ textAlign: 'center', margin: '8px 0 24px' }}>
              <Link
                href={inviteUrl}
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
                Claim your seat →
              </Link>
            </Section>

            {/* Quiet checklist */}
            <Section
              style={{
                marginTop: '28px',
                padding: '20px',
                backgroundColor: v.violet50,
                border: `1px solid ${v.violet100}`,
                borderRadius: '16px',
              }}
            >
              {[
                'Connect a Solana or EVM wallet — read-only first.',
                'Wire your treasury or Squads multisig.',
                'Run your first Command in the workspace.',
              ].map((line, i) => (
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
                      width: '18px',
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

            <Hr style={{ border: 'none', borderTop: `1px solid ${v.violet100}`, margin: '28px 0 16px' }} />

            <Text
              style={{
                fontSize: '11px',
                color: v.faint,
                lineHeight: '1.6',
                textAlign: 'center',
                margin: '0',
                wordBreak: 'break-all',
              }}
            >
              Trouble with the button? Paste this URL into your browser:
              <br />
              <Link href={inviteUrl} style={{ color: v.violet, textDecoration: 'none' }}>
                {inviteUrl}
              </Link>
            </Text>
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
              <br />
              You received this because you joined the dreyv waitlist.
              <br />
              <Link href="https://dreyv.com" style={{ color: v.faint }}>
                dreyv.com
              </Link>
              {' · '}
              <Link href="https://dreyv.com/legal/privacy" style={{ color: v.faint }}>
                privacy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

