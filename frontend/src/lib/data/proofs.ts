import type { Proof } from "@/lib/chain";

const TX = /0x[0-9a-fA-F]{64}/g;

/**
 * Transactions a listing owner cites in its own on-chain `proof` text, one row each.
 *
 * Guardian's listing has named its repay transaction since September, and its page
 * still said "No transactions listed here" because nothing read the hash out of the
 * sentence. Any listing that cites a hash now gets the row, with the sentence that
 * cites it. They are the owner's claims, labelled as such: the row opens the block
 * explorer, so a reader checks the claim instead of trusting it.
 */
export function proofsFromText(text: string | null | undefined): Proof[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: Proof[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const hash of sentence.match(TX) ?? []) {
      const key = hash.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const detail = sentence.trim();
      out.push({
        label: "Cited by the listing owner",
        detail: detail.length > 280 ? `${detail.slice(0, 277)}...` : detail,
        hash,
      });
    }
  }
  return out;
}
