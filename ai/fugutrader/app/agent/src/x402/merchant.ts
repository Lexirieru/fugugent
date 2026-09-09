/**
 * The selling half: one route that answers "pay first" and then does the work.
 *
 * The three pieces that decide whether a payment is real come from
 * `@altananetwork/x402-server`: the demand it writes, the reader that unpacks what a buyer
 * sends back, and the checker that decides whether that authorisation is genuine and for
 * the right amount, token and recipient. Reimplementing any of them here would mean
 * writing a second opinion about a signature, and the wrong one would be discovered by a
 * payment rather than by a test.
 *
 * LICENCE, and it is not a footnote: `@altananetwork/x402-server` is published under
 * GPL-3.0-or-later, while `@altananetwork/sdk` is Apache-2.0. Every file that imports it,
 * this one included, inherits that obligation. Nothing else in this agent imports it, so
 * the boundary is exactly this module and the seller route that uses it.
 *
 * What this module adds on top is the part that must be testable without a chain: the
 * settling step is INJECTED. In production it broadcasts through a wallet that pays the
 * delivery cost and nothing else. In a test it is a stub that records what it was asked
 * to settle, and refuses a payment it has already seen, which is what the chain does with
 * a used authorisation number. So "no payment means refused" and "a real signature means
 * accepted" are proven here against a signature that is genuinely checked, with no
 * network involved.
 */
import {
  buildChallenge,
  decodeXPayment,
  effectivePrice,
  verifyPayment,
  type DecodedPayment,
  type MerchantConfig,
  type VerifySignatureFn,
} from "@altananetwork/x402-server";

/** What a settled payment leaves behind. */
export interface SettleReceipt {
  txHash: `0x${string}`;
  payer: `0x${string}`;
  amount: bigint;
  token: `0x${string}`;
  rail: DecodedPayment["rail"];
}

export interface MerchantDeps {
  /**
   * Decides whether a signature is genuine.
   *
   * REQUIRED, and deliberately not defaulted. The pure check understands ordinary
   * wallets; a smart account needs its own contract asked. Choosing between them is a
   * decision about who is trusted, and a default would make it silently.
   */
  verifySignature: VerifySignatureFn;
  /**
   * Moves the money. Throwing means the payment did not happen, and the caller answers
   * "pay first" rather than doing the work.
   */
  settle: (payment: DecodedPayment) => Promise<{ txHash: `0x${string}` }>;
  /** Is the payer a contract account? Used only when the plain signature check fails. */
  isContract?: (address: `0x${string}`) => Promise<boolean> | boolean;
  /** Unix seconds. Supplied so this module never reads a clock of its own. */
  now?: () => number;
}

export type MerchantOutcome =
  | { paid: false; status: 402; body: Record<string, unknown> }
  | { paid: true; status: 200; receipt: SettleReceipt };

/**
 * Builds the guard that sits in front of a paid route.
 *
 * The order below is the whole security argument, and it is: read, check, settle, then
 * work. Doing the work first and settling afterwards would give away the thing being
 * sold to anyone whose payment later turns out to be invalid, and there is no way to take
 * it back.
 */
export function createTraderMerchant(config: MerchantConfig, deps: MerchantDeps) {
  if (config.rails.length === 0) {
    throw new Error(
      "A seller with no way of being paid answers every request with a demand nobody can " +
        "satisfy. Configure at least one.",
    );
  }
  for (const rail of config.rails) {
    if (rail.token.decimals !== 18) {
      throw new Error(
        `The rail for ${rail.token.symbol} says ${rail.token.decimals} decimals. Every token on ` +
          `this network has 18, USDT included, and a wrong count charges the wrong price.`,
      );
    }
  }

  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  /** The demand a buyer receives when they have not paid. */
  function demand(reason?: string): Record<string, unknown> {
    const body = buildChallenge(config) as unknown as Record<string, unknown>;
    return reason === undefined ? body : { ...body, error: reason };
  }

  /**
   * Decides whether one request has paid for itself.
   *
   * Every failure answers with the SAME demand the first request got, plus a reason. A
   * buyer who is refused has to be able to try again correctly, and a refusal with no
   * price attached leaves them guessing.
   */
  async function requirePayment(header: string | null): Promise<MerchantOutcome> {
    if (header === null || header.trim() === "") {
      return { paid: false, status: 402, body: demand() };
    }

    let payment: DecodedPayment;
    try {
      payment = decodeXPayment(header);
    } catch (error) {
      return {
        paid: false,
        status: 402,
        body: demand(error instanceof Error ? error.message : "the payment could not be read"),
      };
    }

    const verdict = await verifyPayment(payment, config, {
      now: now(),
      verifySignature: deps.verifySignature,
      ...(deps.isContract === undefined ? {} : { isContract: deps.isContract }),
    });
    if (!verdict.ok) {
      return { paid: false, status: 402, body: demand(verdict.reason) };
    }

    // Settlement is the only place a reused authorisation number can be caught, because
    // the number is burned by the contract and nowhere else. A checker that tried to
    // remember them here would be a second, weaker copy of that record.
    let settled: { txHash: `0x${string}` };
    try {
      settled = await deps.settle(payment);
    } catch (error) {
      return {
        paid: false,
        status: 402,
        body: demand(
          `the payment could not be settled: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }

    return {
      paid: true,
      status: 200,
      receipt: {
        txHash: settled.txHash,
        payer: verdict.payer,
        amount: verdict.amount,
        token: verdict.token,
        rail: verdict.rail,
      },
    };
  }

  return {
    /** The price this seller is actually charging, after its own floor and ceiling. */
    price: () => effectivePrice(config),
    demand,
    requirePayment,
    /** The same guard, reading the header off a `Request`. */
    guard: async (request: Request): Promise<MerchantOutcome> =>
      requirePayment(
        request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE"),
      ),
  };
}

export type TraderMerchant = ReturnType<typeof createTraderMerchant>;
