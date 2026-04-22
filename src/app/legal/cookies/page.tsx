import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "dreyv cookie policy — what cookies we use and why.",
  alternates: { canonical: "/legal/cookies" },
};

export default function CookiesPage() {
  return (
    <>
      <span className="legal-meta">dreyv · Cookies</span>
      <h1>Cookie Policy</h1>
      <p className="text-sm text-slate-500">Last updated: April 6, 2026</p>

      <div className="legal-card">
        <h2>What are cookies</h2>
        <p>
          Cookies are small text files stored on your device when you visit a website.
          They help the site remember your preferences and maintain your session.
        </p>

        <h2>Cookies we use</h2>

        <h3>Essential cookies (always active)</h3>
        <table>
          <thead>
            <tr><th>Cookie</th><th>Purpose</th><th>Duration</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>dreyv-siws-session</code></td>
              <td>Authentication session (Sign-In With Solana JWT)</td>
              <td>7 days</td>
            </tr>
            <tr>
              <td><code>dreyv-cookie-consent</code></td>
              <td>Remembers your cookie consent preference</td>
              <td>1 year</td>
            </tr>
          </tbody>
        </table>

        <h3>Analytics cookies (optional)</h3>
        <p>
          We currently do not use third-party analytics cookies. If we introduce analytics
          in the future, this policy will be updated and your consent will be requested.
        </p>

        <h2>Managing cookies</h2>
        <p>
          You can manage cookies through your browser settings. Note that disabling essential
          cookies will prevent you from signing in to dreyv.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about our cookie practices, contact <strong>privacy@dreyv.com</strong>.
        </p>
      </div>
    </>
  );
}
