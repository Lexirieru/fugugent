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
  id: "registered" | "discoverable" | "live" | "hired" | "executes" | "matches" | "repo";
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
  /**
   * The README of a public GitHub repo, or `null` when there is none to read
   * (private, missing, or unreachable). Only ever called with a raw.githubusercontent.com URL.
   */
  readme(owner: string, repo: string): Promise<string | null>;
}

/** `owner/repo` from a github.com URL, or null. */
export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/** Does this README show the agent's registry ID and its chain, as BNB Chain asks? */
export function readmeShowsId(readme: string, tokenId: string): { id: boolean; chain: boolean } {
  const id = new RegExp(`(^|[^0-9])${tokenId}([^0-9]|$)`).test(readme);
  const chain = /\b(97|56)\b|bnb smart chain|bsc testnet|bsc mainnet|chain id/i.test(readme);
  return { id, chain };
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

      // 7. A public repo that shows the registry ID and chain (BNB's blog, 2026-10-01).
      const repoLink = (agent.evidence?.endpoints ?? []).map((e) => githubRepo(e.endpoint)).find((r) => r !== null) ?? null;
      if (loading) {
        checks.push({ id: "repo", title: "Public repo shows its registry ID", status: "check", detail: "The ERC-8004 registry is still being read after a restart. Try again in a minute.", href: null });
      } else if (repoLink === null) {
        checks.push({ id: "repo", title: "Public repo shows its registry ID", status: "check", detail: `BNB Chain asks for a public GitHub repo that shows registry ID ${agent.tokenId} and the chain. Its registration names no GitHub repo, so check yours by hand, or add it when you register.`, href: null });
      } else {
        const url = `https://github.com/${repoLink.owner}/${repoLink.repo}`;
        const readme = await deps.readme(repoLink.owner, repoLink.repo).catch(() => null);
        const shows = readme === null ? null : readmeShowsId(readme, agent.tokenId);
        checks.push(
          shows === null
            ? { id: "repo", title: "Public repo shows its registry ID", status: "fail", detail: `${url} has no README anyone can read. The repo must be public.`, href: url }
            : shows.id && shows.chain
              ? { id: "repo", title: "Public repo shows its registry ID", status: "pass", detail: `The README of ${url} names registry ID ${agent.tokenId} and the chain.`, href: url }
              : { id: "repo", title: "Public repo shows its registry ID", status: "fail", detail: `The README of ${url} does not show ${shows.id ? "the chain (97 for testnet, 56 for mainnet)" : `registry ID ${agent.tokenId}`}. Add it.`, href: url },
        );
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
        note: "A checklist from public data, not BNB Chain's decision. It follows the Set and Earn rules and BNB Chain's 1 Oct blog, which adds the public repo. BNB also requires the agent to be listed after its Phase 2 announcement on X, not a cosmetic copy of another agent, and owned by your registered campaign wallet.",
      };
    },
  };
}

export type Readiness = ReturnType<typeof createReadiness>;
