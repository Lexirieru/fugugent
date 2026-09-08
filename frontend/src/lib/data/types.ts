/**
 * The contract for the marketplace data layer.
 *
 * The backend does not exist yet. So that swapping it in later does not mean rewriting
 * the UI, every page talks only to `MarketplaceSource` — one interface, two
 * implementations (`seed` today, `http` as soon as `api.fugugent.xyz` answers). Not one
 * component may call `fetch` itself.
 *
 * Two properties copied straight from `backend/src/types.ts` that must not be lost:
 *
 * 1. **It never throws to the caller.** Failure is represented by `healthy: false`
 *    + `reason`, not by an exception. A page that failed must still have a shape.
 * 2. **Every page knows where it came from (`source`) and when it was fetched
 *    (`fetchedAt`).** That is what lets the "this is sample data" banner appear
 *    automatically rather than depending on a human to remember it.
 */

import type { AgentRecord, Category, SourceHealth } from "@/lib/agent-types";
import type { Proof } from "@/lib/chain";
import type { Provenance } from "@/lib/provenance";
import type { RiskReading } from "@/lib/risk";

/**
 * An agent's session key permissions, read from the on-chain Keystore.
 * Shown to a **prospective buyer before hiring** (spec §7.3, lesson 34) — not only to
 * the publisher.
 */
export interface SessionPermission {
  /** The Altana Keystore contract, where anyone can read whether the key is valid. */
  keystore: string;
  /** The wallet the key is valid on. */
  wallet: string;
  keyHash: string;
  /** The explicit allowlist. In Altana, `calls: []` means UNLIMITED permission. */
  calls: Array<{ contract: string; address: string | null; signature: string }>;
  dailyCap: string;
  expiry: string;
  grantTxHash: string | null;
  /** A command that can be copied verbatim. No API key. */
  verifyCommand: string;
}

/**
 * What a page sees about one agent.
 *
 * `record` is `AgentRecord` exactly as the backend locked it. The rest are the pieces
 * that are **not** in that shape yet — risk, session permissions, proof — and they are
 * kept separate on purpose, so that adding them in the backend later changes not one
 * type that is already final.
 */
export interface AgentView {
  record: AgentRecord;
  /** `null` = no fresh reading. The fugu is drawn hollow rather than guessed. */
  risk: RiskReading | null;
  session: SessionPermission | null;
  /** This agent's on-chain proof. It may be empty; it must never be filled with claims. */
  proofs: Proof[];
  /**
   * What this agent does **not** have yet, stated openly on the card and on the detail
   * page. `null` means there is nothing to subtract from its claim.
   */
  notShipped: string | null;
  /** Outcome sentences with numbers in them, past tense (lesson 2 of the HelloMinds benchmark). */
  outcomes: string[];
}

/**
 * The same envelope as `AgentListPage`; `items` becomes `agents`, and the provenance
 * fields are gathered into a single `provenance` object so that no page can show its
 * source without also showing its age.
 */
export interface MarketplacePage {
  agents: AgentView[];
  total: number;
  limit: number;
  offset: number;
  provenance: Provenance;
}

export interface AgentDetailView {
  agent: AgentView | null;
  provenance: Provenance;
}

export interface CategoryCount {
  category: Category;
  count: number;
}

export interface CategoryListResult {
  categories: CategoryCount[];
  provenance: Provenance;
}

export interface ListQuery {
  category?: Category | null;
  limit?: number;
  offset?: number;
}

export interface MarketplaceSource {
  /** `"seed"` = the sample data inside the bundle. `"http"` = a real backend. */
  readonly kind: "seed" | "http";
  /** Where this data will come from, to be shown to the user exactly as it is. */
  readonly origin: string;
  listAgents(query: ListQuery): Promise<MarketplacePage>;
  getAgent(id: string): Promise<AgentDetailView>;
  listCategories(): Promise<CategoryListResult>;
  health(): Promise<SourceHealth>;
}
