/**
 * The one place that turns a public endpoint into catalog reads.
 *
 * Reading only. Nothing here signs, sends, or spends. That separation is why the decision
 * engine can be handed a catalog from a fixture in a test and a catalog from the chain in
 * production without knowing which it got.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { FUGU_REGISTRY_ABI, readCatalog, type CatalogReadResult, type RawListing } from "./registry.js";
import { DEFAULT_BSC_TESTNET_RPC_URL, FUGU_REGISTRY_ADDRESS } from "./testnet.js";

/**
 * A read-only client for BSC testnet.
 *
 * The endpoint is always given explicitly. Several libraries in this project default to a
 * `binance.org` address that is blocked from the network this project is built on, and
 * the failure it produces looks like a timeout rather than a block, which costs an hour
 * every time somebody meets it for the first time.
 */
export function publicClientFor(rpcUrl = DEFAULT_BSC_TESTNET_RPC_URL): PublicClient {
  return createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) }) as PublicClient;
}

/** How many listings the catalog holds. */
export async function readListingCount(
  client: PublicClient,
  registry: `0x${string}` = FUGU_REGISTRY_ADDRESS,
): Promise<bigint> {
  return (await client.readContract({
    address: registry,
    abi: FUGU_REGISTRY_ABI,
    functionName: "listingCount",
  })) as bigint;
}

/** The whole catalog, read one listing at a time. */
export async function readLiveCatalog(
  client: PublicClient,
  registry: `0x${string}` = FUGU_REGISTRY_ADDRESS,
): Promise<CatalogReadResult> {
  const count = await readListingCount(client, registry);
  return readCatalog(count, async (listingId) => {
    const listing = (await client.readContract({
      address: registry,
      abi: FUGU_REGISTRY_ABI,
      functionName: "getListing",
      args: [listingId],
    })) as RawListing;
    return listing;
  });
}
