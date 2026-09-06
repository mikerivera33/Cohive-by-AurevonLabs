# Cohive billing setup (Stripe)

## Plans

| Plan | Price | Stripe mode |
|------|-------|-------------|
| Cohive+ | $4.99/mo | subscription |
| Cohive+ Annual | $33/yr | subscription |
| Platinum | $129 once | one-time payment |

## Environment

Copy `app/.env.example` → `app/.env.local` and set:

```
STRIPE_SECRET_KEY=rk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_COHIVE_PLUS=price_...
STRIPE_PRICE_COHIVE_PLUS_ANNUAL=price_...
STRIPE_PRICE_PLATINUM=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
COHIVE_PUBLIC_URL=https://your-production-domain
```

Claim any sandbox in `app/.env.local` (`stripe sandbox claim`) before expiry, then replace with your live keys.

## Webhook

`POST https://<domain>/api/billing/webhook`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

```bash
stripe listen --forward-to localhost:8080/api/billing/webhook
```

## Flow

1. PricingSheet → `POST /api/billing/checkout`
2. Stripe Checkout
3. Return `/?billing=success&session_id=...` → `POST /api/billing/sync`
4. Webhook applies entitlement (source of truth)
5. Manage billing → Customer Portal

## Go-live

- Claim/create Stripe account
- Enable payment methods in Dashboard (never hardcode `payment_method_types`)
- Consider Stripe Tax + registrations before `automatic_tax`
- Set live env on host
- Have counsel review `/legal/TERMS_OF_SERVICE.md`
