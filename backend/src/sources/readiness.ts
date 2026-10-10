/**
 * "Would this agent count for Set and Earn?", answered as far as public data allows.
 *
 * BNB Chain's Build task checks six things about a participant's agent (the campaign
 * page, Tracks tab). This reads each one from the same places BNB says it will look:
 * the ERC-8004 registry, the agent's own endpoints, FuguRegistry and FuguSubscription,
 * and the chain. Where a check cannot be settled from here, it says `check` and names
 * what to look at, rather than guessing a pass. BNB's own review after the campaign is
 * what decides; this is a builder's checklist, not a verdict.
 */
import type { MetadataResolver } from "./registry-metadata.js";
import type { TrackingService } from "./tracking.js";
import type { Address, AgentRecord } from "../types.js";

export type CheckStatus = "pass" | "fail" | "check";

export interface ReadinessCheck {
  id: "registered" | "discoverable" | "live" | "hired" | "executes" | "matches";
  title: string;
  status: CheckStatus;
  detail: string;
  /** Where a reader can confirm it themselves. */
  href: string | null;
}

export interface ReadinessAnswer {
  agentId: string;
  name: string;
  checkedAt: string;
  checks: ReadinessCheck[];
  passed: number;
  /** `false` while the registry is still being read: some checks could not run yet. */
  complete: boolean;
  note: string;
}

export interface ReadinessDeps {
  /** The agent as the marketplace sees it, with its registry evidence. */
  agent(id: string): Promise<AgentRecord | null>;
  tracking: TrackingService;
  metadata: MetadataResolver;
  /** `eth_getTransactionCount` of an address: how many transactions it has sent. */
  sentCount(address: Address): Promise<number>;
  explorer: string;
}

/** The words that say which of the four quest categories an agent works in. */
const CATEGORY_WORDS: [string, RegExp][] = [
  ["yield", /\byield\b|\blending\b|\bvault\b|\bapr\b|\bapy\b/i],
  ["grid", /\bgrid\b/i],
  ["rebalancing", /\brebalanc/i],
  ["health factor", /health[\s-]?factor|liquidat/i],
];

export const MIN_OTHER_HIRERS = 3;
export const MIN_ACTIONS = 5;

const same = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && a.toLowerCase() === b.toLowerCase();

/** The endpoint a renter or a prober would call: A2A first, then MCP, then anything https. */
export function probeTarget(record: AgentRecord): string | null {
  const endpoints = record.evidence?.endpoints ?? [];
  const pick =
    endpoints.find((e) => /^a2a$/i.test(e.name)) ??
    endpoints.find((e) => /^mcp$/i.test(e.name)) ??
    endpoints.find((e) => e.endpoint.startsWith("https://") && !/^web$/i.test(e.name));
  return pick?.endpoint ?? null;
}

export function declaredCategories(text: string): string[] {
  return CATEGORY_WORDS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

export function createReadiness(deps: ReadinessDeps) {
  return {
    async check(id: string): Promise<ReadinessAnswer | null> {
      const agent = await deps.agent(id);
      if (agent === null) return null;
      const checks: ReadinessCheck[] = [];
      // The listing is read from FuguRegistry state directly (the tracking snapshot),
      // not from the catalogue overlay, which may be skipped on a slow read.
      const listing = await deps.tracking.listingHires(BigInt(agent.tokenId));
      const owner = agent.ownerAddress;
      const addr = (a: string) => `${deps.explorer}/address/${a}`;

      // 1. Registered, owned, listed.
      checks.push(
        listing === null
          ? { id: "registered", title: "Registered and listed", status: "fail", detail: "On the ERC-8004 registry, but not listed on HelloFugu yet. List it from /list with the wallet that owns it.", href: null }
          : same(listing.owner, owner)
            ? { id: "registered", title: "Registered and listed", status: "pass", detail: `ERC-8004 id ${agent.tokenId}, owned by ${owner}, listed as HelloFugu listing ${listing.listingId}. That owner must be your registered campaign wallet.`, href: owner ? addr(owner) : null }
            : { id: "registered", title: "Registered and listed", status: "fail", detail: `Listed by ${listing.owner}, but the ERC-8004 identity is owned by ${owner ?? "nobody we could read"}. They must be the same wallet.`, href: null },
      );

      // 2 and 3. Discoverable and live: fetch its card now, the way a prober would.
      const target = probeTarget(agent);
      const loading = agent.evidence == null;
      if (loading) {
        const detail = "The ERC-8004 registry is still being read after a restart. Try again in a minute.";
        checks.push({ id: "discoverable", title: "Agent card you can open", status: "check", detail, href: null });
        checks.push({ id: "live", title: "Answers when called", status: "check", detail, href: null });
      } else if (target === null) {
        checks.push({ id: "discoverable", title: "Agent card you can open", status: "fail", detail: "Its registration names no A2A or MCP endpoint, so there is no card to open.", href: null });
        checks.push({ id: "live", title: "Answers when called", status: "fail", detail: "No endpoint to call.", href: null });
      } else {
        const probe = await deps.metadata.resolve(target);
        const card = probe.file;
        const text = card ? [card.name, card.description, ...card.skills, ...card.domains, ...card.tags].join(" ") : "";
        const kinds = declaredCategories(`${text} ${agent.description}`);
        checks.push(
          card === null
            ? { id: "discoverable", title: "Agent card you can open", status: "fail", detail: `${target} did not return a readable card (${probe.reason ?? probe.status}).`, href: target }
            : kinds.length === 0
              ? { id: "discoverable", title: "Agent card you can open", status: "fail", detail: "The card opens, but never says which of yield, grid, rebalancing or health factor it works in.", href: target }
              : { id: "discoverable", title: "Agent card you can open", status: "pass", detail: `The card opens and names ${kinds.join(", ")}.`, href: target },
        );
        checks.push(
          card !== null
            ? { id: "live", title: "Answers when called", status: "pass", detail: "Answered just now. BNB probes at random times, so it has to stay up.", href: target }
            : { id: "live", title: "Answers when called", status: "fail", detail: `No answer just now: ${probe.reason ?? probe.status}.`, href: target },
        );
      }

      // 4. Hired by at least three other wallets, hires completed.
      if (listing === null) {
        checks.push({ id: "hired", title: `Hired by ${MIN_OTHER_HIRERS} other wallets`, status: "fail", detail: "Not listed here, so nobody has hired it here.", href: null });
      } else {
        const others = new Set(
          listing.hires
            .filter((h) => h.status === "ended" && !same(h.subscriber, listing.owner) && !same(h.subscriber, listing.agentWallet))
            .map((h) => h.subscriber.toLowerCase()),
        );
        checks.push({
          id: "hired",
          title: `Hired by ${MIN_OTHER_HIRERS} other wallets`,
          status: others.size >= MIN_OTHER_HIRERS ? "pass" : "fail",
          detail: `${others.size} completed ${others.size === 1 ? "hire" : "hires"} here from other wallets, ${MIN_OTHER_HIRERS} needed. The owner and the agent wallet do not count. BNB also excludes wallets you funded, which only they can see; hires on other marketplaces are not counted here.`,
          href: null,
        });
      }

      // 5. Acts on chain: at least five actions on three separate days.
      const wallet = listing?.agentWallet ?? agent.agentWallet;
      if (wallet === null) {
        checks.push({ id: "executes", title: `${MIN_ACTIONS} on-chain actions, on 3 days`, status: "fail", detail: "No agent wallet is named, so there is nothing to count.", href: null });
      } else {
        const sent = await deps.sentCount(wallet).catch(() => null);
        checks.push({
          id: "executes",
          title: `${MIN_ACTIONS} on-chain actions, on 3 days`,
          status: sent === null ? "check" : sent < MIN_ACTIONS ? "fail" : "check",
          detail:
            sent === null
              ? "Could not read the agent wallet just now."
              : sent < MIN_ACTIONS
                ? `The agent wallet has sent ${sent} transactions. It needs at least ${MIN_ACTIONS}, on 3 different days.`
                : `The agent wallet has sent ${sent} transactions. Check on BscScan that they fall on at least 3 different days; this page cannot see dates. A smart-contract wallet may not show its actions in this count.`,
          href: addr(wallet),
        });
      }

      // 6. Does what it says: only a reader can judge that.
      checks.push({
        id: "matches",
        title: "Actions match its category",
        status: "check",
        detail: `Declared here as ${listing?.category ?? agent.classification?.category ?? "no category"}. A yield agent should touch lending or vault contracts, a grid agent trade repeatedly, a rebalancer adjust positions, a health-factor agent act on loans.`,
        href: wallet ? addr(wallet) : null,
      });

      return {
        agentId: id,
        name: agent.name,
        checkedAt: new Date().toISOString(),
        checks,
        passed: checks.filter((c) => c.status === "pass").length,
        complete: !loading,
        note: "A checklist from public data, not BNB Chain's decision. BNB also requires the agent to be listed after its Phase 2 announcement on X, not a cosmetic copy of another agent, and owned by your registered campaign wallet.",
      };
    },
  };
}

export type Readiness = ReturnType<typeof createReadiness>;
