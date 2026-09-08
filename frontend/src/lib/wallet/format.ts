/**
 * Text for **native coin values (tBNB, 18 decimals)**.
 *
 * Deliberately separate from `money.ts`: that module owns USD in 8-decimal base
 * and nothing else. tBNB is not USD8 money, so mixing it in would corrupt the one
 * place where USD8 is allowed to become text. Same discipline: `bigint` in, text out.
 */

import { formatUnits } from "viem";

/** tBNB to at most 6 decimals, without misleading trailing zeros. */
export function formatTbnb(wei: bigint, decimals = 6): string {
  const full = formatUnits(wei, 18);
  const [whole, frac = ""] = full.split(".");
  const cut = frac.slice(0, decimals).replace(/0+$/, "");
  // A non-zero value that rounds to "0" is the easiest lie to tell here — show the
  // full precision instead of a zero.
  if (!cut && wei > 0n) return full;
  return cut ? `${whole}.${cut}` : whole;
}

/** Deterministic UTC stamp from an on-chain timestamp in seconds. */
export function formatChainTime(seconds: bigint): string {
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Turns a contract write failure into one sentence that names what happened and
 * what can be done about it. No dead ends: every branch carries a next step.
 */
export function explainWriteError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const text = raw.toLowerCase();

  if (text.includes("user rejected") || text.includes("user denied") || text.includes("4001")) {
    return "You rejected the signature in your wallet, so nothing was sent and nothing was charged. Press the button again when you are ready.";
  }
  if (text.includes("amountexceedsmax")) {
    return "The price moved above the cap we quoted, so the contract refused before touching your funds. Nothing was charged. Reload the quote and try again.";
  }
  if (text.includes("deadlinepassed")) {
    return "The transaction sat unsigned past its 10-minute deadline and the contract rejected it. Nothing was charged. Try again to get a fresh quote.";
  }
  if (text.includes("wrongnativeamount")) {
    return "The oracle price changed between the quote and the block, and this contract requires the exact amount. Nothing was charged. Try again — the quote refreshes every 15 seconds.";
  }
  if (text.includes("listinginactive")) {
    return "The owner deactivated this listing while you were deciding. It cannot be hired right now.";
  }
  if (text.includes("zeroperiods")) {
    return "Periods must be at least 1. Pick a number above zero.";
  }
  if (text.includes("insufficient funds") || text.includes("exceeds the balance")) {
    return "Your wallet does not hold enough tBNB for the payment plus gas. Top up from the BNB Chain testnet faucet and try again.";
  }
  if (text.includes("chain mismatch") || text.includes("does not match")) {
    return "Your wallet is on a different chain than BSC testnet. Switch network and try again.";
  }
  // The raw sentence is still shown: an unrecognised message is more useful than
  // "something went wrong", which nobody can act on.
  return `The transaction did not go through: ${raw.slice(0, 300)}`;
}
