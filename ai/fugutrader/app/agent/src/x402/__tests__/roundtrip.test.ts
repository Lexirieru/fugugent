/**
 * The whole loop, both sides, with a real signature and no network.
 *
 * A seller route is built from `@altananetwork/x402-server`. A buyer is built from this
 * agent's own decision engine and signer. Between them sits an HTTP handler that is a
 * plain function, and a settling step that is a stub which behaves the way the chain does:
 * it remembers the authorisation numbers it has already used and refuses a repeat.
 *
 * What makes this evidence rather than decoration is the signature. The key is a real one
 * generated for the test, the structure signed is built by the same library the seller's
 * checker uses, and the checker is viem's own verification. A test that stubbed the
 * signature check would pass just as happily against a buyer that signed nothing at all,
 * and would prove only that two of our own functions agree with each other.
 *
 * What it does NOT prove: that money moves. Settlement is stubbed, so this shows the
 * request is refused without a valid signed authorisation and served with one. Whether
 * the token contract then accepts that authorisation on chain is a separate fact, and
 * nothing here should be read as evidence of it.
 */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { verifyTypedData, type TypedDataDefinition } from "viem";
import type { DecodedPayment, MerchantConfig } from "@altananetwork/x402-server";
import { createTraderMerchant } from "../merchant.js";
import { buyOnce, ledgerAfter } from "../buyer.js";
import { eoaEip3009Signer } from "../signers.js";
import { DEFAULT_POLICY, WAD, type PurchasePolicy, type SpendLedger } from "../../strategy/types.js";
import { U_TOKEN_TESTNET } from "../../strategy/chain/testnet.js";

/** One cent, in 18 decimals. */
const ONE_CENT = WAD / 100n;

const SELLER_PAYOUT = "0x1B82F72346a8553a968fafD6AC07A21d4A88589f" as const;
const RESOURCE = "https://api.hellofugu.xyz/quote";

/** A fixed moment, so the whole test is reproducible. */
const NOW = 1_800_000_000;

function merchantConfig(over: Partial<MerchantConfig> = {}): MerchantConfig {
  return {
    chainId: 97,
    payTo: SELLER_PAYOUT,
    price: ONE_CENT,
    rails: [{ rail: "eip3009", token: { ...U_TOKEN_TESTNET } }],
    resource: RESOURCE,
    description: "One deterministic answer, priced per call.",
    maxTimeoutSeconds: 300,
    ...over,
  };
}

/**
 * A settling step that behaves the way the chain does about repeats.
 *
 * The authorisation number is burned when it is used, so the second attempt with the same
 * one fails. That is the only place a repeat can be caught, which is why the seller module
 * does not try to remember them itself.
 */
function stubSettle() {
  const used = new Set<string>();
  const settled: DecodedPayment[] = [];
  return {
    settled,
    settle: async (payment: DecodedPayment): Promise<{ txHash: `0x${string}` }> => {
      const nonce = payment.authorization?.nonce ?? "";
      if (used.has(nonce)) {
        throw new Error("this authorisation number has already been used");
      }
      used.add(nonce);
      settled.push(payment);
      return { txHash: `0x${"11".repeat(32)}` };
    },
  };
}

/**
 * The paid route, as a function from a request to a response.
 *
 * The work happens only after the payment has settled. Doing it first and settling
 * afterwards would give away the thing being sold to anyone whose payment turns out to be
 * invalid, and there is no way to take it back.
 */
function paidRoute(
  config: MerchantConfig,
  settle: (payment: DecodedPayment) => Promise<{ txHash: `0x${string}` }>,
) {
  let workDone = 0;
  const merchant = createTraderMerchant(config, {
    verifySignature: (args) =>
      verifyTypedData({ ...(args as unknown as TypedDataDefinition), address: args.address, signature: args.signature } as never),
    settle,
    now: () => NOW,
  });

  const handler: typeof fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    const outcome = await merchant.requirePayment(headers.get("X-PAYMENT"));
    if (!outcome.paid) {
      return new Response(JSON.stringify(outcome.body), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    workDone += 1;
    return new Response(
      JSON.stringify({ answer: 42, settledBy: outcome.receipt.txHash, payer: outcome.receipt.payer }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  return { handler, merchant, workCount: () => workDone };
}

/** A buyer with a fresh key, a fixed clock and a predictable authorisation number. */
function buyer(nonceSeed = 1) {
  const account = privateKeyToAccount(generatePrivateKey());
  let counter = nonceSeed;
  return {
    address: account.address,
    sign: eoaEip3009Signer(
      account.address,
      async (typedData) => account.signTypedData(typedData as never),
      {
        chainId: 97,
        now: () => BigInt(NOW),
        randomNonce: () => `0x${(counter++).toString(16).padStart(64, "0")}` as `0x${string}`,
      },
    ),
  };
}

/** The buyer's policy: one rail, one token, the same chain as the seller. */
const POLICY: PurchasePolicy = {
  ...DEFAULT_POLICY,
  rails: ["eip3009"],
  tokens: [{ address: U_TOKEN_TESTNET.address, symbol: "U", decimals: 18 }],
};

const FRESH: SpendLedger = { spentUnits: 0n, windowStartedAt: 0n };

describe("a request that has not paid", () => {
  it("is refused, and the refusal carries the price so the buyer can act on it", async () => {
    const { handler, workCount } = paidRoute(merchantConfig(), stubSettle().settle);
    const response = await handler("https://seller.test/quote", {});
    expect(response.status).toBe(402);

    const body = (await response.json()) as {
      error: string;
      accepts: { amount: string; payTo: string }[];
    };
    // A request with no payment is answered as a plain price, not as a payment that could
    // not be read. The two are different things for a buyer: one says "here is the price",
    // the other says "what you sent was wrong".
    expect(body.error).toBe("payment required");
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]?.amount).toBe(ONE_CENT.toString());
    expect(body.accepts[0]?.payTo).toBe(SELLER_PAYOUT);
    // The work must not have happened. This is the assertion that matters: a 402 that
    // still did the work has given away what it was selling.
    expect(workCount()).toBe(0);
  });

  it("is refused when the payment header is not a payment at all", async () => {
    const { handler, workCount } = paidRoute(merchantConfig(), stubSettle().settle);
    const response = await handler("https://seller.test/quote", {
      headers: { "X-PAYMENT": "not-base64-json" },
    });
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: string };
    // The reason is carried back, so a buyer who sent something broken can tell that apart
    // from a buyer who sent nothing.
    expect(body.error).not.toBe("payment required");
    expect(workCount()).toBe(0);
  });
});

describe("a request that has paid", () => {
  it("is served, and the buyer got there by deciding, signing once, and asking again", async () => {
    const settler = stubSettle();
    const { handler, workCount } = paidRoute(merchantConfig(), settler.settle);
    const b = buyer();

    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: b.sign,
      policy: POLICY,
      ledger: FRESH,
    });

    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") return;
    expect(outcome.demandedAgain).toBe(false);
    expect(outcome.response.status).toBe(200);
    expect(workCount()).toBe(1);

    const body = (await outcome.response.json()) as { answer: number; payer: string };
    expect(body.answer).toBe(42);
    // The payer is the buyer's own address, taken out of a signature the seller checked.
    expect(body.payer.toLowerCase()).toBe(b.address.toLowerCase());
    expect(settler.settled).toHaveLength(1);
    expect(settler.settled[0]?.amount).toBe(ONE_CENT);
  });

  it("adds what it signed to the running total", async () => {
    const { handler } = paidRoute(merchantConfig(), stubSettle().settle);
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: buyer().sign,
      policy: POLICY,
      ledger: FRESH,
    });
    expect(ledgerAfter(FRESH, outcome).spentUnits).toBe(ONE_CENT);
  });
});

describe("a payment that is not what it claims", () => {
  it("is refused when the signature was made by somebody else", async () => {
    const { handler, workCount } = paidRoute(merchantConfig(), stubSettle().settle);
    const impostor = privateKeyToAccount(generatePrivateKey());
    const victim = privateKeyToAccount(generatePrivateKey());

    // The envelope says the victim is paying; the signature is the impostor's.
    const sign = eoaEip3009Signer(
      victim.address,
      async (typedData) => impostor.signTypedData(typedData as never),
      {
        chainId: 97,
        now: () => BigInt(NOW),
        randomNonce: () => `0x${"22".repeat(32)}` as `0x${string}`,
      },
    );

    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign,
      policy: POLICY,
      ledger: FRESH,
    });
    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") return;
    expect(outcome.demandedAgain).toBe(true);
    expect(workCount()).toBe(0);
  });

  it("is refused when the same authorisation is sent twice", async () => {
    const settler = stubSettle();
    const { handler, workCount } = paidRoute(merchantConfig(), settler.settle);
    // The same seed both times, so both requests carry the same authorisation number.
    const first = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: buyer(7).sign,
      policy: POLICY,
      ledger: FRESH,
    });
    const second = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: buyer(7).sign,
      policy: POLICY,
      ledger: FRESH,
    });

    expect(first.kind === "paid" && first.response.status).toBe(200);
    expect(second.kind).toBe("paid");
    if (second.kind !== "paid") return;
    expect(second.demandedAgain).toBe(true);
    expect(workCount()).toBe(1);
  });

  it("is refused when the authorisation has already run out", async () => {
    const { handler, workCount } = paidRoute(merchantConfig(), stubSettle().settle);
    const account = privateKeyToAccount(generatePrivateKey());
    const stale = eoaEip3009Signer(
      account.address,
      async (typedData) => account.signTypedData(typedData as never),
      {
        chainId: 97,
        // An hour in the past, so the window it signs has already closed.
        now: () => BigInt(NOW - 3_600),
        randomNonce: () => `0x${"33".repeat(32)}` as `0x${string}`,
      },
    );
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: stale,
      policy: POLICY,
      ledger: FRESH,
    });
    expect(outcome.kind === "paid" && outcome.demandedAgain).toBe(true);
    expect(workCount()).toBe(0);
  });
});

describe("the buyer's own limits, against a real seller", () => {
  it("does not sign at all when the seller asks more than the per-call cap", async () => {
    const dear = merchantConfig({ price: WAD * 2n });
    const settler = stubSettle();
    const { handler, workCount } = paidRoute(dear, settler.settle);

    let signCalls = 0;
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: async (...args) => {
        signCalls += 1;
        return buyer().sign(...args);
      },
      policy: POLICY,
      ledger: FRESH,
    });

    expect(outcome.kind).toBe("refused");
    expect(signCalls).toBe(0);
    expect(settler.settled).toHaveLength(0);
    expect(workCount()).toBe(0);
  });

  it("does not sign when the seller wants a longer authorisation than this agent allows", async () => {
    const slow = merchantConfig({ maxTimeoutSeconds: 3_600 });
    const { handler } = paidRoute(slow, stubSettle().settle);
    let signCalls = 0;
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: async (...args) => {
        signCalls += 1;
        return buyer().sign(...args);
      },
      policy: POLICY,
      ledger: FRESH,
    });
    expect(outcome.kind).toBe("refused");
    expect(signCalls).toBe(0);
  });

  it("does not sign when the window is already spent", async () => {
    const { handler } = paidRoute(merchantConfig(), stubSettle().settle);
    let signCalls = 0;
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: handler,
      sign: async (...args) => {
        signCalls += 1;
        return buyer().sign(...args);
      },
      policy: POLICY,
      ledger: { spentUnits: POLICY.windowBudgetUnits, windowStartedAt: 0n },
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.decision.action).toBe("WINDOW_EXHAUSTED");
    expect(signCalls).toBe(0);
  });

  it("pays at most once per request, whatever the seller answers", async () => {
    // A seller that always demands payment. A pay-and-retry loop here would spend the
    // whole window in a few milliseconds.
    let attempts = 0;
    const alwaysDemands: typeof fetch = async () => {
      attempts += 1;
      const { merchant } = paidRoute(merchantConfig(), stubSettle().settle);
      return new Response(JSON.stringify(merchant.demand()), { status: 402 });
    };
    let signCalls = 0;
    const outcome = await buyOnce({
      url: "https://seller.test/quote",
      fetchImpl: alwaysDemands,
      sign: async (...args) => {
        signCalls += 1;
        return buyer().sign(...args);
      },
      policy: POLICY,
      ledger: FRESH,
    });
    expect(signCalls).toBe(1);
    expect(attempts).toBe(2);
    expect(outcome.kind === "paid" && outcome.demandedAgain).toBe(true);
  });
});

describe("a request that costs nothing", () => {
  it("is returned untouched, with nothing signed", async () => {
    const free: typeof fetch = async () => new Response(JSON.stringify({ answer: 1 }), { status: 200 });
    let signCalls = 0;
    const outcome = await buyOnce({
      url: "https://seller.test/free",
      fetchImpl: free,
      sign: async (...args) => {
        signCalls += 1;
        return buyer().sign(...args);
      },
      policy: POLICY,
      ledger: FRESH,
    });
    expect(outcome.kind).toBe("free");
    expect(outcome.decision).toBeNull();
    expect(signCalls).toBe(0);
  });

  it("passes a seller's error through rather than treating it as a demand for payment", async () => {
    const broken: typeof fetch = async () => new Response("boom", { status: 500 });
    const outcome = await buyOnce({
      url: "https://seller.test/broken",
      fetchImpl: broken,
      sign: buyer().sign,
      policy: POLICY,
      ledger: FRESH,
    });
    expect(outcome.kind).toBe("free");
    expect(outcome.response.status).toBe(500);
  });
});

describe("the seller's own configuration", () => {
  it("refuses to start with no way of being paid", () => {
    expect(() =>
      createTraderMerchant(merchantConfig({ rails: [] }), {
        verifySignature: async () => true,
        settle: async () => ({ txHash: "0x00" }),
      }),
    ).toThrow(/no way of being paid/);
  });

  it("refuses a token configured with anything other than 18 decimals", () => {
    expect(() =>
      createTraderMerchant(
        merchantConfig({
          rails: [{ rail: "eip3009", token: { ...U_TOKEN_TESTNET, decimals: 6 } }],
        }),
        { verifySignature: async () => true, settle: async () => ({ txHash: "0x00" }) },
      ),
    ).toThrow(/18/);
  });
});
