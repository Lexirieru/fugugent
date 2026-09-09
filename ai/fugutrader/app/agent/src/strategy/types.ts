/**
 * Types and limits for the COMMERCE strategy: buying one call at a time.
 *
 * UNITS, held uniform across this whole package:
 *  - token amounts: the token's own smallest unit, and on this network that always means
 *    18 decimals. $U has 18. USDT on BSC has 18. The six-decimal habit comes from
 *    Ethereum and is wrong here by a factor of ten thousand, so `assertToken18` refuses a
 *    token configured any other way rather than quietly paying the wrong amount.
 *  - percentages: basis points, 10_000n = 100%.
 *  - time: whole unix seconds.
 *
 * This module must not import anything that touches the network, the clock, or the
 * environment. Decisions about money never pass through an LLM.
 */

/** 100% in basis points. */
export const BPS_ONE = 10_000n;

/** One token, in the smallest unit. Every token this agent pays with has 18 decimals. */
export const WAD = 10n ** 18n;

/** The two ways a payment can be authorised on this network. */
export type Rail = "eip3009" | "permit2-exact";

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseError";
  }
}

/** A token this agent is willing to pay with. */
export interface TokenChoice {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

/**
 * Refuses a token whose smallest unit is not 10^-18.
 *
 * This is the project's oldest trap written down as code. Every token on BSC has 18
 * decimals, USDT included, and a configuration that says 6 does not fail: it produces a
 * payment ten thousand times too small, which is refused by the seller, or ten thousand
 * times too large, which is not.
 */
export function assertToken18(token: TokenChoice): void {
  if (token.decimals !== 18) {
    throw new PurchaseError(
      `${token.symbol} at ${token.address} is configured with ${token.decimals} decimals. Every ` +
        `token on this network has 18, USDT included. A wrong decimal count does not fail, it ` +
        `pays the wrong amount.`,
    );
  }
}

/**
 * One payment option out of a seller's price demand, already parsed into the shape this
 * engine reasons about.
 *
 * `index` is the position it held in the seller's list, and it exists so that two options
 * which are alike in every other way still have a stable order.
 */
export interface PaymentOption {
  index: number;
  scheme: string;
  chainId: number | null;
  rail: Rail | null;
  asset: `0x${string}` | null;
  payTo: `0x${string}` | null;
  /** The amount asked for, in the token's smallest unit. Null when it could not be read. */
  amount: bigint | null;
  maxTimeoutSeconds: number | null;
  /**
   * The token's own signing name and version, as the seller stated them. They belong to
   * the token contract, not to the seller, so a seller that states them wrongly produces
   * a signature the token itself will not accept, and the payment fails rather than going
   * somewhere unintended.
   */
  tokenName: string | null;
  tokenVersion: string | null;
  /** Where the money goes when the payment settles, when the option names one. */
  spender: `0x${string}` | null;
  /**
   * The option exactly as the seller sent it.
   *
   * Kept so the signing step can hand it back verbatim. Sellers check that the envelope
   * repeats their own demand, and rebuilding it from parsed fields is how a payment ends
   * up rejected for a difference nobody meant to introduce. Never read to decide
   * anything: every decision above uses the parsed fields.
   */
  raw: unknown;
}

/** A seller's price demand, parsed. */
export interface PriceDemand {
  /** What the payment buys, when the seller said. */
  resourceUrl: string | null;
  options: PaymentOption[];
}

/** How much this agent has spent in the window it is counting. */
export interface SpendLedger {
  /** Spent so far in the current window, in the smallest unit of the token. */
  spentUnits: bigint;
  /** When the window began, in unix seconds. Only used to describe it. */
  windowStartedAt: bigint;
}

export interface PurchasePolicy {
  /** The chain this agent pays on, and only this one. */
  chainId: number;
  /** The tokens this agent will pay with. */
  tokens: readonly TokenChoice[];
  /** The ways of authorising a payment this agent will use, in order of preference. */
  rails: readonly Rail[];
  /** The most this agent pays for one call. */
  maxPricePerCallUnits: bigint;
  /** The most this agent pays across one window. */
  windowBudgetUnits: bigint;
  /**
   * The longest validity this agent will sign into an authorisation, in seconds. A signed
   * authorisation is money someone else can take at a time of their choosing, and the
   * window is how long that stays true.
   */
  maxTimeoutSeconds: number;
}

export type PurchaseAction = "PAY" | "REFUSED" | "WINDOW_EXHAUSTED";

/** Why one payment option was put aside. One code per rule. */
export type RefusalRule =
  | "SCHEME"
  | "CHAIN"
  | "RAIL"
  | "TOKEN"
  | "PAYEE"
  | "AMOUNT"
  | "PRICE_CAP"
  | "WINDOW"
  | "TIMEOUT_WINDOW";

export interface RefusedOption {
  index: number;
  rule: RefusalRule;
  detail: string;
}

/** The option this agent chose, and what paying it costs. */
export interface ChosenPayment {
  index: number;
  rail: Rail;
  asset: `0x${string}`;
  symbol: string;
  payTo: `0x${string}`;
  amountUnits: bigint;
  /** The validity window this agent will sign, which is never longer than the policy's. */
  timeoutSeconds: number;
}

export type PuffLevel = 0 | 1 | 2 | 3 | 4;

export interface PurchaseDecision {
  action: PurchaseAction;
  chosen: ChosenPayment | null;
  refused: RefusedOption[];
  /** What is left of the window ceiling before this payment. */
  windowRemainingUnits: bigint;
  /** How much of the window ceiling would be used after it, in bps. */
  windowUsedBps: bigint;
  puffLevel: PuffLevel;
  reason: string;
}

/**
 * ========================= WHY THESE NUMBERS ARE WHAT THEY ARE =========================
 *
 * `maxPricePerCallUnits = 0.5 tokens`
 *   Why this value: the price of one call is set by the SELLER, in the reply that demands
 *   payment. There is no negotiation in this protocol and no upper bound in the wire
 *   format, so without a cap on this side the agent signs for whatever it is asked. Half
 *   a token is fifty times the one cent a call this project's own seller charges, which
 *   leaves room for a dearer service while still stopping a demand that is out by orders
 *   of magnitude.
 *   NOT CONFIDENT: the figure is a product decision, not a measurement. What is not a
 *   judgement is that the cap has to exist and has to be on the buyer's side.
 *   If it is wrong: too high and a seller can raise a price and be paid; too low and
 *   honest services are refused, which is visible and fixable.
 *
 * `windowBudgetUnits = 5 tokens`
 *   Why this value: ten times the per-call cap, so a fault has to repeat ten times before
 *   it stops rather than stopping on its second attempt. The per-call cap alone cannot
 *   bound a loop: a thousand correct one-cent payments are a thousand correct decisions.
 *   The window itself is not defined here, it is whatever period the caller resets its
 *   running total over, and a window that is never reset makes this a lifetime cap.
 *   If it is wrong: too high and a loop runs longer; too low and a busy hour stops.
 *
 * `maxTimeoutSeconds = 480`
 *   Why this value: an authorisation is money the seller can take at any moment inside
 *   its window, so the window is exposure. 480 seconds is also the largest value the BNB
 *   Agent Studio signer will accept in practice: it refuses anything over 600 and moves
 *   the start back by 120 seconds, so a 600-second demand becomes a 720-second window and
 *   is refused outright. Staying at or under 480 keeps this agent payable by that family
 *   of sellers as well as safe.
 *   If it is wrong: too long and a signed authorisation outlives the reason for it; too
 *   short and slow sellers cannot settle in time.
 *
 * `rails = ["permit2-exact", "eip3009"]`, in that order
 *   Why this order: the first works for any token that has been approved once, and the
 *   wallet's own signature is checked by the settling contract, which is what makes a
 *   delegated key usable at all. The second only works for tokens whose transfer
 *   authorisation understands contract signatures, which on this network means $U. So the
 *   first is the general one and the second is the compatible one, and preferring the
 *   general one is what keeps this agent able to pay in more than one token.
 * ======================================================================================
 */
export const DEFAULT_POLICY: PurchasePolicy = {
  chainId: 97,
  tokens: [
    { address: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565", symbol: "U", decimals: 18 },
  ],
  rails: ["permit2-exact", "eip3009"],
  maxPricePerCallUnits: WAD / 2n,
  windowBudgetUnits: 5n * WAD,
  maxTimeoutSeconds: 480,
};

/**
 * The puff level, from how much of the window ceiling the payment would commit.
 *
 * The fugu puffs up as the load rises, and here the load is money committed against the
 * limit that exists to hold it back. Level 0 is reserved for "nothing was committed at
 * all", so the calm shape means exactly one thing.
 */
export function puffFromWindowBps(usedBps: bigint): PuffLevel {
  if (usedBps <= 0n) return 0;
  if (usedBps < 2_500n) return 1;
  if (usedBps < 5_000n) return 2;
  if (usedBps < 7_500n) return 3;
  return 4;
}
