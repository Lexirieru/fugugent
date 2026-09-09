/**
 * The only door to the data. Pages call `source()`, never `fetch`.
 *
 * Swapping the sample data for a real backend = setting `NEXT_PUBLIC_API_BASE_URL`.
 * No component needs changing, because no component knows where its data came from,
 * they only read `source` and `healthy` off the envelope and show them to the user
 * exactly as they are.
 */

import { createHttpSource } from "@/lib/data/http";
import { seedSource } from "@/lib/data/seed";
import type { MarketplaceSource } from "@/lib/data/types";

export function source(): MarketplaceSource {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return base ? createHttpSource(base) : seedSource;
}

export type {
  AgentDetailView,
  AgentView,
  CategoryCount,
  MarketplacePage,
  MarketplaceSource,
  SessionPermission,
} from "@/lib/data/types";
