/**
 * A shim for `@x402/*`.
 *
 * `@wagmi/connectors` bundles the Base Account connector, which through
 * `@coinbase/cdp-sdk` imports several `@x402/*` modules — the x402 payment paths on
 * Base and Solana. Those packages are **optional peer dependencies** that are not
 * installed, and Turbopack fails the build because it cannot resolve them, even
 * though not one line of Fugugent calls them.
 *
 * Fugugent pays through `FuguSubscription.subscribe` on BSC testnet — the only
 * contract that holds funds — so those modules are aliased to this file in
 * `next.config.ts`.
 *
 * Every export here **throws if it is ever actually called**. Shimming a money path
 * with a quietly `undefined` value is the easiest way to make a failed payment look
 * like a successful one; if any code reaches this file, we want to hear about it in
 * a message that names the reason.
 */

const REASON =
  "@x402/* is not installed in this build: Fugugent pays through FuguSubscription on BSC testnet, never through x402.";

function unavailable(): never {
  throw new Error(REASON);
}

/** Used both as a class and as a function by cdp-sdk; both paths throw. */
class UnavailableScheme {
  constructor() {
    unavailable();
  }
}

export const toClientEvmSigner = unavailable;
export const registerExactEvmScheme = unavailable;
export const registerExactSvmScheme = unavailable;
export const x402Client = unavailable;
export const ExactEvmScheme = UnavailableScheme;
export const ExactSvmScheme = UnavailableScheme;
export const UptoEvmScheme = UnavailableScheme;

export default unavailable;
