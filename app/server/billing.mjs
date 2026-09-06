/**
 * Stripe billing for Cohive — Checkout Sessions + Customer Portal + webhooks.
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_COHIVE_PLUS        (monthly)
 *   STRIPE_PRICE_COHIVE_PLUS_ANNUAL
 *   STRIPE_PRICE_PLATINUM           (one-time)
 *   COHIVE_PUBLIC_URL | URL         (success/cancel / portal return)
 */
import Stripe from 'stripe';

/** @typedef {'Free' | 'Cohive+' | 'Cohive+ Annual' | 'Platinum'} PlanTier */

const PAID_TIERS = /** @type {const} */ (['Cohive+', 'Cohive+ Annual', 'Platinum']);

export function isPaidTier(tier) {
  return PAID_TIERS.includes(tier);
}

export function billingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && priceMap().plus);
}

function publicBase() {
  return String(process.env.COHIVE_PUBLIC_URL || process.env.URL || 'http://localhost:5173').replace(
    /\/$/,
    ''
  );
}

function priceMap() {
  return {
    plus: process.env.STRIPE_PRICE_COHIVE_PLUS || '',
    annual: process.env.STRIPE_PRICE_COHIVE_PLUS_ANNUAL || '',
    platinum: process.env.STRIPE_PRICE_PLATINUM || '',
  };
}

/** @returns {PlanTier | null} */
export function tierFromPriceId(priceId) {
  const m = priceMap();
  if (!priceId) return null;
  if (priceId === m.plus) return 'Cohive+';
  if (priceId === m.annual) return 'Cohive+ Annual';
  if (priceId === m.platinum) return 'Platinum';
  return null;
}

/** @returns {PlanTier | null} */
export function tierFromCheckoutTier(tier) {
  if (tier === 'Cohive+' || tier === 'Cohive+ Annual' || tier === 'Platinum') return tier;
  return null;
}

function priceIdForTier(tier) {
  const m = priceMap();
  if (tier === 'Cohive+') return m.plus;
  if (tier === 'Cohive+ Annual') return m.annual;
  if (tier === 'Platinum') return m.platinum;
  return '';
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Use account-default API version from the secret key.
  return new Stripe(key);
}

export function billingPublicConfig() {
  return {
    configured: billingConfigured(),
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    tiers: {
      'Cohive+': { priceId: priceMap().plus || null, mode: 'subscription' },
      'Cohive+ Annual': { priceId: priceMap().annual || null, mode: 'subscription' },
      Platinum: { priceId: priceMap().platinum || null, mode: 'payment' },
    },
  };
}

/**
 * @param {{ id: string, email: string, name?: string, stripeCustomerId?: string | null }} user
 * @param {PlanTier} tier
 */
export async function createCheckoutSession(user, tier) {
  const stripe = getStripe();
  if (!stripe || !billingConfigured()) {
    return { error: 'billing_not_configured', status: 503 };
  }
  const plan = tierFromCheckoutTier(tier);
  if (!plan) return { error: 'invalid_tier', status: 400 };
  const priceId = priceIdForTier(plan);
  if (!priceId) return { error: 'price_not_configured', status: 503 };

  const mode = plan === 'Platinum' ? 'payment' : 'subscription';
  const base = publicBase();
  const customerId = await ensureCustomer(stripe, user);

  const session = await stripe.checkout.sessions.create({
    mode,
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?billing=cancel`,
    metadata: {
      userId: user.id,
      planTier: plan,
    },
    subscription_data:
      mode === 'subscription'
        ? {
            metadata: { userId: user.id, planTier: plan },
          }
        : undefined,
    payment_intent_data:
      mode === 'payment'
        ? {
            metadata: { userId: user.id, planTier: plan },
          }
        : undefined,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    // Tag for Dashboard comparison (API versions that support it ignore unknown params safely via SDK).
    // integration_identifier omitted on older pinned apiVersion for compatibility.
  });

  return { url: session.url, sessionId: session.id, mode, customerId };
}

/**
 * @param {{ id: string, email: string, name?: string, stripeCustomerId?: string | null }} user
 */
export async function createPortalSession(user) {
  const stripe = getStripe();
  if (!stripe || !billingConfigured()) {
    return { error: 'billing_not_configured', status: 503 };
  }
  if (!user.stripeCustomerId) {
    return { error: 'no_customer', status: 400 };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${publicBase()}/?billing=portal`,
  });
  return { url: session.url };
}

async function ensureCustomer(stripe, user) {
  if (user.stripeCustomerId) {
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user.stripeCustomerId;
    } catch {
      // fall through and create
    }
  }
  const customer = await stripe.customers.create({
    email: user.email && !String(user.email).endsWith('@cohive.local') ? user.email : undefined,
    name: user.name || undefined,
    metadata: { userId: user.id },
  });
  return customer.id;
}

/**
 * Apply a completed Checkout Session onto the store user.
 * @param {import('stripe').default} stripe
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @param {*} store
 */
export async function applyCheckoutSession(stripe, session, store) {
  const userId =
    session.metadata?.userId ||
    session.client_reference_id ||
    (typeof session.customer === 'string'
      ? store.findUserIdByStripeCustomer(session.customer)
      : null);
  if (!userId) return { error: 'user_not_found' };

  let tier = /** @type {PlanTier | null} */ (session.metadata?.planTier || null);
  let priceId = null;
  let subscriptionId = null;

  if (session.mode === 'subscription' && session.subscription) {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    subscriptionId = subId;
    const sub = await stripe.subscriptions.retrieve(subId);
    priceId = sub.items?.data?.[0]?.price?.id || null;
    tier = tierFromPriceId(priceId) || tier;
  } else if (session.mode === 'payment') {
    // Lifetime / one-time
    const line = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    priceId = line.data?.[0]?.price?.id || null;
    tier = tierFromPriceId(priceId) || tier || 'Platinum';
  }

  if (!tier || tier === 'Free') return { error: 'unknown_tier' };

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  return store.applyEntitlement(userId, {
    planTier: tier,
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
  });
}

/**
 * @param {string} rawBody
 * @param {string | null} signature
 * @param {*} store
 */
export async function handleStripeWebhook(rawBody, signature, store) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return { error: 'billing_not_configured', status: 503 };
  }
  if (!signature) return { error: 'missing_signature', status: 400 };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    return { error: 'invalid_signature', status: 400, message: String(e?.message || e) };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.payment_status === 'paid' || session.status === 'complete') {
        await applyCheckoutSession(stripe, session, store);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      const userId =
        sub.metadata?.userId || (customerId ? store.findUserIdByStripeCustomer(customerId) : null);
      if (!userId) break;
      if (event.type === 'customer.subscription.deleted' || sub.status === 'canceled') {
        // Don't strip Platinum lifetime (one-time) when a separate sub cancels.
        const user = store.getUserById?.(userId);
        if (user?.planTier === 'Platinum' && !user.stripeSubscriptionId) break;
        if (user?.planTier === 'Platinum' && user.stripeSubscriptionId !== sub.id) break;
        store.applyEntitlement(userId, {
          planTier: 'Free',
          stripeSubscriptionId: null,
          stripePriceId: null,
        });
      } else {
        const priceId = sub.items?.data?.[0]?.price?.id || null;
        const tier = tierFromPriceId(priceId) || tierFromCheckoutTier(sub.metadata?.planTier);
        if (tier) {
          store.applyEntitlement(userId, {
            planTier: tier,
            stripeCustomerId: customerId || null,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
          });
        }
      }
      break;
    }
    default:
      break;
  }

  return { ok: true, type: event.type };
}

/**
 * Confirm a session after redirect (idempotent entitlement apply).
 */
export async function syncCheckoutSession(sessionId, userId, store) {
  const stripe = getStripe();
  if (!stripe || !billingConfigured()) {
    return { error: 'billing_not_configured', status: 503 };
  }
  if (!sessionId) return { error: 'missing_session', status: 400 };
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const sessionUser = session.metadata?.userId || session.client_reference_id;
  if (sessionUser && sessionUser !== userId) {
    return { error: 'session_user_mismatch', status: 403 };
  }
  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    return { error: 'not_paid', status: 402, payment_status: session.payment_status };
  }
  const applied = await applyCheckoutSession(stripe, session, store);
  if (applied?.error) return { error: applied.error, status: 400 };
  return { ok: true, user: applied.user };
}
