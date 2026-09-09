import type { NextConfig } from "next";

/**
 * `@wagmi/connectors` bundles the Base Account connector, which through
 * `@coinbase/cdp-sdk` imports five **optional** `@x402/*` modules that are not
 * installed. That path is never used here — Fugugent pays through
 * `FuguSubscription` on BSC testnet — so all five are aliased to a single shim that
 * throws if it is ever actually called. See `src/lib/wallet/x402-stub.ts`.
 */
const X402_STUB = "./src/lib/wallet/x402-stub.ts";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
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
