/**
 * Settle-up hand-off: Cohive never holds the money (Path A). A member's payout
 * handle turns a transfer into a prefilled link the payer opens in Venmo,
 * Cash App or PayPal. Handles look like venmo:@name, cashapp:$tag, paypal:name.
 */
export interface PayLink {
  app: 'Venmo' | 'Cash App' | 'PayPal';
  href: string;
}

export function payLinkFor(handle: string | null | undefined, amount: number, note: string): PayLink | null {
  if (!handle) return null;
  const [app, raw] = handle.split(':');
  const id = (raw || '').replace(/^[@$]/, '');
  if (!id) return null;
  const amt = amount.toFixed(2);
  const q = (s: string) => encodeURIComponent(s);
  if (app === 'venmo') return { app: 'Venmo', href: `https://account.venmo.com/pay?recipients=${q(id)}&amount=${amt}&note=${q(note)}` };
  if (app === 'cashapp') return { app: 'Cash App', href: `https://cash.app/$${q(id)}/${amt}` };
  if (app === 'paypal') return { app: 'PayPal', href: `https://www.paypal.me/${q(id)}/${amt}USD` };
  return null;
}

export const PAY_HANDLE_RE = /^(venmo|cashapp|paypal):[A-Za-z0-9_.$@-]{2,40}$/;
