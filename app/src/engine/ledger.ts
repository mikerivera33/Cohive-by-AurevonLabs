/**
 * Trip money — cost splitting + the shared pot.
 *
 * Framework-free and dependency-free (bundled into the API server alongside
 * the itinerary engine), so the same rules run on the client and the server.
 *
 * Model — "pot + envelopes" (the Revolut Group Vault / Braid pool rule):
 *   • Each member's money in the pot sits in their own envelope:
 *       envelope(m) = contributed(m) − withdrawn(m) − shares of pot-paid spends.
 *   • A member may withdraw only what is in their own envelope — never anyone
 *     else's money (`withdrawable`).
 *   • Paying an expense from the pot charges each participant's share to their
 *     own envelope, and is refused unless every participant can cover their
 *     share (`potShortfalls`). Envelopes therefore never go negative and
 *     Σ envelopes === pot at all times.
 *   • Expenses paid by a person are split Splitwise-style: net balance =
 *     paid − owed, then a greedy min-cash-flow pass suggests who pays whom.
 *
 * All amounts are currency units with at most 2 decimals; maths is done in
 * integer cents so shares always add up to the total exactly.
 */

export type MemberId = number | string;

/** Who covered an expense: a member, or the shared pot. */
export type Payer = MemberId | 'pot';

export interface LedgerExpense {
  id: number;
  amount: number;
  category?: string;
  /** Defaults to `defaultPayer` (the current user) for legacy rows. */
  paidBy?: Payer;
  /** Defaults to everyone. */
  splitWith?: MemberId[];
  /** Set when the row was voided — it then counts for nothing. */
  voidedAt?: string | null;
}

export type FundKind = 'contribution' | 'withdrawal';

export interface FundEntry {
  id: number;
  memberId: MemberId;
  kind: FundKind;
  amount: number;
  at: string;
}

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amount: number;
}

export interface LedgerSummary {
  /** Money currently in the shared pot. */
  pot: number;
  /** Each member's own slice of the pot (what they may withdraw). */
  envelopes: Record<string, number>;
  /** Lifetime contributions per member. */
  contributed: Record<string, number>;
  /** paid − owed across person-paid expenses. +ve is owed money. */
  balances: Record<string, number>;
  /** Greedy minimal set of payments that settles every balance. */
  transfers: Transfer[];
}

/** Largest sensible single amount — guards against overflow and typos. */
export const MAX_AMOUNT = 1_000_000;
/** Recorded settlements are expenses of this category; they net balances to zero. */
export const SETTLEMENT_CATEGORY = 'settlement';

export const toCents = (v: number): number => Math.round(v * 100);
export const fromCents = (c: number): number => c / 100;
const key = (id: MemberId): string => String(id);

/** True for a usable money amount: finite, positive, ≤ MAX_AMOUNT, ≤ 2 decimals. */
export function isValidAmount(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (v <= 0 || v > MAX_AMOUNT) return false;
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

/**
 * Equal split that always adds up: cents are distributed largest-remainder
 * style, so `[33.34, 33.33, 33.33]` for 100 over 3.
 */
export function splitEqual(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const total = toCents(amount);
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => fromCents(base + (i < extra ? 1 : 0)));
}

/** Per-participant shares for an expense (participants de-duplicated, order kept). */
export function sharesFor(
  expense: LedgerExpense,
  allMembers: MemberId[]
): Array<{ memberId: MemberId; share: number }> {
  const raw = expense.splitWith && expense.splitWith.length ? expense.splitWith : allMembers;
  const known = new Set(allMembers.map(key));
  const parts: MemberId[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const k = key(id);
    if (!known.has(k) || seen.has(k)) continue;
    seen.add(k);
    parts.push(id);
  }
  const shares = splitEqual(expense.amount, parts.length);
  return parts.map((memberId, i) => ({ memberId, share: shares[i] }));
}

/**
 * Members whose envelope cannot cover their share of `expense` if the pot pays.
 * Empty means the pot may pay it. `expense` must not already be in `expenses`.
 */
export function potShortfalls(
  expense: LedgerExpense,
  members: MemberId[],
  expenses: LedgerExpense[],
  fund: FundEntry[],
  defaultPayer: MemberId
): Array<{ memberId: MemberId; short: number }> {
  const { envelopes } = summarizeLedger(members, expenses, fund, defaultPayer);
  const out: Array<{ memberId: MemberId; short: number }> = [];
  for (const { memberId, share } of sharesFor(expense, members)) {
    const have = toCents(envelopes[key(memberId)] || 0);
    const need = toCents(share);
    if (need > have) out.push({ memberId, short: fromCents(need - have) });
  }
  return out;
}

/** What `memberId` may take back out of the pot right now. */
export function withdrawable(
  memberId: MemberId,
  members: MemberId[],
  expenses: LedgerExpense[],
  fund: FundEntry[],
  defaultPayer: MemberId
): number {
  const { envelopes, pot } = summarizeLedger(members, expenses, fund, defaultPayer);
  return Math.max(0, Math.min(pot, envelopes[key(memberId)] || 0));
}

/**
 * Greedy min-cash-flow: repeatedly pay the largest debtor to the largest
 * creditor. Settles everything in at most (n − 1) transfers.
 */
export function settleUp(balances: Record<string, number>): Transfer[] {
  const creditors: Array<[string, number]> = [];
  const debtors: Array<[string, number]> = [];
  for (const [id, bal] of Object.entries(balances)) {
    const c = toCents(bal);
    if (c > 0) creditors.push([id, c]);
    else if (c < 0) debtors.push([id, -c]);
  }
  const byAmount = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  creditors.sort(byAmount);
  debtors.sort(byAmount);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i][1], creditors[j][1]);
    if (pay > 0) out.push({ from: debtors[i][0], to: creditors[j][0], amount: fromCents(pay) });
    debtors[i][1] -= pay;
    creditors[j][1] -= pay;
    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }
  return out;
}

/** One pass over the books: pot, envelopes, IOU balances and settle-up plan. */
export function summarizeLedger(
  members: MemberId[],
  expenses: LedgerExpense[],
  fund: FundEntry[],
  defaultPayer: MemberId
): LedgerSummary {
  const env: Record<string, number> = {};
  const contributed: Record<string, number> = {};
  const bal: Record<string, number> = {};
  for (const m of members) {
    env[key(m)] = 0;
    contributed[key(m)] = 0;
    bal[key(m)] = 0;
  }
  const known = (id: MemberId) => Object.prototype.hasOwnProperty.call(env, key(id));

  for (const f of fund) {
    if (!known(f.memberId)) continue;
    const c = toCents(f.amount);
    if (f.kind === 'contribution') {
      env[key(f.memberId)] += c;
      contributed[key(f.memberId)] += c;
    } else {
      env[key(f.memberId)] -= c;
    }
  }

  for (const e of expenses) {
    if (e.voidedAt) continue;
    const payer: Payer = e.paidBy ?? defaultPayer;
    const shares = sharesFor(e, members);
    if (payer === 'pot') {
      for (const { memberId, share } of shares) env[key(memberId)] -= toCents(share);
      continue;
    }
    if (!known(payer)) continue;
    bal[key(payer)] += toCents(e.amount);
    for (const { memberId, share } of shares) bal[key(memberId)] -= toCents(share);
  }

  const envelopes: Record<string, number> = {};
  const contributedOut: Record<string, number> = {};
  const balances: Record<string, number> = {};
  let pot = 0;
  for (const k of Object.keys(env)) {
    pot += env[k];
    envelopes[k] = fromCents(env[k]);
    contributedOut[k] = fromCents(contributed[k]);
    balances[k] = fromCents(bal[k]);
  }
  return {
    pot: fromCents(pot),
    envelopes,
    contributed: contributedOut,
    balances,
    transfers: settleUp(balances),
  };
}
