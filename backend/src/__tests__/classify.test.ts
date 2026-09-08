/**
 * Test classifier empat kategori (Task 4).
 *
 * ## Dari mana contoh-contohnya
 *
 * Hampir semua `name`/`description` di berkas ini **disalin apa adanya dari
 * 8004scan produksi** (panggilan live 8 Sep 2026, `GET /api/v1/agents`,
 * `GET /api/v1/agents/search/semantic`, `?search=…&search_type=text`, dengan
 * header `User-Agent` browser). Itu disengaja: classifier yang lulus melawan
 * kalimat karangan sendiri tidak membuktikan apa pun. Yang menentukan mutu
 * classifier ini adalah apakah ia benar pada kalimat yang benar-benar ditulis
 * pendaftar agent — termasuk kalimat yang berantakan.
 *
 * Negatif per kategori juga diambil dari agent sungguhan, dan sengaja dipilih
 * yang **paling menjebak** — bukan teks acak:
 *
 * | Kategori | Negatifnya | Kenapa menjebak |
 * |---|---|---|
 * | GRID | `Grid-hub` | namanya "Grid", tapi ia layanan pembayaran x402 |
 * | YIELD | agent panen pertanian | "yield" = hasil panen, bukan imbal hasil |
 * | REBALANCING | `smart-money-yield-agent` | tertulis "Rebalances daily", tapi ia agent YIELD |
 * | HEALTH_FACTOR | `yieldflow` | menyebut "liquidity", bukan "liquidation" |
 */

import { describe, expect, it } from "vitest";

import { classify } from "../classify.js";
import type { AgentRecord } from "../types.js";

/** Bangun `AgentRecord` minimal; hanya field masukan classifier yang penting. */
function agent(patch: Partial<AgentRecord>): AgentRecord {
  return {
    id: "56:1",
    chainId: 56,
    tokenId: "1",
    registryAddress: null,
    agentId: null,
    name: "",
    description: "",
    imageUrl: null,
    agentType: null,
    tags: [],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: [],
    ownerAddress: null,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: null,
    isActive: true,
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },
    classification: null,
    fuguListing: null,
    source: "scan8004",
    fetchedAt: "2026-09-08T00:00:00.000Z",
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// GRID
// ---------------------------------------------------------------------------

describe("classify — GRID", () => {
  it("mengenali agent grid trading eksplisit (LingoAI Grid Trading Agent, live)", () => {
    const result = classify(
      agent({
        name: "LingoAI Grid Trading Agent",
        description:
          "Automated grid trading strategy runner: plans grid levels and orders within a configured price range on PancakeSwap v3 pools (BSC). Hireable via ERC-8183 escrow, 1 U per job.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.reason).toMatch(/grid trading/i);
  });

  it("mengenali grid market making tanpa frasa 'grid trading' (Grid Agent 1 by 4LPHA, live)", () => {
    const result = classify(
      agent({
        name: "Grid Agent 1 by 4LPHA",
        description:
          "Automated grid market making that buys low and sells high as market prices move using PancakeSwap V3 on BNB Chain.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("mengenali grid dari penanda kategori eksplisit (smart-money-grid-trading-agent, live)", () => {
    const result = classify(
      agent({
        name: "smart-money-grid-trading-agent",
        description:
          "[category:grid-trading] Places and manages automated grid orders on PancakeSwap. Buys low, sells high within a configurable price band, capturing spread from sideways markets 24/7.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("mengenali grid dari geometri harga walau kata 'trading' tak muncul (PancakeSwap Grid Trader, live)", () => {
    const result = classify(
      agent({
        name: "PancakeSwap Grid Trader",
        description:
          "Runs a geometric grid over a PancakeSwap v3 pair: a band, a level count, a size per level, and a slot at each level that fills on the way down and unwinds on the way up.",
      }),
    );
    expect(result.category).toBe("GRID");
  });

  it("NEGATIF: 'Grid-hub' hanyalah nama layanan pembayaran x402, bukan grid trading (live)", () => {
    const result = classify(
      agent({
        name: "Grid-hub",
        description:
          "Grid-hub is an x402-native service at https://api.grid-hub.app, indexed from the x402 Bazaar (Coinbase's public discovery directory). It charges callers itself in USDC on Base and is paid directly at call time.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("NEGATIF: 'grid' dalam arti tata letak UI tidak boleh menjadi GRID", () => {
    const result = classify(
      agent({
        name: "Layout Assistant",
        description:
          "Generates responsive CSS grid layouts and design tokens for React components.",
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REBALANCING
// ---------------------------------------------------------------------------

describe("classify — REBALANCING", () => {
  it("mengenali rebalancer portofolio bertarget (DriftHarbor_271, live)", () => {
    const result = classify(
      agent({
        name: "DriftHarbor_271",
        description:
          "A disciplined portfolio rebalancer that watches target allocations, measures drift, and suggests precise trim/add orders to bring holdings back in line. It emphasizes clear rebalance rationale and threshold-aware adjustments.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("mengenali deskripsi sangat pendek 'Automated portfolio rebalancing' (babycaisubagent, live)", () => {
    const result = classify(
      agent({
        name: "babycaisubagent66_quickassistant6584",
        description: "Automated portfolio rebalancing",
      }),
    );
    expect(result.category).toBe("REBALANCING");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("mengenali rebalancer alokasi target (Portfolio Rebalancer, live)", () => {
    const result = classify(
      agent({
        name: "Portfolio Rebalancer",
        description:
          "Autonomous portfolio rebalancer that maintains target allocation and executes low-turnover rebalance actions on Base Sepolia",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("mengenali rebalancing rentang LP terkonsentrasi sebagai REBALANCING, bukan YIELD", () => {
    const result = classify(
      agent({
        name: "CL Range Manager",
        description:
          "Concentrated liquidity manager for PancakeSwap v3: detects when an LP position drifts out of range and repositions the range automatically.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("mengenali rebalancing bobot equal-weight tanpa kata 'portfolio rebalancing'", () => {
    const result = classify(
      agent({
        name: "Equal Weight Allocator",
        description:
          "Holds an equal-weight allocation across stablecoin markets and tops up the under-weight side as soon as one falls 100 bps of the portfolio behind its target.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("NEGATIF: agent YIELD yang kebetulan menulis 'Rebalances daily' tetap YIELD (smart-money-yield-agent, live)", () => {
    const result = classify(
      agent({
        name: "smart-money-yield-agent",
        description:
          "[category:yield] Routes deposited liquidity to the highest available APR across Aave V3, Venus, Lista Liquid Staking, and PancakeSwap pools on BSC. Rebalances daily. Returns a ranked APR comparison table with recommended action.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });
});

// ---------------------------------------------------------------------------
// YIELD
// ---------------------------------------------------------------------------

describe("classify — YIELD", () => {
  it("mengenali agent yield farming (YieldPilot, live)", () => {
    const result = classify(
      agent({
        name: "YieldPilot",
        description:
          "Automated yield farming agent that allocates capital across lending protocols and vaults for optimal APY.",
      }),
    );
    expect(result.category).toBe("YIELD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("mengenali yield optimiser berbasis APY (LingoAI Yield Optimiser, live)", () => {
    const result = classify(
      agent({
        name: "LingoAI Yield Optimiser",
        description:
          "Yield optimisation: reads Venus market rates, ranks vaults and staking pools by APY and proposes a reallocation toward the highest-earning opportunities. Hireable via ERC-8183 escrow, 1 U per job.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("mengenali agregator APY lintas protokol (yieldflow, live)", () => {
    const result = classify(
      agent({
        name: "yieldflow",
        description:
          "Advanced DeFi yield aggregation and liquidity optimization agent. Scans for the highest APY opportunities, calculates impermanent loss risks, and provides auto-compounding strategies on the Base network",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("mengenali auto-compounding staking (Staking Optimizer, live)", () => {
    const result = classify(
      agent({
        name: "Staking Optimizer",
        description:
          "Recommends staking pools, auto-compounds rewards, and monitors slashing risks.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("BIAYA RECALL YANG DISENGAJA: deskripsi yield yang terlalu tipis tetap null (Yieldlane, live)", () => {
    // "Yield agent that compares idle capital vs PancakeSwap-style LP yield."
    // Ini memang agent YIELD sungguhan, dan classifier MELEWATKANNYA (0.53 vs
    // ambang 0.55). Itu dicatat di sini sebagai perilaku yang disengaja, bukan
    // bug yang belum ketahuan: menurunkan ambang agar kalimat setipis ini lolos
    // juga akan meloloskan agent analitik mana pun yang menyebut "yield" dua kali.
    // Bila suatu hari keputusan ini dibalik, test inilah yang harus diubah —
    // secara sadar, bukan diam-diam.
    const result = classify(
      agent({
        name: "Yieldlane",
        description:
          "Yield agent that compares idle capital vs PancakeSwap-style LP yield. Listed on Fourlane marketplace. Testnet only. Not financial advice.",
      }),
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.confidence).toBeLessThan(0.55);
  });

  it("NEGATIF: 'yield' hasil panen pertanian tidak boleh menjadi YIELD", () => {
    const result = classify(
      agent({
        name: "Crop Yield Forecaster",
        description:
          "Forecasts seasonal crop yield for smallholder farms from rainfall, soil moisture, and satellite imagery.",
        domains: ["agriculture/crop_management", "agriculture/agriculture"],
      }),
    );
    expect(result.category).toBeNull();
  });

  it("NEGATIF: 'bond yield' pasar tradisional tidak boleh menjadi YIELD", () => {
    const result = classify(
      agent({
        name: "Macro Desk",
        description:
          "Tracks the US Treasury bond yield curve and publishes a daily macro commentary for global markets.",
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HEALTH_FACTOR
// ---------------------------------------------------------------------------

describe("classify — HEALTH_FACTOR", () => {
  it("mengenali monitor health factor Venus (Venus Health Factor Monitor, live)", () => {
    const result = classify(
      agent({
        name: "Venus Health Factor Monitor",
        description:
          "Reads any wallet's Venus Protocol lending position and returns its health factor, collateral, borrowings, per-market liquidation thresholds, and a plain-language risk recommendation.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("mengenali proteksi likuidasi (bnb-lending-guardian.agent, live)", () => {
    const result = classify(
      agent({
        name: "bnb-lending-guardian.agent",
        description:
          "Liquidation protection for Venus on BNB Chain. Reads a full lending position across Venus Core and all 8 isolated pools, computes the true health factor from liquidation thresholds, and stress-tests it against -5% to -20% collateral drops.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("mengenali agent pelunasan utang tanpa frasa 'health factor' penuh di nama (Lending Agent 4 by 4LPHA, live)", () => {
    const result = classify(
      agent({
        name: "Lending Agent 4 by 4LPHA",
        description:
          "Watches a Venus Core borrow position and repays its debt from a reserve when the health factor falls, on BNB Chain.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("mengenali kedekatan likuidasi tanpa frasa 'health factor' sama sekali (Assay Health, live)", () => {
    const result = classify(
      agent({
        name: "Assay Health",
        description:
          "Reports how close a Venus borrower is to liquidation, reading the account's live liquidity and shortfall from the Comptroller.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("NEGATIF: 'liquidity' bukan 'liquidation' — agent LP tidak boleh menjadi HEALTH_FACTOR", () => {
    const result = classify(
      agent({
        name: "Liquidity Scout",
        description:
          "Scans liquidity pools and reports total value locked, liquidity depth, and slippage for any BSC pair.",
      }),
    );
    expect(result.category).not.toBe("HEALTH_FACTOR");
  });

  it("NEGATIF: agent kesehatan medis tidak boleh menjadi HEALTH_FACTOR", () => {
    const result = classify(
      agent({
        name: "Health Companion",
        description:
          "A personal health assistant that tracks sleep, activity, and nutrition, and flags risk factors worth discussing with a doctor.",
        domains: ["healthcare/medical_technology"],
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ambang: agent tak jelas menghasilkan null
// ---------------------------------------------------------------------------

describe("classify — ambang kepercayaan", () => {
  it("agent kosong menghasilkan null dengan confidence 0", () => {
    const result = classify(agent({}));
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("agent generik tanpa kaitan DeFi menghasilkan null (SummaryBot, live)", () => {
    const result = classify(
      agent({
        name: "SummaryBot",
        description:
          "Distill long documents, papers, meeting notes, reports into concise summaries. Perfect for research papers, legal documents, earnings calls, and technical specs.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("agent trading generik tanpa strategi spesifik menghasilkan null (Autonomous Trader Bot, live)", () => {
    const result = classify(
      agent({
        name: "Autonomous Trader Bot",
        description:
          "Performs continuous trading based on predefined parameters and market conditions.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("satu kata kunci tingkat SEDANG saja tidak cukup melewati ambang", () => {
    // "liquidation" sendirian bernilai 0.6 → keyakinan 0.375, di bawah 0.55.
    // Ini bukan kebetulan: ambang sengaja dipasang di atas plafon satu isyarat sedang.
    const result = classify(
      agent({ name: "Watcher", description: "Sends an alert on any liquidation event it sees." }),
    );
    expect(result.category).toBeNull();
  });

  it("satu kata kunci tingkat LEMAH saja jelas tidak cukup", () => {
    const result = classify(agent({ name: "Vault Watcher", description: "Watches a vault." }));
    expect(result.category).toBeNull();
  });

  it("MENOLAK MENEBAK pada kasus nyata tersulit: Narrow Band Allocator (live)", () => {
    // Agent ini sesungguhnya REBALANCING (alokasi equal-weight, mengoreksi sisi
    // under-weight). Tapi deskripsinya menyebut "health factor" — di anak kalimat
    // penjelas tentang alasan ia TIDAK menarik dana. Classifier kata kunci tidak
    // bisa membedakan penyebutan itu dari fungsi utamanya.
    //
    // Yang benar di sini bukan menebak REBALANCING (kebetulan benar) dan bukan
    // menjawab HEALTH_FACTOR (salah, dan versi awal classifier ini menjawab itu
    // dengan keyakinan 0.94 — ditemukan hanya karena keluarannya diperiksa atas
    // 167 agent 8004scan sungguhan, bukan atas test buatan sendiri). Yang benar
    // adalah `null`: dua kategori sama-sama punya bukti nyata di teks yang sama.
    const result = classify(
      agent({
        name: "Narrow Band Allocator",
        description:
          "Holds an equal-weight allocation across the Venus Core-pool stablecoin markets and corrects it as soon as a market falls 100 bps of the portfolio behind its target. Tops up the under-weight side through vToken.mint(uint256), which takes an amount and no recipient; it never withdraws, because redeemUnderlying(uint256) can push a borrowing account's health factor below one and needs a guard this authority does not carry.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("bukti kuat yang seimbang di dua kategori menghasilkan null, bukan tebakan", () => {
    const result = classify(
      agent({
        name: "Omni DeFi Suite",
        description:
          "Runs grid trading strategies and yield farming vaults side by side, with portfolio rebalancing and health factor monitoring, all in one agent.",
      }),
    );
    expect(result.category).toBeNull();
    expect(result.reason).toMatch(/pesaing|bersaing|seimbang/i);
  });
});

// ---------------------------------------------------------------------------
// Lapis kedua: OASF
// ---------------------------------------------------------------------------

describe("classify — lapis kedua OASF", () => {
  it("OASF kosong tidak mengubah apa pun (jalur paling umum di 8004scan)", () => {
    const base = {
      name: "Hevo Grid",
      description:
        "Grid trading strategy agent on BNB Smart Chain that analyzes market conditions and designs systematic buy-and-sell price grids",
    };
    const tanpaOasf = classify(agent(base));
    const denganOasfKosong = classify(agent({ ...base, skills: [], domains: [] }));
    expect(tanpaOasf.confidence).toBe(denganOasfKosong.confidence);
    expect(tanpaOasf.category).toBe("GRID");
  });

  it("domain OASF DeFi menaikkan kepercayaan pada kasus di ambang", () => {
    const base = {
      name: "Range Trader",
      description:
        "Places buy orders at support and sell orders at resistance within a defined price range.",
    };
    const polos = classify(agent(base));
    const denganDefi = classify(
      agent({ ...base, domains: ["technology/blockchain/defi", "finance/markets/crypto"] }),
    );
    expect(denganDefi.confidence).toBeGreaterThan(polos.confidence);
    expect(denganDefi.category).toBe("GRID");
    expect(denganDefi.reason).toMatch(/OASF/i);
  });

  it("domain OASF di luar keuangan menekan klasifikasi walau kata kuncinya cocok", () => {
    const base = {
      name: "Harvest Planner",
      description: "Yield farming schedule optimiser for rotating crops across seasons.",
    };
    const polos = classify(agent(base));
    const denganPertanian = classify(
      agent({ ...base, domains: ["agriculture/crop_management"], skills: ["agriculture/planning"] }),
    );
    expect(denganPertanian.confidence).toBeLessThan(polos.confidence);
    expect(denganPertanian.category).toBeNull();
  });

  it("OASF tidak pernah bisa mengklasifikasi sendiri tanpa kata kunci apa pun", () => {
    const result = classify(
      agent({
        name: "Nameless",
        description: "",
        domains: ["technology/blockchain/defi", "finance/markets/crypto"],
        skills: ["analytical_skills/data_analysis/crypto_analysis"],
      }),
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tags / categories upstream
// ---------------------------------------------------------------------------

describe("classify — tags dan categories upstream", () => {
  it("label kategori upstream yang cocok adalah bukti terkuat", () => {
    const result = classify(
      agent({ name: "Agent 42", description: "An agent.", categories: ["yield"] }),
    );
    expect(result.category).toBe("YIELD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("tag 'health-factor' memetakan ke HEALTH_FACTOR", () => {
    const result = classify(
      agent({ name: "Agent 43", description: "An agent.", tags: ["health-factor", "bsc"] }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("tag generik seperti 'defi' atau 'trading' tidak mengklasifikasi apa pun", () => {
    const result = classify(
      agent({ name: "Agent 44", description: "An agent.", tags: ["defi", "trading", "bnb"] }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kemurnian dan bentuk keluaran
// ---------------------------------------------------------------------------

describe("classify — kemurnian dan kontrak keluaran", () => {
  it("deterministik: masukan sama menghasilkan keluaran identik", () => {
    const a = agent({
      name: "GridPilot",
      description: "Low-cost automated grid execution on BSC Testnet using controlled parameters.",
    });
    expect(classify(a)).toEqual(classify(a));
  });

  it("tidak mengubah record masukan", () => {
    const a = agent({ name: "YieldPilot", description: "Automated yield farming agent." });
    const salinan = structuredClone(a);
    classify(a);
    expect(a).toEqual(salinan);
  });

  it("confidence selalu berada di rentang 0..1", () => {
    const contoh = [
      agent({ name: "", description: "" }),
      agent({
        name: "smart-money-grid-trading-agent",
        description:
          "[category:grid-trading] grid trading grid bot grid strategy grid orders grid levels buy low sell high",
      }),
      agent({ name: "Grid-hub", description: "x402 service." }),
    ];
    for (const c of contoh) {
      const r = classify(c);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("reason selalu terisi, baik saat mengategorikan maupun saat menolak", () => {
    expect(classify(agent({ name: "YieldPilot", description: "yield farming" })).reason).not.toBe("");
    expect(classify(agent({ name: "x", description: "y" })).reason).not.toBe("");
  });

  it("menoleransi field yang hilang tanpa melempar", () => {
    const rusak = { name: undefined, description: undefined, tags: undefined } as unknown as AgentRecord;
    expect(() => classify(rusak)).not.toThrow();
    expect(classify(rusak).category).toBeNull();
  });
});
