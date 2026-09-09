/**
 * Reown AppKit + wagmi configuration.
 *
 * Three things in this file must not change:
 *
 * 1. **One network only: BSC testnet (97).** This marketplace never touches
 *    mainnet, so offering other chains in the modal buys nothing — a user who can
 *    pick Ethereum only ends up in the wrong-network state we built ourselves.
 * 2. **The RPC is overridden explicitly.** The SDK default points at the
 *    `binance.org` domain, which is blocked from Indonesia (`../../CLAUDE.md`
 *    rule 3). `CHAIN.rpc` is the single source of the RPC address in the frontend.
 * 3. **Without `NEXT_PUBLIC_REOWN_PROJECT_ID`, no wallet UI is mounted at all.**
 *    Not half-mounted: `walletEnabled` is `false`, there is no Connect button that
 *    connects nothing, and the hire panel falls back to `cast` commands that still
 *    produce a real transaction. Better to leave the control out than ship it broken.
 *
 * A Reown project id is designed to be public and does ship in the browser bundle —
 * that is normal. The value still lives only in the gitignored `.env.local`;
 * committed files name the variable and never its value.
 */

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { bscTestnet } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { http } from "wagmi";
import { CHAIN } from "@/lib/chain";

export const projectId = (process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "").trim();

/** `false` = this build carries no Reown credential, so no wallet UI is rendered. */
export const walletEnabled = projectId.length > 0;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [bscTestnet];

export const metadata = {
  name: "HelloFugu",
  description: "Hire a DeFi agent on BNB Chain and check its work yourself.",
  url: "https://app.hellofugu.xyz",
  icons: ["https://app.hellofugu.xyz/icon.svg"],
};

/**
 * `null` when there is no project id. Building the adapter without one blows up
 * inside WalletConnect, so that failure is stated here — in one place — instead of
 * being allowed to surface as a blank screen.
 */
export const wagmiAdapter = walletEnabled
  ? new WagmiAdapter({
      networks,
      projectId,
      ssr: true,
      transports: { [bscTestnet.id]: http(CHAIN.rpc) },
    })
  : null;

export { bscTestnet };
