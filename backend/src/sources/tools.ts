/**
 * The five read-only HelloFugu agents: Watch, Tally, Scout, Keycheck and Quote.
 *
 * Each one answers a question from chain state (or from the catalogue, which is itself
 * read from the ERC-8004 registry) and signs nothing. They exist so that a listing in
 * the marketplace is backed by something that actually runs, even when the agent does
 * not move money: `GET /api/run/<slug>` is the agent, and its ERC-8004 registration
 * names that URL as its service.
 *
 * Every answer states the block it was read at, like `/api/tracking`, so a reader can
 * re-run the same call against their own RPC and get the same numbers.
 */
import type { Chain, Client, Transport } from "viem";
import { getBlockNumber, readContract } from "viem/actions";
import type { TrackingService } from "./tracking.js";
import type { Address, Category } from "../types.js";

/** The test lending pool (Aave v3 `getUserAccountData` ABI) Fugu Guardian rescued a loan on. */
export const TEST_LENDING_POOL: Address = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5";
/** Altana's on-chain session key registry on BSC testnet. */
export const ALTANA_KEYSTORE: Address = "0x6b8361C29d05D498b1a12B54A37310f94171E94A";
/** The FuguPriceOracle proxy the hire panel quotes from. */
export const PRICE_ORACLE: Address = "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65";

/** Fugu Guardian's thresholds (1e18 base), `ai/fuguguardian/app/agent/src/strategy/types.ts`. */
export const HF_WARN = 1_500_000_000_000_000_000n;
export const HF_REPAY = 1_200_000_000_000_000_000n;
export const HF_DELEVERAGE = 1_100_000_000_000_000_000n;

const POOL_ABI = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

const KEYSTORE_ABI = [
  {
    type: "function",
    name: "isValidKey",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyHash", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ORACLE_ABI = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "usdAmount8", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "priceUsd8",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const NATIVE: Address = "0x0000000000000000000000000000000000000000";

/** The chain reads, injected so no test touches an RPC. */
export interface ToolsChain {
  blockNumber(): Promise<bigint>;
  accountData(user: Address, blockNumber: bigint): Promise<{ collateral: bigint; debt: bigint; healthFactor: bigint }>;
  isValidKey(account: Address, keyHash: `0x${string}`, blockNumber: bigint): Promise<boolean>;
  quoteNative(usd8: bigint, blockNumber: bigint): Promise<{ amountWei: bigint; priceUsd8: bigint }>;
}

export function createViemToolsChain(client: Client<Transport, Chain | undefined>): ToolsChain {
  return {
    blockNumber: () => getBlockNumber(client),
    async accountData(user, blockNumber) {
      const r = await readContract(client, {
        address: TEST_LENDING_POOL,
        abi: POOL_ABI,
        functionName: "getUserAccountData",
        args: [user],
        blockNumber,
      });
      return { collateral: r[0], debt: r[1], healthFactor: r[5] };
    },
    isValidKey: (account, keyHash, blockNumber) =>
      readContract(client, {
        address: ALTANA_KEYSTORE,
        abi: KEYSTORE_ABI,
        functionName: "isValidKey",
        args: [account, keyHash],
        blockNumber,
      }),
    async quoteNative(usd8, blockNumber) {
      const [amountWei, priceUsd8] = await Promise.all([
        readContract(client, { address: PRICE_ORACLE, abi: ORACLE_ABI, functionName: "quote", args: [NATIVE, usd8], blockNumber }),
        readContract(client, { address: PRICE_ORACLE, abi: ORACLE_ABI, functionName: "priceUsd8", args: [NATIVE], blockNumber }),
      ]);
      return { amountWei, priceUsd8 };
    },
  };
}

/** One agent the Scout can name. */
export interface ScoutPick {
  id: string;
  name: string;
  source: string;
}

export interface ToolsDeps {
  chain: ToolsChain;
  tracking: TrackingService;
  /** The catalogue for one category, as `/api/agents` serves it. */
  catalogue(category: Category, limit: number): Promise<{ items: ScoutPick[]; total: number; source: string }>;
  chainId: number;
}

/** `1.234` from a 1e18 fixed-point value, to three decimals, without floats. */
export function fixed18(v: bigint, decimals = 3): string {
  const scale = 10n ** BigInt(18 - decimals);
  const rounded = (v + scale / 2n) / scale;
  const whole = rounded / 10n ** BigInt(decimals);
  const frac = (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}

export type WatchVerdict = "no-loan" | "safe" | "warn" | "repay" | "deleverage";

/** The same bands Fugu Guardian acts on. */
export function watchVerdict(debt: bigint, healthFactor: bigint): WatchVerdict {
  if (debt === 0n) return "no-loan";
  if (healthFactor < HF_DELEVERAGE) return "deleverage";
  if (healthFactor < HF_REPAY) return "repay";
  if (healthFactor < HF_WARN) return "warn";
  return "safe";
}

const VERDICT_TEXT: Record<WatchVerdict, string> = {
  "no-loan": "No loan on this pool, nothing to watch.",
  safe: "Safe. Above 1.50, Fugu Guardian would do nothing.",
  warn: "Getting close. Below 1.50, Fugu Guardian would warn you.",
  repay: "At risk. Below 1.20, Fugu Guardian would repay part of the loan.",
  deleverage: "In danger. Below 1.10, Fugu Guardian would cut the position.",
};

export function createTools(deps: ToolsDeps) {
  const stamp = (blockNumber: bigint) => ({ chainId: deps.chainId, blockNumber: blockNumber.toString(), readAt: new Date().toISOString() });

  return {
    /** Fugu Watch: a loan's health factor on the test pool, in Guardian's bands. */
    async watch(wallet: Address) {
      const block = await deps.chain.blockNumber();
      const a = await deps.chain.accountData(wallet, block);
      const verdict = watchVerdict(a.debt, a.healthFactor);
      return {
        agent: "Fugu Watch",
        ...stamp(block),
        pool: TEST_LENDING_POOL,
        wallet,
        collateralUsd8: a.collateral.toString(),
        debtUsd8: a.debt.toString(),
        healthFactor: a.debt === 0n ? null : fixed18(a.healthFactor),
        verdict,
        says: VERDICT_TEXT[verdict],
      };
    },

    /** Fugu Tally: what a wallet has spent hiring agents here, per agent. */
    async tally(wallet: Address) {
      const h = await deps.tracking.hires(wallet);
      const byAgent = new Map<string, { agent: string; hires: number; spentWei: bigint }>();
      let spent = 0n;
      let running = 0;
      for (const row of h.hires) {
        // After a cancel, `deposited` is cut down to what the agent earned, so it is
        // what the hire actually cost. Only native tBNB is summed; other tokens are
        // counted but not added into a tBNB total.
        const key = row.agentName ?? `listing ${row.listingId}`;
        const entry = byAgent.get(key) ?? { agent: key, hires: 0, spentWei: 0n };
        entry.hires += 1;
        if (row.payToken === NATIVE) {
          entry.spentWei += BigInt(row.deposited);
          spent += BigInt(row.deposited);
        }
        byAgent.set(key, entry);
        if (row.status === "active") running += 1;
      }
      return {
        agent: "Fugu Tally",
        chainId: h.chainId,
        blockNumber: h.blockNumber,
        readAt: h.readAt,
        wallet,
        hires: h.hires.length,
        running,
        spentWei: spent.toString(),
        spentTbnb: fixed18(spent, 6),
        byAgent: [...byAgent.values()].map((e) => ({ agent: e.agent, hires: e.hires, spentWei: e.spentWei.toString(), spentTbnb: fixed18(e.spentWei, 6) })),
      };
    },

    /** Fugu Scout: who is on offer in one category, from the ERC-8004 catalogue. */
    async scout(category: Category, limit: number) {
      const page = await deps.catalogue(category, limit);
      // First-party listings are merged on top of a page, so it can run past `limit`.
      return { agent: "Fugu Scout", chainId: deps.chainId, readAt: new Date().toISOString(), category, total: page.total, source: page.source, picks: page.items.slice(0, limit) };
    },

    /** Fugu Keycheck: is an agent's session key still registered and valid. */
    async keycheck(account: Address, keyHash: `0x${string}`) {
      const block = await deps.chain.blockNumber();
      const valid = await deps.chain.isValidKey(account, keyHash, block);
      return {
        agent: "Fugu Keycheck",
        ...stamp(block),
        keystore: ALTANA_KEYSTORE,
        account,
        keyHash,
        valid,
        says: valid ? "Valid. This key can still act for the wallet, within its limits." : "Not valid. The key was revoked, expired, or never registered.",
      };
    },

    /** Fugu Quote: what a dollar amount costs in tBNB at the oracle's live price. */
    async quote(usd8: bigint) {
      const block = await deps.chain.blockNumber();
      const q = await deps.chain.quoteNative(usd8, block);
      return {
        agent: "Fugu Quote",
        ...stamp(block),
        oracle: PRICE_ORACLE,
        usd8: usd8.toString(),
        bnbPriceUsd8: q.priceUsd8.toString(),
        amountWei: q.amountWei.toString(),
        amountTbnb: fixed18(q.amountWei, 6),
      };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
