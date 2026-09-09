/**
 * The selling half, wired to the chain and mounted on the agent's own server.
 *
 * One route, `POST /fugu-x402`. Not `/x402`, which belongs to the seller the scaffold
 * ships and which needs merchant credentials from a Binance developer account this
 * project does not have. Two sellers on one path would answer each other's buyers.
 *
 * Without payment it answers 402 and the price. With a valid
 * payment it settles it and then does the work. The work is this agent's own deterministic
 * purchase decision, which is the thing it is worth paying for: it is the same engine the
 * agent uses on itself.
 *
 * LICENCE: this file reaches `@altananetwork/x402-server`, which is GPL-3.0-or-later,
 * through `./merchant.js`. Nothing outside `src/x402/` does.
 *
 * IT IS OFF BY DEFAULT, and it says so loudly when the configuration is incomplete rather
 * than starting a seller that cannot be paid. Selling requires an address to be paid at
 * and a separate, funded key that does nothing but pay for delivering the settlement
 * transaction. Starting without them would produce a route that demands payment and then
 * fails every payment that arrives, which is worse than a route that is switched off.
 */
import express, { type Router } from "express";
import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { settlePayment, type DecodedPayment, type MerchantConfig } from "@altananetwork/x402-server";
import { createTraderMerchant, type TraderMerchant } from "./merchant.js";
import { purchaseAdvisorySkill } from "../purchase.js";
import { CHAIN_ID, DEFAULT_BSC_TESTNET_RPC_URL, U_TOKEN_TESTNET } from "../strategy/chain/testnet.js";

/**
 * Where this seller listens.
 *
 * Deliberately not `/x402`: the seller the scaffold ships already claims that path, and it
 * needs credentials from a Binance developer account that this project does not have. Two
 * sellers on one path would answer each other's buyers.
 */
export const FUGU_X402_PATH = "/fugu-x402";

export class SellerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerConfigError";
  }
}

function required(env: NodeJS.ProcessEnv, key: string, why: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new SellerConfigError(`${key} is not set. ${why}`);
  }
  return value.trim();
}

/**
 * Builds the seller from the environment, or returns null when it is switched off.
 *
 * A configuration fault THROWS. It does not log and carry on. A seller that answers every
 * request with a demand for payment and then rejects every payment is worse than one that
 * is not there, because a buyer cannot tell the two apart and keeps trying.
 */
export function buildX402Seller(
  env: NodeJS.ProcessEnv = process.env,
): { merchant: TraderMerchant; config: MerchantConfig } | null {
  if (env.FUGU_X402_SELLER_ENABLED !== "1") return null;

  const payTo = required(
    env,
    "FUGU_X402_PAY_TO",
    "It is the address the earnings go to, and it is bound into the buyer's signature, so a " +
      "wrong one cannot be corrected afterwards.",
  ) as `0x${string}`;

  const facilitatorKey = required(
    env,
    "FUGU_X402_FACILITATOR_KEY",
    "It is a separate key whose only job is to pay for delivering the settlement " +
      "transaction. It never receives the earnings: the recipient is bound into the buyer's " +
      "signature, so this key cannot redirect them even if it is stolen.",
  ) as `0x${string}`;

  // One cent by default, which is what this project's own listing charges.
  const priceUnits = BigInt(env.FUGU_X402_PRICE_UNITS ?? (10n ** 16n).toString());
  if (priceUnits <= 0n) {
    throw new SellerConfigError(
      `FUGU_X402_PRICE_UNITS is ${priceUnits}. A price of zero is not a paid route, it is a ` +
        `free one, and it should be served as one rather than demanding a payment of nothing.`,
    );
  }

  const rpcUrl = env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;
  const account = privateKeyToAccount(facilitatorKey);
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport: http(rpcUrl) });

  const config: MerchantConfig = {
    chainId: CHAIN_ID,
    payTo,
    price: priceUnits,
    // A ceiling as well as a price. Without it a buyer who sent more than the price would
    // simply be charged more, and a seller should not accept an overpayment it never asked
    // for.
    maxPrice: priceUnits,
    rails: [{ rail: "eip3009", token: { ...U_TOKEN_TESTNET } }],
    resource: env.FUGU_X402_RESOURCE_URL ?? `https://api.hellofugu.xyz${FUGU_X402_PATH}`,
    description: "One deterministic answer about whether a paid request is worth paying for.",
    // Kept at or under 480 seconds: it is the exposure window on a signed authorisation,
    // and it is also the largest value BNB Agent Studio buyers accept in practice.
    maxTimeoutSeconds: 300,
  };

  const merchant = createTraderMerchant(config, {
    // The chain's own check, which understands ordinary wallets, wallets that are
    // contracts, and wallets that are not deployed yet. The pure check would refuse a
    // buyer whose wallet is a contract, and that refusal would say nothing about whether
    // the payment was valid.
    verifySignature: (args) => publicClient.verifyTypedData(args as never),
    isContract: async (address) => {
      const code = await (publicClient as PublicClient).getCode({ address });
      return code !== undefined && code !== "0x";
    },
    settle: async (payment: DecodedPayment) =>
      settlePayment(payment, config, {
        wallet: walletClient,
        public: publicClient as never,
      }) as Promise<{ txHash: `0x${string}` }>,
  });

  return { merchant, config };
}

/**
 * The paid route.
 *
 * The order is read, check, settle, then work. Doing the work first and settling
 * afterwards would give away what is being sold to anyone whose payment turns out to be
 * invalid, and there is no taking it back.
 */
export function x402SellerRouter(merchant: TraderMerchant): Router {
  const router = express.Router();

  // A plain read of the price, so a buyer can see what a call costs before making one.
  router.get(FUGU_X402_PATH, (_req, res) => {
    res.status(402).json(merchant.demand());
  });

  router.post(FUGU_X402_PATH, (req, res) => {
    const header =
      (req.header("X-PAYMENT") ?? req.header("PAYMENT-SIGNATURE") ?? null) || null;
    void merchant
      .requirePayment(header)
      .then((outcome) => {
        if (!outcome.paid) {
          res.status(402).json(outcome.body);
          return;
        }
        const answer = purchaseAdvisorySkill(req.body as Record<string, unknown>);
        res.status(200).json({
          ...answer,
          settlement: {
            transaction: outcome.receipt.txHash,
            paidBy: outcome.receipt.payer,
            amount: outcome.receipt.amount.toString(),
            token: outcome.receipt.token,
          },
        });
      })
      .catch((error: unknown) => {
        // A fault on this side is this seller's problem, and the buyer has not paid for
        // it. It must never look like a demand for more money.
        res.status(500).json({
          error: "the seller could not complete this request",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
  });

  return router;
}
