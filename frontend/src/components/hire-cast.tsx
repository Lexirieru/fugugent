"use client";

/**
 * The CLI path to the same hire.
 *
 * It survives the arrival of the wallet button for two real reasons: a reviewer
 * must be able to check the exact call the UI sends without installing a wallet,
 * and a build without `NEXT_PUBLIC_REOWN_PROJECT_ID` must not end up as a page with
 * no way out. The arguments are identical to what `HireAction` sends — including
 * `maxAmount` = quote + 1% and a ten-minute `deadline`.
 */

import { CopyButton } from "@/components/copy-button";
import { CHAIN, CONTRACTS } from "@/lib/chain";
import { formatUsd8 } from "@/lib/money";

export function HireCast({
  listingId,
  periods,
  usdTotal8,
}: {
  listingId: string;
  periods: number;
  /** Total USD8 as a decimal string — `bigint` does not cross the props boundary. */
  usdTotal8: string;
}) {
  const quoteCommand = `# 1. Ask the oracle what ${formatUsd8(BigInt(usdTotal8))} costs in tBNB right now
AMOUNT=$(cast call ${CONTRACTS.priceOracle} \\
  'quote(address,uint256)(uint256)' \\
  0x0000000000000000000000000000000000000000 ${usdTotal8} \\
  --rpc-url ${CHAIN.rpc} | awk '{print $1}')

# 2. Allow 1% of movement between the quote and the block that lands it.
#    Never send type(uint256).max here — the contract's own NatSpec says the UI must not.
MAX=$((AMOUNT + AMOUNT / 100))`;

  const hireCommand = `cast send ${CONTRACTS.subscription} \\
  'subscribe(uint256,uint32,address,uint256,uint256)' \\
  ${listingId} ${periods} 0x0000000000000000000000000000000000000000 "$MAX" $(( $(date +%s) + 600 )) \\
  --value "$AMOUNT" \\
  --rpc-url ${CHAIN.rpc} \\
  --private-key "$PRIVATE_KEY"`;

  return (
    <div className="rounded-xl border border-line bg-bg-elev">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
          Step 1 — quote and cap
        </span>
        <CopyButton text={quoteCommand} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
        {quoteCommand}
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
          Step 2 — hire
        </span>
        <CopyButton text={hireCommand} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
        {hireCommand}
      </pre>
    </div>
  );
}
