"use client";

/**
 * The wallet provider. Mounted in `app/layout.tsx` so connection state is alive
 * across the app and not only inside the hire panel — the header has to be able to
 * say "wrong network" on any page.
 *
 * `createAppKit` is called **once, at module level**, never inside a component:
 * calling it per render creates duplicate instances and broken modal state.
 *
 * **Why `cookieToInitialState` is not used here**, even though Reown's official
 * example uses it. `wagmi.hydrate` writes `initialState` through `config.setState`,
 * and `config` is a module-level singleton. On a server handling many people that
 * singleton is not reset between requests: once one visitor sends their cookie,
 * *that visitor's* address and chain id get rendered into the next visitor's HTML.
 * We verified it on this dev server — a `curl` carrying no cookie at all came back
 * with the wallet address of the browser that had just opened the page.
 *
 * The price is small and plain: the first render always says "not connected", then
 * wagmi reconnects on its own from browser storage after mount. We trade one blink
 * and we get nobody's address leaking into somebody else's page — plus
 * deterministic server HTML, so there is no hydration mismatch either.
 *
 * With no project id, this provider passes `children` straight through — no
 * `WagmiProvider`, no modal, no button. Components that need a wallet check
 * `walletEnabled` before calling any wagmi hook, so no hook is ever called outside
 * its provider.
 */

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";
import { ACCENT } from "@/lib/theme";
import { metadata, networks, projectId, wagmiAdapter, walletEnabled } from "@/lib/wallet/config";

if (wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    metadata,
    // Unsupported networks are allowed through **deliberately**: if AppKit forces a
    // "Switch Network" modal the moment the page opens, the visitor cannot read the
    // price and the proof before deciding. The wrong-network state is handled where
    // it belongs — the header and the hire panel — each with its own switch button,
    // so nothing stays silent and nothing blocks the page.
    allowUnsupportedChain: true,
    enableNetworkSwitch: true,
    // The modal is a third-party surface, so it is themed rather than restyled: without
    // these two lines AppKit picks its own default and a light page hands the visitor a
    // dark modal mid-purchase. `--w3m-accent` is a literal because the modal renders in
    // its own shadow root, where this page's custom properties are not in scope; it comes
    // from `lib/theme.ts`, the same projection the OG images use.
    themeMode: "light",
    themeVariables: { "--w3m-accent": ACCENT.base },
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // One QueryClient per app mount, created through `useState` rather than at module
  // level: a module-level client would be shared across requests on the server.
  const [queryClient] = useState(() => new QueryClient());

  if (!walletEnabled || !wagmiAdapter) return <>{children}</>;

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
