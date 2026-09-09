/**
 * Building the thing that gets signed, and the envelope it travels in.
 *
 * PURE apart from the signature itself, which is handed in. The clock and the random
 * number are arguments, so the same inputs always produce the same envelope and a test
 * can assert on it byte for byte.
 *
 * The typed-data builders come from `@altananetwork/sdk` (Apache-2.0), which is the same
 * code the seller's checker uses. That matters more than it looks: if this file built its
 * own version of the structure being signed and the two ever differed by a field name,
 * every payment would be refused for a reason no error message would explain.
 */
import { buildEip3009TypedData, encodeXPaymentHeader } from "@altananetwork/sdk";
import type { TypedDataDefinition } from "viem";
import { PurchaseError, type ChosenPayment, type PaymentOption } from "../strategy/types.js";

/** One authorisation to move a fixed amount once, between two moments. */
export interface Eip3009Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

/**
 * How far back the start of the validity window is placed, in seconds.
 *
 * The seller's checker refuses an authorisation whose start is not already in the past,
 * and clocks between two machines are never exactly aligned. A minute of margin costs
 * nothing and removes a whole class of payments that fail for no reason anybody can see.
 * BNB Agent Studio's own signer uses 120 seconds for the same reason.
 */
export const VALIDITY_BACKDATE_SECONDS = 120n;

/**
 * The authorisation for one payment.
 *
 * `validBefore` is built from THIS agent's chosen window, which `decidePurchase` already
 * capped at its own maximum. A seller asking for a longer one does not get it.
 */
export function buildAuthorization(
  chosen: ChosenPayment,
  from: `0x${string}`,
  nowUnix: bigint,
  nonce: `0x${string}`,
): Eip3009Authorization {
  if (nowUnix <= VALIDITY_BACKDATE_SECONDS) {
    throw new PurchaseError(
      `nowUnix is ${nowUnix}, which is not a real clock reading. The validity window would ` +
        `start before the epoch.`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new PurchaseError(
      "The authorisation number must be 32 bytes. It is what stops the same payment being " +
        "used twice, and a short or repeated one is a payment that can be replayed.",
    );
  }
  if (chosen.amountUnits <= 0n) {
    throw new PurchaseError(`There is nothing to authorise: the amount is ${chosen.amountUnits}.`);
  }
  return {
    from,
    to: chosen.payTo,
    value: chosen.amountUnits.toString(),
    validAfter: (nowUnix - VALIDITY_BACKDATE_SECONDS).toString(),
    validBefore: (nowUnix + BigInt(chosen.timeoutSeconds)).toString(),
    nonce,
  };
}

/**
 * The structure the token contract will check the signature against.
 *
 * The token's signing name and version come from the seller's own demand. They belong to
 * the token contract rather than to the seller, so a seller who states them wrongly gets
 * a signature the token refuses. That is the safe direction to fail in: the payment does
 * not happen, rather than happening somewhere unintended.
 */
export function eip3009TypedData(
  option: PaymentOption,
  authorization: Eip3009Authorization,
  chainId: number,
): TypedDataDefinition {
  if (option.tokenName === null || option.tokenVersion === null) {
    throw new PurchaseError(
      "The seller did not say which name and version the token signs under, so there is no " +
        "way to build a signature the token would accept. Nothing was signed.",
    );
  }
  if (option.asset === null) {
    throw new PurchaseError("The seller did not name the token. Nothing was signed.");
  }
  return buildEip3009TypedData({
    chainId,
    token: option.asset,
    name: option.tokenName,
    version: option.tokenVersion,
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  });
}

/**
 * The envelope, base64 encoded, ready for the `X-PAYMENT` header.
 *
 * The seller's own demand is repeated back inside it verbatim, in `accepted`. Sellers
 * check that, and rebuilding the demand from parsed fields is how a payment gets rejected
 * over a difference nobody intended.
 */
export function encodeEip3009Envelope(args: {
  option: PaymentOption;
  authorization: Eip3009Authorization;
  signature: `0x${string}`;
  chainId: number;
  resourceUrl: string | null;
}): string {
  return encodeXPaymentHeader({
    x402Version: 2,
    scheme: "exact",
    network: `eip155:${args.chainId}`,
    ...(args.option.raw === undefined ? {} : { accepted: args.option.raw as never }),
    ...(args.resourceUrl === null ? {} : { resource: { url: args.resourceUrl } }),
    payload: {
      signature: args.signature,
      authorization: args.authorization,
    },
  });
}
