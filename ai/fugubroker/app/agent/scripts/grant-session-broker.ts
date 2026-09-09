/**
 * Grants one bounded key for Fugu Broker.
 *
 * The list of methods this key may call is DELIBERATELY narrow: renting on the payment
 * contract, and letting that contract take the agreed amount of one token. Both entries
 * name a contract AND a method at once. An empty or missing list means UNLIMITED
 * permission in this wallet, so the list is built by `requiredSessionCalls()`, which is
 * the same function `createSessionHire` uses to CHECK the key before it pays. The two
 * therefore cannot drift apart.
 *
 * Spending caps:
 *   - the chain's own coin, 0.02 per day. This also pays for delivering the transaction,
 *     and a cap that is too small makes every attempt fail before it reaches a block.
 *   - the payment token, 5 per day, in 18 decimals like every token on BSC. Far above one
 *     rental, and still a hard limit the wallet contract enforces.
 *
 * The key is written to a file SEPARATE from the commercial `altana-session.json`, with
 * file mode 0600, inside the already-ignored `.studio/` directory. Its secret part is
 * never read, printed, or copied by this script.
 *
 * THIS SCRIPT HAS NOT BEEN RUN. Fugu Broker has no wallet yet, because creating one and
 * granting a key both need a funded testnet wallet, and no funded wallet was created for
 * this agent. Run it from `ai/fugubroker/app/agent` once there is one:
 *
 *   bag wallet new                      # creates the encrypted wallet under .studio/
 *   npx tsx scripts/grant-session-broker.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, loadStudioToml } from "@bnbagent/studio-runtime/config";
import { serializeSession } from "@bnbagent/sdk/wallets";

import {
  AGENT_ROOT,
  BROKER_SESSION_FILE,
  WORKSPACE_ROOT,
  adminProvider,
  armAltanaSdk,
} from "../src/altana.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  FUGU_SUBSCRIPTION_ADDRESS,
  TOKEN_USDT,
} from "../src/strategy/chain/testnet.js";
import { requiredSessionCalls } from "../src/strategy/chain/session.js";

/** 0.02 of the chain's own coin per day. It also pays for delivering the transaction. */
const NATIVE_CAP_WEI = 20_000_000_000_000_000n;

/** 5 payment tokens per day. 18 decimals, like every token on BSC. */
const TOKEN_CAP = 5n * 10n ** 18n;

const EXPIRY_DAYS = 30;

/**
 * The wallet this key belongs to.
 *
 * Read from `studio.toml`, which `bag wallet new` fills in, rather than written here.
 * A wrong address in this file would grant a key against a wallet nobody owns, and the
 * failure would only appear when a payment was attempted.
 */
function altanaWallet(): `0x${string}` {
  const configured = process.env.ALTANA_WALLET_ADDRESS;
  if (configured) return configured as `0x${string}`;
  const cfg = loadStudioToml();
  const wallet = (cfg.wallet ?? {}) as Record<string, unknown>;
  const address = typeof wallet.address === "string" ? wallet.address : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(
      "studio.toml has no [wallet].address, so this agent has no wallet yet. Run `bag wallet new` " +
        "first, fund the printed address, and run this script again.",
    );
  }
  return address as `0x${string}`;
}

async function main(): Promise<void> {
  loadEnv(path.join(WORKSPACE_ROOT, ".studio/.env.local")); // WALLET_PASSWORD
  loadEnv(path.resolve(AGENT_ROOT, "../../../../contracts/.env")); // BSC_TESTNET_RPC_URL

  const password = process.env.WALLET_PASSWORD;
  if (!password) {
    throw new Error(
      "WALLET_PASSWORD is empty. Set it in .studio/.env.local, never on the command line.",
    );
  }
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;
  const wallet = altanaWallet();
  const payToken = (process.env.BROKER_PAY_TOKEN ?? TOKEN_USDT) as `0x${string}`;

  const calls = requiredSessionCalls(FUGU_SUBSCRIPTION_ADDRESS, payToken);
  const spend = [
    { limit: NATIVE_CAP_WEI, period: "day" as const },
    { limit: TOKEN_CAP, period: "day" as const, token: payToken },
  ];
  const expiry = Math.floor(Date.now() / 1000) + EXPIRY_DAYS * 24 * 60 * 60;

  console.log("Granting one bounded key for Fugu Broker");
  console.log(`  RPC            : ${rpcUrl}`);
  console.log(`  Wallet         : ${wallet}`);
  console.log(`  Key file       : ${BROKER_SESSION_FILE}`);
  console.log("  Methods allowed (contract and method together, both required):");
  for (const call of calls) console.log(`    - ${call.to}  ${call.signature}`);
  console.log("  Spending caps:");
  console.log(`    - ${NATIVE_CAP_WEI} wei per day of the chain's own coin (0.02)`);
  console.log(`    - ${TOKEN_CAP} units per day of ${payToken} (5 tokens, 18 decimals)`);
  console.log(`  Expires        : ${expiry} (${new Date(expiry * 1000).toISOString()})`);
  console.log("  Registered     : true, so anyone can check it in the wallet registry");

  if (existsSync(BROKER_SESSION_FILE) && process.env.FORCE_REGRANT !== "1") {
    throw new Error(
      `${BROKER_SESSION_FILE} already exists. Granting again costs the registration fee a ` +
        "second time; run with FORCE_REGRANT=1 if that is really what is wanted.",
    );
  }

  armAltanaSdk();
  const admin = adminProvider(password, wallet, rpcUrl);
  if (admin.address.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error(
      `The wallet file opened ${admin.address}, not ${wallet}. Refusing to continue.`,
    );
  }

  const session = await admin.grantSession({
    permissions: { calls, spend },
    expiry,
    register: true,
  });

  mkdirSync(path.dirname(BROKER_SESSION_FILE), { recursive: true });
  writeFileSync(BROKER_SESSION_FILE, serializeSession(session), { mode: 0o600 });

  // ONLY public details are printed. The secret part of the key is never touched.
  console.log("\nThe key was granted and saved.");
  console.log(`  walletAddress : ${session.walletAddress}`);
  console.log(`  publicKey     : ${session.publicKey}`);
  console.log(`  expiry        : ${session.expiry}`);
  const txHash = (session as { transactionHash?: string }).transactionHash;
  console.log(`  grant tx      : ${txHash ?? "(the relay reported no hash)"}`);
  if (txHash) console.log(`  https://testnet.bscscan.com/tx/${txHash}`);
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
