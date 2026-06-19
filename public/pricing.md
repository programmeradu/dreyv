# dreyv — Pricing

> Machine-readable pricing for AI agents. Canonical source: https://dreyv.com/pricing

Billing providers: **Stripe** (cards, global) and **Paystack** (cards, mobile money, bank — Africa-first). Pick whichever rails work best for you at checkout.
All prices in USD. Taxes shown at checkout. Monthly billing; annual available on request.

## Plans

### Free — $0 / month
For solo operators.
- 1 multisig vault
- Up to 2 teammates
- 3 mini-apps
- 10 agent runs / day
- 60 API calls / hour
- 1 GB storage
- Community support
- Sign up: https://dreyv.com/auth?redirect=/app

### Mini — $49 / month
For growing squads.
- Up to 5 multisig vaults
- 10 teammates per vault
- 20 mini-apps
- 200 agent runs / day
- 600 API calls / hour
- 10 GB storage
- Foresight Simulator (extended horizon)
- Email support
- Subscribe: https://dreyv.com/pricing

### Max — $199 / month
For protocols and DAOs.
- Unlimited multisig vaults
- Unlimited teammates
- Unlimited mini-apps
- 2,000 agent runs / day
- 6,000 API calls / hour
- 100 GB storage
- Priority AI models (Groq + OpenAI premium routing)
- Dedicated Simulation Firewall policies
- SLA + priority support
- Subscribe: https://dreyv.com/pricing

## Add-ons
- Additional agent runs: metered, contact sales
- Custom on-prem / VPC deployment: contact sales (founders@dreyv.com)

## Refunds
See https://dreyv.com/legal/refunds

## Machine-readable JSON

```json
{
  "currency": "USD",
  "billing_providers": ["stripe", "paystack"],
  "plans": [
    {"id": "free",  "name": "Free",  "price_month": 0,   "vaults": 1,         "teammates_per_vault": 2,  "agent_runs_per_day": 10,   "api_calls_per_hour": 60,   "storage_gb": 1},
    {"id": "mini",  "name": "Mini",  "price_month": 49,  "vaults": 5,         "teammates_per_vault": 10, "agent_runs_per_day": 200,  "api_calls_per_hour": 600,  "storage_gb": 10},
    {"id": "max",   "name": "Max",   "price_month": 199, "vaults": "unlimited","teammates_per_vault":"unlimited","agent_runs_per_day":2000,"api_calls_per_hour":6000,"storage_gb":100}
  ]
}
```
