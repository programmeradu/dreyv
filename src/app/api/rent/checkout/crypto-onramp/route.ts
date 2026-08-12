import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const amount = searchParams.get("amount") || "50";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Dreyv - Crypto Onramp</title>
  <script src="https://js.stripe.com/dahlia/stripe.js"></script>
  <script src="https://crypto-js.stripe.com/crypto-onramp-outer.js"></script>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      try {
        const standaloneOnramp = window.StripeOnramp.Standalone({
          source_currency: 'eur',
          amount: { source_amount: '${amount}' },
          destination_networks: ['solana', 'ethereum'],
          destination_currencies: ['usdc', 'sol', 'eth'],
          destination_currency: 'usdc',
          destination_network: 'solana'
        });
        window.location.href = standaloneOnramp.getUrl();
      } catch (err) {
        console.error("Failed to initialize Stripe Onramp", err);
        document.body.innerHTML = "Failed to load Stripe Onramp. Please try again.";
      }
    });
  </script>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-color: #f9fafb;
      color: #374151;
    }
  </style>
</head>
<body>
  <p>Preparing Stripe Onramp...</p>
</body>
</html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}
