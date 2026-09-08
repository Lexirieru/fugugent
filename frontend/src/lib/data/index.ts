/**
 * Satu-satunya pintu ke data. Halaman memanggil `source()`, bukan `fetch`.
 *
 * Menukar data contoh dengan backend sungguhan = mengisi `NEXT_PUBLIC_API_BASE_URL`.
 * Tidak ada komponen yang perlu diubah, karena tidak ada komponen yang tahu dari
 * mana datanya datang — mereka hanya membaca `source` dan `healthy` pada amplop,
 * lalu menampilkannya apa adanya kepada pengguna.
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
