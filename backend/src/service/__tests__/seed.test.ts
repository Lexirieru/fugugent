/**
 * Seed terkurasi — **tingkat keempat**, jaring terakhir sebelum marketplace kosong.
 *
 * Yang dikunci di sini bukan "ada isinya", melainkan **kejujurannya**: setiap
 * agent di seed harus benar-benar ada (wallet Altana-nya bisa dicek di
 * `ai/<agent>/app/agent/studio.toml` dan di Keystore on-chain), harus mengaku
 * `source: "seed"`, dan tidak boleh mengklaim apa pun yang belum terjadi —
 * tidak ada listing `FuguRegistry` palsu, tidak ada reputasi karangan.
 */
import { describe, expect, it } from "vitest";
import { classify } from "../../classify.js";
import { CATEGORIES, type Category } from "../../types.js";
import {
  CURATED_SEED_AT,
  createSeedSource,
  seedAgents,
} from "../seed.js";

const NOW = new Date("2026-09-10T00:00:00.000Z");

describe("seed terkurasi", () => {
  it("berisi empat agent Fugugent kita sendiri, satu per kategori", () => {
    const items = seedAgents(NOW);
    expect(items).toHaveLength(4);

    const byCategory = new Map<Category, string>();
    for (const agent of items) {
      const category = agent.classification?.category;
      expect(category).not.toBeNull();
      byCategory.set(category as Category, agent.name);
    }
    expect([...byCategory.keys()].sort()).toEqual([...CATEGORIES].sort());
    expect([...byCategory.values()].sort()).toEqual(
      ["FuguGrid", "FuguGuardian", "FuguRebalancer", "FuguYield"].sort(),
    );
  });

  it("memakai wallet Altana sungguhan dari studio.toml tiap agent", () => {
    const wallets = seedAgents(NOW).map((a) => a.agentWallet);
    expect(wallets.sort()).toEqual(
      [
        "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866",
        "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
        "0xb8f155D1278f0437b9De7c63911f2C0EDa485941",
        "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0",
      ].sort(),
    );
  });

  it("setiap record mengaku source seed dan berumur sejak tanggal kurasi", () => {
    const items = seedAgents(NOW);
    for (const agent of items) {
      expect(agent.source).toBe("seed");
      expect(agent.fetchedAt).toBe(CURATED_SEED_AT);
    }
    // Dua hari setelah tanggal kurasi.
    expect(Math.floor((NOW.getTime() - Date.parse(CURATED_SEED_AT)) / 1000)).toBe(172_800);
  });

  it("tidak mengklaim apa pun yang belum terjadi", () => {
    for (const agent of seedAgents(NOW)) {
      // Belum ada listing di FuguRegistry, belum ada agentId ERC-8004 —
      // mengarangnya akan membuat UI menampilkan harga yang tidak bisa dibayar.
      expect(agent.fuguListing).toBeNull();
      expect(agent.agentId).toBeNull();
      expect(agent.registryAddress).toBeNull();
      expect(agent.isVerified).toBe(false);
      expect(agent.isEndpointVerified).toBe(false);
      expect(agent.reputation.totalScore).toBeNull();
      expect(agent.reputation.totalFeedbacks).toBe(0);
      expect(agent.reputation.starCount).toBe(0);
      // tokenId-nya sengaja TIDAK berbentuk desimal: ia bukan token ERC-8004,
      // dan tidak boleh bisa disalahartikan sebagai satu.
      expect(agent.tokenId).toMatch(/^seed-/);
      expect(agent.id).toBe(`97:${agent.tokenId}`);
    }
  });

  it("deskripsinya cukup deskriptif sehingga classifier setuju dengan kategorinya", () => {
    // Ini yang menahan seed jadi teks pemasaran kosong: kalau deskripsi seed
    // tidak lagi menjelaskan apa yang agent lakukan, classifier akan
    // berselisih dengan kategori kurasi dan test ini merah.
    for (const agent of seedAgents(NOW)) {
      const verdict = classify({ ...agent, classification: null });
      expect(verdict.category).toBe(agent.classification?.category);
      expect(verdict.confidence).toBeGreaterThanOrEqual(0.55);
    }
  });

  it("createSeedSource menyaring per kategori dan memberi halaman", async () => {
    const seed = createSeedSource({ now: () => NOW });

    const grid = await seed.listAgents("GRID", { limit: 10, offset: 0 });
    expect(grid.source).toBe("seed");
    expect(grid.healthy).toBe(true);
    expect(grid.items).toHaveLength(1);
    expect(grid.items[0]!.name).toBe("FuguGrid");
    expect(grid.total).toBe(1);

    const empty = await seed.listAgents("GRID", { limit: 10, offset: 5 });
    expect(empty.items).toHaveLength(0);
    expect(empty.total).toBe(1);
  });

  it("createSeedSource mencari satu agent per id", async () => {
    const seed = createSeedSource({ now: () => NOW });
    const hit = await seed.getAgent("97:seed-fuguguardian");
    expect(hit.agent?.name).toBe("FuguGuardian");
    expect(hit.source).toBe("seed");
    expect(hit.healthy).toBe(true);

    const miss = await seed.getAgent("97:404");
    expect(miss.agent).toBeNull();
    expect(miss.healthy).toBe(true);
    expect(miss.reason).toContain("tidak ada di seed");
  });

  it("mengembalikan salinan — pemanggil tidak bisa merusak seed untuk pemanggil lain", () => {
    const first = seedAgents(NOW);
    first[0]!.name = "dirusak";
    first[0]!.tags.push("dirusak");
    const second = seedAgents(NOW);
    expect(second[0]!.name).not.toBe("dirusak");
    expect(second[0]!.tags).not.toContain("dirusak");
  });
});
