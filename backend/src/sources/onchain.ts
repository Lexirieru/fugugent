/**
 * Sumber data on-chain — **jaring pengaman marketplace**.
 *
 * Saat 8004scan tumbang (dan ia terbukti sering tumbang: `500 DATABASE_ERROR`
 * pada 4 dari 5 percobaan saat riset) dan cache Postgres masih kosong, inilah
 * yang membuat marketplace tetap punya isi. Datanya first-party: listing yang
 * benar-benar terdaftar di `FuguRegistry` milik kita sendiri, bukan salinan
 * dari pihak ketiga.
 *
 * ## Kontrak modul ini
 *
 * Sama seperti sumber 8004scan: **tidak pernah melempar**. RPC yang mati atau
 * satu `getListing` yang revert menjadi `healthy: false` / listing yang dilewati,
 * bukan exception yang menjatuhkan permintaan.
 *
 * ## Aturan
 *
 * - Alamat registry **selalu** dibaca dari `config.contracts.registry`. Tidak ada
 *   alamat yang di-hardcode di modul ini — satu sumber kebenaran ada di `config.ts`.
 * - Semua nilai uang tetap `bigint` sepanjang jalur. Tidak pernah `number`.
 * - Id listing di `FuguRegistry` **dimulai dari 1** (`listingId = ++_listingCount`);
 *   membaca id 0 selalu revert. Rentang yang dibaca karena itu `offset+1 .. offset+limit`.
 * - Klien viem disuntikkan lewat opsi — test memakai transport palsu dan tidak
 *   pernah menyentuh RPC sungguhan.
 */

import type { Chain, Client, Transport } from "viem";
import { readContract } from "viem/actions";
import type { FugugentConfig } from "../config.js";
import {
  categoryFromOnchainIndex,
  makeAgentKey,
  unhealthyPage,
  type Address,
  type AgentDetailResult,
  type AgentListPage,
  type AgentRecord,
  type Category,
  type FuguListing,
} from "../types.js";

/**
 * ABI minimal `FuguRegistry` — hanya bagian baca yang dipakai backend.
 * Diturunkan dari `contracts/src/interfaces/IFuguRegistry.sol` dan
 * `contracts/src/types/FuguTypes.sol`. Urutan field tuple **wajib** sama persis
 * dengan struct `Listing` di Solidity.
 */
export const FUGU_REGISTRY_ABI = [
  {
    type: "function",
    name: "listingCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "erc8004AgentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "agentWallet", type: "address" },
          { name: "category", type: "uint8" },
          { name: "priceUsd8PerPeriod", type: "uint128" },
          { name: "periodSeconds", type: "uint32" },
          { name: "active", type: "bool" },
          { name: "curated", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "countByCategory",
    stateMutability: "view",
    inputs: [{ name: "category", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "listingByAgentId",
    stateMutability: "view",
    inputs: [{ name: "erc8004AgentId", type: "uint256" }],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
] as const;

/** Klien viem apa pun yang bisa melakukan `eth_call`. Disuntikkan, tidak dibuat di sini. */
export type RegistryClient = Client<Transport, Chain | undefined>;

/** Bentuk mentah struct `Listing` yang dikembalikan `getListing`. */
interface RawListingTuple {
  erc8004AgentId: bigint;
  owner: Address;
  agentWallet: Address;
  category: number;
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

/** Bacaan on-chain default: ambil banyak sekaligus — ini jaring pengaman, bukan halaman UI. */
export const ONCHAIN_DEFAULT_LIMIT = 100;
/** Batas keras supaya satu permintaan tidak pernah membanjiri RPC. */
export const ONCHAIN_MAX_LIMIT = 500;
/** Jumlah `eth_call` yang berjalan bersamaan. RPC publik BSC testnet gampang tersedak. */
export const ONCHAIN_BATCH_SIZE = 10;

export interface ReadFuguListingsOptions {
  limit?: number;
  offset?: number;
}

export interface OnchainSource {
  readFuguListings(opts?: ReadFuguListingsOptions): Promise<AgentListPage>;
  readFuguListing(listingId: bigint | number): Promise<AgentDetailResult>;
}

export interface OnchainSourceOptions {
  client: RegistryClient;
  config: FugugentConfig;
  /** Disuntikkan supaya `fetchedAt` deterministik di test. */
  now?: () => Date;
  batchSize?: number;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    // Pesan viem bisa sangat panjang (berisi seluruh detail request); potong.
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return `${err.name}: ${firstLine}`;
  }
  return "kegagalan tak dikenal saat membaca on-chain";
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Ubah satu `Listing` on-chain menjadi `AgentRecord`.
 *
 * Kategori on-chain adalah kebenaran yang sudah ditandatangani pemilik listing —
 * karena itu langsung dipakai sebagai `classification` dengan kepercayaan penuh,
 * dan classifier (Task 4) tidak perlu menebak untuk listing yang punya ini.
 */
function toAgentRecord(
  listingId: bigint,
  listing: RawListingTuple,
  category: Category,
  chainId: number,
  registryAddress: Address,
  fetchedAt: string,
): AgentRecord {
  const tokenId = listing.erc8004AgentId.toString();

  const fuguListing: FuguListing = {
    listingId,
    erc8004AgentId: listing.erc8004AgentId,
    owner: listing.owner,
    agentWallet: listing.agentWallet,
    category,
    priceUsd8PerPeriod: listing.priceUsd8PerPeriod,
    periodSeconds: listing.periodSeconds,
    active: listing.active,
    curated: listing.curated,
    metadataURI: listing.metadataURI,
  };

  return {
    id: makeAgentKey(chainId, tokenId),
    chainId,
    tokenId,
    registryAddress,
    agentId: null,

    // Nama dan deskripsi hidup di `metadataURI` (IPFS/HTTPS), yang sengaja
    // TIDAK diambil di sini — jaring pengaman harus bekerja tanpa jaringan
    // tambahan yang bisa ikut tumbang. Task 5 boleh memperkayanya dari cache.
    name: `Agent #${tokenId}`,
    description: "",
    imageUrl: null,
    agentType: null,
    tags: [],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: [],

    ownerAddress: listing.owner,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: listing.agentWallet,

    isActive: listing.active,
    // `curated` diberikan kurator terpercaya lewat `setCurated`, dan kurator
    // tidak boleh mengkurasi listing miliknya sendiri — itu sinyal verifikasi
    // terkuat yang kita punya tanpa memanggil apa pun di luar rantai.
    isVerified: listing.curated,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },

    classification: {
      category,
      confidence: 1,
      reason: "kategori on-chain dari FuguRegistry",
    },
    fuguListing,

    source: "onchain",
    fetchedAt,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
  };
}

export function createOnchainSource(options: OnchainSourceOptions): OnchainSource {
  const { client, config } = options;
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? ONCHAIN_BATCH_SIZE;
  const registryAddress = config.contracts.registry as Address;
  const chainId = config.chainId;

  async function readListing(listingId: bigint): Promise<RawListingTuple> {
    const result = await readContract(client, {
      address: registryAddress,
      abi: FUGU_REGISTRY_ABI,
      functionName: "getListing",
      args: [listingId],
    });
    return result as unknown as RawListingTuple;
  }

  return {
    async readFuguListings(opts: ReadFuguListingsOptions = {}): Promise<AgentListPage> {
      const fetchedAt = now().toISOString();
      const limit = Math.min(
        Math.max(Math.trunc(opts.limit ?? ONCHAIN_DEFAULT_LIMIT), 1),
        ONCHAIN_MAX_LIMIT,
      );
      const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);

      let count: bigint;
      try {
        count = (await readContract(client, {
          address: registryAddress,
          abi: FUGU_REGISTRY_ABI,
          functionName: "listingCount",
        })) as bigint;
      } catch (err) {
        return unhealthyPage("onchain", describeFailure(err), fetchedAt, limit, offset);
      }

      const total = Number(count);
      const base = {
        total,
        limit,
        offset,
        source: "onchain" as const,
        fetchedAt,
      };

      // Id listing dimulai dari 1 — `getListing(0)` selalu revert.
      const ids: bigint[] = [];
      for (let i = offset + 1; i <= Math.min(offset + limit, total); i++) {
        ids.push(BigInt(i));
      }

      const items: AgentRecord[] = [];
      let skipped = 0;

      for (const group of chunk(ids, batchSize)) {
        const settled = await Promise.allSettled(group.map((id) => readListing(id)));
        settled.forEach((result, index) => {
          if (result.status !== "fulfilled") {
            // Satu listing yang revert (mis. dihapus di versi kontrak berikutnya)
            // tidak boleh menjatuhkan seluruh halaman.
            skipped++;
            return;
          }
          const category = categoryFromOnchainIndex(result.value.category);
          if (category === null) {
            // Enum on-chain di luar 0–3: kontrak lebih baru dari backend ini.
            // Lewati daripada menampilkan kategori yang salah.
            skipped++;
            return;
          }
          items.push(
            toAgentRecord(
              group[index]!,
              result.value,
              category,
              chainId,
              registryAddress,
              fetchedAt,
            ),
          );
        });
      }

      return {
        ...base,
        items,
        healthy: true,
        reason: skipped > 0 ? `${skipped} listing dilewati karena gagal dibaca` : null,
      };
    },

    async readFuguListing(listingId: bigint | number): Promise<AgentDetailResult> {
      const fetchedAt = now().toISOString();
      const id = BigInt(listingId);
      const base = { source: "onchain" as const, fetchedAt };

      try {
        const listing = await readListing(id);
        const category = categoryFromOnchainIndex(listing.category);
        if (category === null) {
          return {
            ...base,
            agent: null,
            healthy: false,
            reason: `kategori on-chain tak dikenal: ${listing.category}`,
          };
        }
        return {
          ...base,
          agent: toAgentRecord(id, listing, category, chainId, registryAddress, fetchedAt),
          healthy: true,
          reason: null,
        };
      } catch (err) {
        return { ...base, agent: null, healthy: false, reason: describeFailure(err) };
      }
    },
  };
}
