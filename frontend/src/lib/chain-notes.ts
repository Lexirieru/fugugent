/**
 * The five notes the carousel on the start page reads out.
 *
 * The component this data feeds was ported from a marketing carousel whose five slides
 * were named people with stock photographs saying flattering things. Not one of those
 * people ever said anything about this product, and the whole argument of this product
 * is that it does not overstate anything, so the slides carry records instead of
 * opinions. Every line below happened on BNB Chain testnet and every line below can be
 * opened on BscScan, except the one that deliberately cannot, which says so.
 *
 * Sources, all inside this repository:
 *
 * | note | source |
 * |---|---|
 * | health factor | `docs/STATUS.md` A4, `docs/e2e/2026-09-08-e2e-testnet.md` step 3 |
 * | refused call  | `docs/e2e/2026-09-08-e2e-testnet.md` "Evidence 2", step 5 |
 * | first hire    | `docs/STATUS.md` item 12 |
 * | nine kinds    | `docs/setup/ENVIRONMENT.md` G2 |
 * | five contracts| `contracts/deployments/bsc-testnet.json` → `implementations` |
 *
 * If you change a number here, change it because the chain changed, and bring the new
 * hash with it.
 */

import { bscTestnet } from "viem/chains";
import { createPublicClient, http } from "viem";
import { CHAIN, CONTRACTS, addressUrl, txUrl } from "@/lib/chain";
import { source } from "@/lib/data";
import type { FuguKind } from "@/lib/fugu";
import { SOURCE_LABEL } from "@/lib/provenance";

export interface ChainNote {
  /** A stable key, and the anchor a future deep link would use. */
  id: string;
  /** What happened, in one plain sentence. This is the card's body. */
  fact: string;
  /** Who or what did it. */
  actor: string;
  /** The kind of record it is. */
  category: string;
  /** The character drawn beside the actor. */
  kind: FuguKind;
  /** Colour seed, used only when `kind` is `"fallback"`. */
  seed?: string;
  /** `null` when there genuinely is nothing to open. `noLinkReason` is then required. */
  link: { href: string; text: string } | null;
  /** Why there is no link. Never a shrug: it has to explain. */
  noLinkReason?: string;
}

export const CHAIN_NOTES: ChainNote[] = [
  {
    id: "health-factor",
    fact: "A loan was close to being sold off underneath its owner, at a health factor of 1.14. The agent paid $4.03 of the debt and brought that number back to 1.50, in a single transaction it signed with a key that was only ever allowed to repay.",
    actor: "Fugu Guardian",
    category: "Health factor",
    kind: "guardian",
    link: {
      href: txUrl("0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc"),
      text: "0x619cfbe3…1e08cc, block 129852222",
    },
  },
  {
    id: "refused-call",
    fact: "The same key was then told to send that money somewhere else. The wallet contract refused, because moving money was never on the list of things it could do. Nothing was spent and no balance moved.",
    actor: "The wallet the agent signs with",
    category: "Refused on purpose",
    kind: "guardian",
    link: null,
    noLinkReason:
      "No link, and that is the point. The refusal came before the transaction was sent, so no block ever held it. The probe script in ai/fuguguardian repeats it.",
  },
  {
    id: "first-hire",
    fact: "Somebody hired an agent here for the first time. $0.50 went into the escrow contract as subscription 2, and it stays there until the agent claims the seconds it has actually served.",
    actor: "FuguSubscription",
    category: "First hire",
    kind: "broker",
    link: {
      href: txUrl("0x74fa4d9d67daea5c722f2dbc9fd1f43d7e5725d621c412e079085c7c856fe8ac"),
      text: "0x74fa4d9d…56fe8ac, block 130003006",
    },
  },
  {
    id: "nine-kinds",
    fact: "The catalogue used to hold four kinds of agent and now holds nine. The upgrade took one transaction and 37,649 units of gas, and the four listings that already existed read back exactly as they did before it.",
    actor: "FuguRegistry",
    category: "Contract upgrade",
    kind: "fallback",
    seed: "fugu-registry-upgrade",
    link: {
      href: txUrl("0x24438b39a85ceeb9411d1cb4197ea8369eb1d1a44c3213656a43cf32c4050c5f"),
      text: "0x24438b39…50c5f, block 130002412",
    },
  },
  {
    id: "verified-source",
    fact: "Five contracts run this marketplace and the source code of all five is published on BscScan, so the explorer shows you what they do instead of a wall of bytes. This link opens the registry; the foot of every page carries the other four.",
    actor: "Five contracts on network 97",
    category: "Published source",
    kind: "fallback",
    seed: "fugu-verified-contracts",
    link: {
      href: `${addressUrl(CONTRACTS.registry)}#code`,
      text: "0xb2f36070…13ae248, read the source",
    },
  },
];

/**
 * The two counts shown beside the heading, both read at request time.
 *
 * They were typed in first, as "9 of 112", and that lasted about an hour: the live
 * catalogue answered 132 the next time it was asked, and one of the nine categories
 * moved by twenty between two calls a second apart. A hardcoded pair on a page whose
 * entire argument is "every number here is checkable" is the exact failure this product
 * was built against, so both halves are read rather than remembered.
 *
 * `hireable` comes from `listingCount()` on FuguRegistry, which is the definitive
 * answer and costs one `eth_call`. `total` is the catalogue the backend indexes, summed
 * over its nine categories. Either can come back `null`, and the card then shows only
 * the half it actually knows. The link never disappears, because counting them yourself
 * on `/agents?available=yes` is the point and it works whether or not these reads did.
 */
export interface CatalogueCount {
  /** Listings on FuguRegistry. `null` when the chain could not be reached. */
  hireable: number | null;
  /** Agents in the indexed catalogue. `null` when the catalogue could not be reached. */
  total: number | null;
  /** Where `total` came from, so a degraded answer is never presented as a live one. */
  totalSource: string | null;
  href: string;
}

export const CATALOGUE_HREF = "/agents?available=yes";

/**
 * Read both counts. Server only, and it never throws: a failure is a `null`, which the
 * card renders as an absent number rather than as a guess.
 */
export async function readCatalogueCount(): Promise<CatalogueCount> {
  const [hireable, catalogue] = await Promise.all([readListingCount(), readCatalogueTotal()]);
  return { hireable, total: catalogue.total, totalSource: catalogue.source, href: CATALOGUE_HREF };
}

async function readListingCount(): Promise<number | null> {
  try {
    // A short leash and one retry, on purpose. This read sits in front of the start
    // page, so an RPC that has gone quiet must cost the reader a missing number, not
    // ten seconds of blank screen. viem's defaults would allow far longer than that.
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(CHAIN.rpc, { timeout: 4000, retryCount: 1, retryDelay: 200 }),
    });
    const count = await client.readContract({
      address: CONTRACTS.registry as `0x${string}`,
      abi: LISTING_COUNT_ABI,
      functionName: "listingCount",
    });
    return Number(count);
  } catch {
    return null;
  }
}

async function readCatalogueTotal(): Promise<{ total: number | null; source: string | null }> {
  const result = await source().listCategories();
  // The seed rung is four sample agents, not the catalogue, so it is not a total. Saying
  // "4 in the catalogue" would be worse than saying nothing.
  if (!result.provenance.healthy || result.provenance.source === "seed") {
    return { total: null, source: null };
  }
  const total = result.categories.reduce((sum, c) => sum + c.count, 0);
  return { total, source: SOURCE_LABEL[result.provenance.source] };
}

const LISTING_COUNT_ABI = [
  {
    type: "function",
    name: "listingCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
