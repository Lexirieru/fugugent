import path from "node:path";
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
    /**
     * The repository root, not `frontend/`.
     *
     * `src/app/globals.css` imports `../../../theme/tokens.css` — the palette shared
     * verbatim with `landingpage/`, so the two front ends cannot drift into looking
     * like different products again. Turbopack treats its root as the filesystem
     * root, and with the default (`frontend/`) that import fails outright:
     *
     *     FileSystemPath("").join("../theme/tokens.css") leaves the filesystem root
     *
     * Raising the root one level is what makes the single source of truth reachable.
     *
     * Deploy note: this app's Vercel project has Root Directory `frontend`, so
     * "Include source files outside of the Root Directory in the Build Step" must
     * stay enabled or `theme/` will not be in the build context. The same applies to
     * the `landingpage` project.
     */
    root: path.join(import.meta.dirname, ".."),
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
