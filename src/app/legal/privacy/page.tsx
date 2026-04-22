import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "dreyv privacy policy — how we collect, use, and protect your data.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <span className="legal-meta">dreyv · Privacy</span>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-slate-500">Last updated: April 6, 2026</p>

      <div className="legal-card">
        <h2>1. Information we collect</h2>
        <p>dreyv collects the minimum information necessary to provide our treasury workspace:</p>
        <ul>
          <li><strong>Wallet addresses</strong> you connect to the platform (public blockchain data).</li>
          <li><strong>Email address</strong> if you provide one during onboarding (optional).</li>
          <li><strong>Usage data</strong> such as feature interactions, page views, and error logs for service improvement.</li>
          <li><strong>Authentication tokens</strong> (session cookies) for maintaining your signed-in session.</li>
        </ul>

        <h2>2. How we use your information</h2>
        <ul>
          <li>Providing, maintaining, and improving our treasury management services.</li>
          <li>Authenticating your identity via Sign-In With Solana (SIWS).</li>
          <li>Sending service-related communications (if you provide an email).</li>
          <li>Detecting and preventing fraud, abuse, or security incidents.</li>
        </ul>

        <h2>3. Data storage and security</h2>
        <p>
          Your data is stored in encrypted databases hosted on Neon (PostgreSQL). We use industry-standard
          encryption (AES-256-GCM) for sensitive data at rest and TLS for data in transit. We never store
          private keys on our servers.
        </p>

        <h2>4. Data sharing</h2>
        <p>We do not sell your personal data. We may share data with:</p>
        <ul>
          <li>Infrastructure providers (Vercel, Neon, Supabase) necessary to operate the service.</li>
          <li>Blockchain networks (Solana) as required for transaction execution.</li>
          <li>Law enforcement when required by applicable law.</li>
        </ul>

        <h2>5. Your rights (GDPR)</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access</strong> your personal data via the data export feature in Settings.</li>
          <li><strong>Delete</strong> your account and associated data via the account deletion feature.</li>
          <li><strong>Rectify</strong> inaccurate data by updating your profile.</li>
          <li><strong>Object</strong> to data processing by contacting us.</li>
        </ul>

        <h2>6. Cookies</h2>
        <p>
          We use essential cookies for authentication. See our <a href="/legal/cookies">Cookie Policy</a> for details.
        </p>

        <h2>7. Contact</h2>
        <p>
          For privacy-related inquiries, contact us at <strong>privacy@dreyv.com</strong>.
        </p>
      </div>
    </>
  );
}
