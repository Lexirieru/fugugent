/**
 * The two ways this agent can put its name on a payment.
 *
 * Both produce the same envelope and are checked by the same code on the seller's side.
 * They differ only in who holds the key and in what holds that key back.
 *
 *   `eoaEip3009Signer`  an ordinary key, with nothing between it and the money except
 *                       the rules in `strategy/`. Used by the tests, where the point is
 *                       to prove the flow against a signature that is genuinely checked,
 *                       and by scripts run by hand.
 *
 *   `sessionSigner`     a delegated key with a spending cap and an expiry date that the
 *                       wallet contract enforces. This is what the running agent uses.
 *                       Its authorisation is checked by the settling contract itself,
 *                       which is why it works for a wallet that is a contract rather than
 *                       a person.
 *
 * The secret part of the delegated key is never read, printed, or copied here. It arrives
 * as an already-loaded object and leaves as a signature.
 */
import { signX402Payment } from "@altananetwork/sdk";
import type { Session } from "@altananetwork/sdk";
import { PurchaseError, type ChosenPayment, type PriceDemand } from "../strategy/types.js";
import { buildAuthorization, eip3009TypedData, encodeEip3009Envelope } from "./envelope.js";
import type { SignedPayment } from "./buyer.js";

/** Everything a signer needs that is not the payment itself. */
export interface SignerContext {
  chainId: number;
  /** Unix seconds. Injected, so no signer reads a clock of its own. */
  now: () => bigint;
  /** 32 random bytes. Injected, so a test can produce the same envelope twice. */
  randomNonce: () => `0x${string}`;
}

/**
 * Signs with an ordinary key.
 *
 * `signTypedData` is handed in rather than a private key, so no key material passes
 * through this module's arguments and none of it can end up in a stack trace.
 */
export function eoaEip3009Signer(
  address: `0x${string}`,
  signTypedData: (typedData: unknown) => Promise<`0x${string}`>,
  context: SignerContext,
): (chosen: ChosenPayment, demand: PriceDemand) => Promise<SignedPayment> {
  return async (chosen, demand) => {
    if (chosen.rail !== "eip3009") {
      throw new PurchaseError(
        `This signer authorises payments the "eip3009" way and the chosen option asks for ` +
          `"${chosen.rail}". Nothing was signed.`,
      );
    }
    const option = demand.options[chosen.index];
    if (option === undefined) {
      throw new PurchaseError(
        `The chosen option is number ${chosen.index} and the seller sent ` +
          `${demand.options.length}. Nothing was signed.`,
      );
    }
    const authorization = buildAuthorization(chosen, address, context.now(), context.randomNonce());
    const typedData = eip3009TypedData(option, authorization, context.chainId);
    const signature = await signTypedData(typedData);
    return {
      header: encodeEip3009Envelope({
        option,
        authorization,
        signature,
        chainId: context.chainId,
        resourceUrl: demand.resourceUrl,
      }),
    };
  };
}

/**
 * Signs with the delegated key the running agent holds.
 *
 * The seller's own option is handed back to the wallet library exactly as it arrived,
 * which is why `PaymentOption.raw` is kept. The library builds the structure to sign from
 * that demand, so the envelope repeats the demand rather than a rebuilt copy of it.
 *
 * The delegated key only works here because the settling contract asks the wallet
 * contract whether the signature is good. An ordinary check done off to one side would
 * refuse it, and that refusal would say nothing about whether the payment was valid.
 */
export function sessionSigner(
  session: Session,
  context: Pick<SignerContext, "now">,
): (chosen: ChosenPayment, demand: PriceDemand) => Promise<SignedPayment> {
  return async (chosen, demand) => {
    const option = demand.options[chosen.index];
    if (option === undefined || option.raw === undefined || option.raw === null) {
      throw new PurchaseError(
        `The chosen option is number ${chosen.index} and the seller's own wording for it was ` +
          `not kept, so there is nothing to sign against. Nothing was signed.`,
      );
    }
    const { header } = await signX402Payment(session, option.raw as never, {
      now: Number(context.now()),
    });
    return { header };
  };
}
