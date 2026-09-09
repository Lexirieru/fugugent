/**
 * Reads the live catalog and runs the hiring decision against it. Reads only.
 *
 * Nothing here signs, sends, or spends, and it needs no key and no funded wallet. It
 * exists because a decision engine that has only ever seen fixtures is a decision engine
 * nobody has checked against the data it will meet: prices really stored as whole numbers
 * on the 8-decimal basis, capability numbers really stored as they are, metadata really
 * carried inside the listing rather than at some address.
 *
 * Run it from `ai/fugubroker/app/agent`:
 *   npx tsx scripts/read-catalog.ts [capability] [seconds of work] [dollars]
 *
 * For example:
 *   npx tsx scripts/read-catalog.ts YIELD 3600 2
 */
import { decide } from "../src/strategy/decide.js";
import { publicClientFor, readLiveCatalog } from "../src/strategy/chain/client.js";
import { formatDuration, formatUsd8Exact } from "../src/strategy/format.js";
import {
  CATEGORY_NAMES,
  DEFAULT_POLICY,
  USD8_ONE,
  type Category,
} from "../src/strategy/types.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  FUGU_REGISTRY_ADDRESS,
} from "../src/strategy/chain/testnet.js";

function argCategory(raw: string | undefined): Category {
  const value = (raw ?? "YIELD").toUpperCase();
  if (!(CATEGORY_NAMES as readonly string[]).includes(value)) {
    throw new Error(
      `"${value}" is not a capability this agent knows. The nine are: ${CATEGORY_NAMES.join(", ")}.`,
    );
  }
  return value as Category;
}

async function main(): Promise<void> {
  const category = argCategory(process.argv[2]);
  const workSeconds = BigInt(process.argv[3] ?? "3600");
  const dollars = process.argv[4] ?? "2";
  const budgetUsd8 = BigInt(Math.round(Number(dollars) * Number(USD8_ONE)));

  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;
  console.log(`Reading the catalog at ${FUGU_REGISTRY_ADDRESS} through ${rpcUrl}`);

  const client = publicClientFor(rpcUrl);
  const { listings, unreadable } = await readLiveCatalog(client);

  console.log(`\n${listings.length} listing${listings.length === 1 ? "" : "s"} read.`);
  for (const listing of listings) {
    const name = listing.name.length > 0 ? listing.name : "(no name in its metadata)";
    console.log(
      `  ${listing.listingId}  ${listing.category.padEnd(14)} ${name.padEnd(18)} ` +
        `${formatUsd8Exact(listing.priceUsd8PerPeriod)} per ${formatDuration(listing.periodSeconds)}` +
        `${listing.active ? "" : "  [switched off]"}` +
        `${listing.curated ? "  [vetted]" : ""}` +
        `${listing.onchainExecution ? "  [says it carries out work]" : ""}`,
    );
  }
  for (const problem of unreadable) {
    console.log(`  ${problem.listingId}  COULD NOT BE READ: ${problem.reason}`);
  }

  const decision = decide(
    listings,
    { category, workSeconds, budgetUsd8 },
    DEFAULT_POLICY,
    // This agent's own listing, so it can never end up paying itself.
    { agentWallet: "0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3" },
  );

  console.log(
    `\nAsked for: ${category}, ${formatDuration(workSeconds)} of work, up to ` +
      `${formatUsd8Exact(budgetUsd8)}.`,
  );
  console.log(`Decision : ${decision.action}`);
  console.log(`Because  : ${decision.reason}`);
  if (decision.chosen !== null) {
    console.log(
      `Chosen   : listing ${decision.chosen.listingId}, ${decision.chosen.periods} blocks, ` +
        `${formatUsd8Exact(decision.chosen.totalUsd8)}, paid to ${decision.chosen.owner}`,
    );
  }
  if (decision.runnerUp !== null) {
    console.log(
      `Runner-up: listing ${decision.runnerUp.listingId} at ` +
        `${formatUsd8Exact(decision.runnerUp.totalUsd8)}`,
    );
  }
  console.log(`Puff     : ${decision.puffLevel}`);
  console.log("\nNothing was paid. This script reads and decides; it never signs anything.");
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
