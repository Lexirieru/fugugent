/**
 * Which transaction minted an agent's identity — found by 8004scan, **proved by
 * the chain**.
 *
 * The Phase 2 brief asks for transaction hashes per agent. The chain has no
 * lookup from token id to transaction, and the one that would build it —
 * historical `eth_getLogs` — is refused by every free BSC testnet RPC (see the
 * header of `registry.ts`). 8004scan does know the hash (`created_tx_hash` on its
 * detail endpoint). So it is used as a **hint**, and nothing more:
 *
 * 1. Ask 8004scan for the hash.
 * 2. Fetch that transaction's receipt from our own RPC. Old receipts are served
 *    (checked 2026-09-25 against ids 0, 5, 900, 1854, 2474).
 * 3. Accept it only if the receipt succeeded and contains a `Registered` log
 *    emitted **by this registry** whose `agentId` topic is **this id**.
 *
 * A hint that fails step 3 is dropped. There is no "unverified" hash on a card:
 * showing one would put 8004scan's word where the page promises the chain's.
 *
 * Results are cached for the life of the process — a mint is a fact about a
 * past block and does not change — and failures are retried only after a pause,
 * so a detail page never waits on the same dead lookup twice in a row.
 */

import type { Chain, Client, Transport } from "viem";
import { getBlock, getTransactionReceipt } from "viem/actions";
import type { Address, RegistrationProof } from "../types.js";
import type { Scan8004Source } from "./scan8004.js";

/** `keccak256("Registered(uint256,string,address)")`. */
export const REGISTERED_TOPIC =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a" as const;
/** A lookup that failed is not repeated for this long. */
export const PROOF_RETRY_MS = 10 * 60_000;

/** What the proof needs from the chain. Injected so tests never touch an RPC. */
export interface ReceiptReader {
  receipt(hash: `0x${string}`): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly { address: string; topics: readonly string[] }[];
  } | null>;
  blockTimestamp(blockNumber: bigint): Promise<bigint | null>;
}

export function createViemReceiptReader(client: Client<Transport, Chain | undefined>): ReceiptReader {
  return {
    async receipt(hash) {
      try {
        const r = await getTransactionReceipt(client, { hash });
        return { status: r.status, blockNumber: r.blockNumber, logs: r.logs };
      } catch {
        return null;
      }
    },
    async blockTimestamp(blockNumber) {
      try {
        return (await getBlock(client, { blockNumber })).timestamp;
      } catch {
        return null;
      }
    },
  };
}

/** Where the hint comes from. `Scan8004Source.getAgent` keeps the raw payload, which carries it. */
export type RegistrationHint = (tokenId: string) => Promise<`0x${string}` | null>;

export function scan8004Hint(scan: Scan8004Source, chainId: number): RegistrationHint {
  return async (tokenId) => {
    const detail = await scan.getAgent(chainId, tokenId);
    if (!detail.healthy || detail.agent === null) return null;
    const raw = detail.agent.raw as Record<string, unknown> | undefined;
    const hash = raw?.created_tx_hash;
    return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as `0x${string}`) : null;
  };
}

export interface RegistrationProver {
  /** The proof if it is already known. Never waits. */
  peek(tokenId: string): RegistrationProof | null;
  /** Find and check the proof. Never throws; `null` when it cannot be proved now. */
  prove(tokenId: string): Promise<RegistrationProof | null>;
}

export interface RegistrationProverOptions {
  hint: RegistrationHint;
  receipts: ReceiptReader;
  registryAddress: Address;
  nowMs?: () => number;
}

export function createRegistrationProver(options: RegistrationProverOptions): RegistrationProver {
  const nowMs = options.nowMs ?? (() => Date.now());
  const registry = options.registryAddress.toLowerCase();
  const proven = new Map<string, RegistrationProof>();
  const failedAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<RegistrationProof | null>>();

  async function lookup(tokenId: string): Promise<RegistrationProof | null> {
    const hash = await options.hint(tokenId).catch(() => null);
    if (hash === null) return null;
    const receipt = await options.receipts.receipt(hash);
    if (receipt === null || receipt.status !== "success") return null;

    const id = BigInt(tokenId);
    const minted = receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === registry &&
        log.topics[0]?.toLowerCase() === REGISTERED_TOPIC &&
        log.topics[1] !== undefined &&
        BigInt(log.topics[1]) === id,
    );
    if (!minted) return null;

    const timestamp = await options.receipts.blockTimestamp(receipt.blockNumber);
    return {
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      registeredAt: timestamp === null ? null : new Date(Number(timestamp) * 1000).toISOString(),
      hintedBy: "8004scan",
    };
  }

  return {
    peek: (tokenId) => proven.get(tokenId) ?? null,

    prove(tokenId) {
      const known = proven.get(tokenId);
      if (known !== undefined) return Promise.resolve(known);
      const failed = failedAt.get(tokenId);
      if (failed !== undefined && nowMs() - failed < PROOF_RETRY_MS) return Promise.resolve(null);
      const running = inFlight.get(tokenId);
      if (running !== undefined) return running;

      const work = lookup(tokenId)
        .catch(() => null)
        .then((proof) => {
          if (proof === null) failedAt.set(tokenId, nowMs());
          else proven.set(tokenId, proof);
          return proof;
        })
        .finally(() => inFlight.delete(tokenId));
      inFlight.set(tokenId, work);
      return work;
    },
  };
}
