import type { NextConfig } from "next";

/**
 * `@wagmi/connectors` bundles the Base Account connector, which through
 * `@coinbase/cdp-sdk` imports five **optional** `@x402/*` modules that are not
 * installed. That path is never used here — Fugugent pays through
 * `FuguSubscription` on BSC testnet — so all five are aliased to a single shim that
 * throws if it is ever actually called. See `src/lib/wallet/x402-stub.ts`.
 */
const X402_STUB = "./src/lib/wallet/x402-stub.ts";

/**
 * Our nine listings were keyed by placeholder ids 8004-8012 until they were bound to
 * real ERC-8004 identities 2480-2488 on 2026-09-25. Links to the old ids are out in
 * the README, the demo video and the hackathon submission, so they are redirected.
 *
 * Temporary (307), and with an expiry written down: the IdentityRegistry is at ~2,500
 * ids and grows by a few hundred a month. The day it reaches 8004, `97:8004` becomes
 * somebody else's agent and these redirects must go, or they would hide it.
 */
const REBOUND: [number, number][] = [
  [8004, 2480], [8005, 2481], [8006, 2482], [8007, 2483], [8008, 2484],
  [8009, 2485], [8010, 2486], [8011, 2487], [8012, 2488],
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    // `:` starts a parameter in both patterns: escaped in the source, percent-encoded
    // in the destination (the browser shows it as `97:2480`). A link can arrive either
    // way, so both spellings of the old id are matched.
    return REBOUND.flatMap(([from, to]) =>
      [`/agent/97\\:${from}`, `/agent/97%3A${from}`].map((source) => ({
        source,
        destination: `/agent/97%3A${to}`,
        permanent: false,
      })),
    );
  },
  turbopack: {
    resolveAlias: {
      "@x402/core/client": X402_STUB,
      "@x402/evm": X402_STUB,
      "@x402/evm/exact/client": X402_STUB,
      "@x402/evm/upto/client": X402_STUB,
      "@x402/svm/exact/client": X402_STUB,
    },
  },
};

export default nextConfig;
