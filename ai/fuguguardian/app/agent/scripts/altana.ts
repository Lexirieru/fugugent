/**
 * Shared Altana plumbing for the operational scripts (granting a session, setting up a
 * position, probing the boundary, and E2E). No strategy logic here.
 *
 * Why NOT `ensureAltanaSessionLoaded()` + `getWallet()` from
 * `@bnbagent/studio-runtime/wallet`: that path forces a session's `permissions.calls` to
 * match the SDK's `defaultAgentPermissions()` **exactly** (ERC-8004 + ERC-8183), and rejects
 * any other session with "Altana session does not match the selector-bound
 * @bnbagent/sdk@0.5.4 permission set" — see `inspectAltanaSessionPermissions` in
 * `studio-runtime/dist/chunk-ZZZFODYE.js:76`. The Guardian session here specifically MUST
 * have a different allowlist (repay + approve, nothing more), so it is loaded via
 * `deserializeSession` + `AltanaWalletProvider` from `@bnbagent/sdk` directly. The old
 * commercial session is untouched and the agent runtime keeps using it as-is.
 *
 * The `signer` part of the session file is never read, parsed, or printed here: its content
 * is handed intact to `deserializeSession`, which verifies for itself that the key inside
 * derives the recorded `publicKey`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BNB_TESTNET } from "@altananetwork/sdk";
import {
  AltanaWalletProvider,
  deserializeSession,
  setAltanaSdkImporter,
  type AltanaNetworkConfig,
  type AltanaSession,
} from "@bnbagent/sdk/wallets";
import { resolveProjectAltanaSdkEntry } from "@bnbagent/studio-runtime/wallet";
import { encodeFunctionData, type Abi, type PublicClient } from "viem";

/** `.../ai/fuguguardian/app/agent` — the project root `bag` uses. */
export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `.../ai/fuguguardian` — the workspace `.studio/` lives in. */
export const WORKSPACE_ROOT = path.resolve(AGENT_ROOT, "../..");

/** The Altana admin keystore directory (see `[wallet].keystore_dir` in studio.toml). */
export const KEYSTORE_DIR = path.join(WORKSPACE_ROOT, ".studio/wallets");

/**
 * Guardian's own bounded session file. SEPARATE from `altana-session.json` (the commercial
 * ERC-8004/8183 session `bag dev` uses), so neither overwrites the other.
 */
export const GUARDIAN_SESSION_FILE = path.join(KEYSTORE_DIR, "altana-session-guardian.json");

/**
 * The Altana network config for BSC testnet, with `publicRpcUrl` OVERRIDDEN. The
 * Keystore/Controller/relay addresses are taken as-is from the SDK preset so there is no
 * copy of an address that could drift.
 *
 * `ALTANA_RELAY_URL` may override the relay endpoint. Its purpose is not merely
 * configuration: pointing it at a dead endpoint is how you PROVE that the denial test does
 * not accept a network failure as "the session boundary works" — the probe script must die
 * with a "NOT because of the session boundary" error rather than printing a check mark.
 */
export function altanaTestnetNetwork(rpcUrl: string): AltanaNetworkConfig {
  const relayUrl = process.env.ALTANA_RELAY_URL;
  return {
    ...BNB_TESTNET,
    publicRpcUrl: rpcUrl,
    ...(relayUrl ? { relayUrl } : {}),
  } as AltanaNetworkConfig;
}

/**
 * Arms the ESM loader for the `@altananetwork/sdk` installed in this project. Without it,
 * `import("@altananetwork/sdk")` from inside the `@bnbagent/sdk` package cannot be resolved
 * in pnpm's layout.
 */
export function armAltanaSdk(): void {
  const entry = resolveProjectAltanaSdkEntry(AGENT_ROOT);
  if (entry === null) {
    throw new Error(
      `@altananetwork/sdk tidak ditemukan dari ${AGENT_ROOT}; jalankan pnpm install di app/agent.`,
    );
  }
  setAltanaSdkImporter(() => import(entry));
}

/** Loads the Guardian session from disk. The `signer` content is never touched here. */
export async function loadGuardianSession(file = GUARDIAN_SESSION_FILE): Promise<AltanaSession> {
  const serialized = readFileSync(file, "utf8");
  return deserializeSession(serialized);
}

/** A session-mode provider: it can ONLY execute within the permissions granted. */
export function sessionProvider(
  session: AltanaSession,
  rpcUrl: string,
): AltanaWalletProvider {
  return new AltanaWalletProvider({ session, network: altanaTestnetNetwork(rpcUrl) });
}

/**
 * An admin-mode provider from the encrypted keystore. Used ONLY for setup (granting a
 * session, opening the sample position) — never for the repay being proven.
 */
export function adminProvider(password: string, address: string, rpcUrl: string): AltanaWalletProvider {
  return AltanaWalletProvider.adminFromKeystore({
    password,
    address,
    walletsDir: KEYSTORE_DIR,
    network: altanaTestnetNetwork(rpcUrl),
  });
}

/** One contract call sent through the Altana relay. */
export interface RelayCall {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/**
 * The result of one relay execution. Its shape is deliberately narrowed: the SDK's
 * `TxResult` refers to a different viem instance in the dependency tree (the SDK is hoisted
 * to the workspace root), so its `TransactionReceipt` type is not assignable in either
 * direction. All the scripts need are the fields below.
 */
export interface RelayResult {
  readonly transactionHash: `0x${string}`;
  readonly status: number;
  readonly receipt: {
    readonly from: `0x${string}`;
    readonly to: `0x${string}` | null;
    readonly blockNumber: bigint;
    readonly gasUsed: bigint;
    readonly logs: readonly {
      readonly address: `0x${string}`;
      readonly topics: readonly `0x${string}`[];
      readonly data: `0x${string}`;
    }[];
  } | null;
}

/**
 * Binds one Altana provider (admin mode OR session mode) to a `PublicClient`, and returns a
 * send-ONE-BATCH function.
 *
 * Why a batch, rather than one call per transaction like `AltanaIntentExecutor`: a session
 * key that holds a spend permission runs through Porto's guarded executor, and that guard
 * **returns ERC-20 allowances to zero at the end of the same userOp** — proven on this
 * task's first run (tx `0xf9570e1e...` carried two `Approval` events: 11.67 then 0), so a
 * `repay` in the next transaction failed with `ERC20InsufficientAllowance`. That behavior is
 * in fact correct — an allowance from a leaked key must not outlive its transaction — and
 * the answer is to send `approve` + `repay` as ONE atomic userOp.
 *
 * The relay does not return a receipt itself, so `client` is what waits for it, and both a
 * `FAILED` status and an on-chain revert are thrown.
 */
export function relaySender(
  provider: AltanaWalletProvider,
  client: PublicClient,
): (calls: readonly RelayCall[], description: string) => Promise<RelayResult> {
  return async (calls, description) => {
    if (calls.length === 0) throw new Error(`Batch "${description}" kosong.`);

    const encoded = calls.map((call) => ({
      to: call.address,
      value: 0n,
      data: encodeFunctionData({
        abi: call.abi as Abi,
        functionName: call.functionName,
        args: call.args,
      }),
    }));

    const result = await provider._relayExecute(encoded, description);
    if (result.status === "FAILED") {
      throw new Error(`Relay Altana melapor FAILED untuk ${description} (callsId ${result.callsId}).`);
    }
    const hash = result.transactionHash;
    if (!hash) {
      throw new Error(
        `Relay Altana melapor ${result.status} tanpa transactionHash untuk ${description} ` +
          `(callsId ${result.callsId}); inklusi on-chain tidak bisa dipastikan.`,
      );
    }

    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      throw new Error(`Transaksi ${description} revert on-chain (${hash}).`);
    }
    return { transactionHash: hash, status: 1, receipt: receipt as unknown as RelayResult["receipt"] };
  };
}
