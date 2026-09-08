/**
 * Classifier empat kategori marketplace Fugugent (Task 4).
 *
 * Menempatkan sebuah `AgentRecord` ke `REBALANCING` · `GRID` · `YIELD` ·
 * `HEALTH_FACTOR`, atau **menolak mengategorikan** (`category: null`).
 *
 * ## Sifat modul ini
 *
 * **Murni.** Tanpa network, tanpa `Date.now()`, tanpa `process.env`, tanpa
 * randomness, tanpa mutasi masukan. Keluarannya hanya fungsi dari isi record.
 * Itu bukan kerapian kosmetik: klasifikasi menentukan di kategori mana sebuah
 * agent muncul di marketplace, jadi ia harus bisa di-backtest atas snapshot
 * lama dan diperiksa dengan mata — bukan dijelaskan dengan "ya begitulah".
 *
 * **Tidak ada LLM di sini.** Sesuai aturan proyek, keputusan yang mengubah apa
 * yang dilihat pengguna adalah kode deterministik.
 *
 * ## Dua lapis
 *
 * 1. **Kata kunci** pada `name`, `description`, `tags`/`categories`/`agentType`.
 *    Ini yang benar-benar memilih kategori.
 * 2. **OASF** (`skills`/`domains`) — hanya **pengali**, tidak pernah pemilih.
 *
 * Kenapa lapis kedua dibatasi jadi pengali? Karena kosakata OASF diperiksa live
 * (8 Sep 2026, `GET /api/v1/stats/oasf/{skills,domains}`) dan **tidak memuat
 * satu pun istilah yang membedakan keempat kategori kita**. Yang ada hanya
 * taksonomi lebar seperti `finance/markets/crypto`, `technology/blockchain/defi`,
 * `trust_and_safety/risk_management`, `analytical_skills/market_insights` —
 * dan, di sisi lain, `agriculture/crop_management` serta
 * `healthcare/medical_technology`. Tidak ada `grid_trading`, tidak ada
 * `yield_farming`, tidak ada `rebalancing`. Maka OASF hanya sanggup menjawab
 * "apakah ini benar agent DeFi?", bukan "DeFi yang mana?". Memaksanya memilih
 * kategori akan jadi ketepatan palsu.
 *
 * Lebih jauh: `oasf_skills`/`oasf_domains` **tidak ada** pada `GET /agents`
 * maupun `GET /agents/{chain_id}/{token_id}`; di OpenAPI 8004scan keduanya
 * hanya muncul pada skema `MCPAgentDetail`, bertipe `string[] | null`. Jadi
 * pada jalur data utama kita array itu kosong. Karena itu **OASF kosong wajib
 * netral** (pengali 1.0) — bukan penalti. Diuji eksplisit di
 * `classify.test.ts` ("OASF kosong tidak mengubah apa pun").
 *
 * ## Kenapa tidak sekadar "kata kunci → kategori"
 *
 * Karena kata kuncinya sendiri berbohong. Tiga jebakan nyata yang ditemukan
 * pada data produksi 8004scan dan yang membentuk seluruh pembobotan di bawah:
 *
 * - **`grid`** — agent `Grid-hub` di 8004scan adalah layanan pembayaran x402;
 *   namanya saja yang "Grid". Ditambah "CSS grid", "energy grid", "data grid".
 *   Maka `grid` telanjang **lemah**; yang menentukan adalah `grid` yang
 *   bersanding dengan kata kerja perdagangan (`grid trading`, `grid orders`,
 *   `grid levels`, `grid market making`).
 * - **`yield`** — "crop yield" (pertanian) dan "bond yield curve" (makro)
 *   memakai kata yang sama persis. Maka `yield` telanjang **lemah**;
 *   `yield farming` / `yield optimizer` / `auto-compound` / `APY` yang kuat.
 * - **`rebalance`** — agent YIELD sungguhan (`smart-money-yield-agent`) menulis
 *   "Rebalances daily" di deskripsinya. Kalau `rebalance` telanjang bernilai
 *   tinggi, agent yield itu akan mendarat di kategori REBALANCING. Maka
 *   `rebalanc` telanjang **lemah**; `portfolio rebalancing`, `target allocation`,
 *   `concentrated liquidity` yang kuat.
 * - **`liquidation` vs `liquidity`** — mirip tapi berlawanan arti bagi kita.
 *   Semua pola memakai akar `liquidat`, yang **tidak pernah** cocok dengan
 *   "liquidity". Ini alasan tidak ada satu pun pola memakai akar `liquid`.
 * - **`compound`** — "auto-compounding" itu YIELD, "Compound protocol" itu
 *   lending. Karena itu `compound` telanjang **tidak dipakai sama sekali**;
 *   hanya `auto-compound` / `compounding rewards`.
 * - **`health`** — ada agent kesehatan medis. Tidak ada pola `health` telanjang;
 *   hanya frasa penuh `health factor`.
 *
 * ## Aritmetika kepercayaan
 *
 * Setiap pola yang cocok menyumbang `bobot × pengali_field`, dihitung **sekali**
 * per pola (pola yang cocok di beberapa field mengambil pengali terbesar, bukan
 * dijumlah — kalau tidak, mengulang kata di judul dan deskripsi akan menaikkan
 * skor secara artifisial). Dari skor mentah tiap kategori:
 *
 * ```
 * kekuatan  = min(tertinggi, PLAFON_BUKTI) / PLAFON_BUKTI   // seberapa banyak bukti
 * pemisahan = (tertinggi - runner_up) / tertinggi           // seberapa tak ambigu
 * keyakinan = kekuatan × (LANTAI + (1-LANTAI) × pemisahan) × pengali_OASF
 * ```
 *
 * Dua faktor itu **dikalikan**, bukan dijumlah, supaya keduanya wajib:
 * bukti banyak tapi terbelah rata antar kategori tetap ditolak, dan satu isyarat
 * lemah yang kebetulan tanpa saingan juga tetap ditolak. Persis itulah yang
 * diminta: **lebih baik tidak mengategorikan daripada salah mengategorikan.**
 *
 * Semua konstanta di bawah punya alasan dan akibat yang ditulis di tempatnya.
 * Angka ajaib tanpa penjelasan dihitung sebagai cacat di modul ini.
 */

import { CATEGORIES, type AgentClassification, type AgentRecord, type Category } from "./types.js";

// ---------------------------------------------------------------------------
// Konstanta — tiap satu disertai alasan dan akibat bila salah
// ---------------------------------------------------------------------------

/**
 * Bobot per tingkat keyakinan sebuah pola.
 *
 * - `DECISIVE` (1.0) — frasa yang dalam deskripsi agent praktis tidak punya arti
 *   lain. `health factor`, `grid trading`, `portfolio rebalancing`, `yield farming`.
 *   Satu saja sudah cukup mengategorikan (lihat `MIN_CONFIDENCE`).
 * - `STRONG` (0.6) — mengarah kuat tapi bisa dipinjam kategori lain.
 *   `liquidation`, `APY`, `collateral`, `rebalancer`. **Sengaja dibuat agar satu
 *   isyarat sedang saja TIDAK cukup**: 0.6/1.6 × 1.0 = 0.375 < 0.55.
 * - `WEAK` (0.25) — hanya pendukung. `venus`, `vault`, `grid` telanjang.
 *   Bahkan tiga isyarat lemah sekaligus (0.75 → 0.469) masih di bawah ambang;
 *   butuh empat, dan empat isyarat lemah yang searah memang sudah pantas.
 *
 * Bila `STRONG` dinaikkan ke 0.9, satu kata "liquidation" akan mengirim agent
 * analitik LP apa pun ke HEALTH_FACTOR. Bila `WEAK` dinaikkan ke 0.4, `Grid-hub`
 * (layanan pembayaran) akan masuk kategori GRID.
 */
const WEIGHT = { decisive: 1.0, strong: 0.6, weak: 0.25 } as const;

type Tier = keyof typeof WEIGHT;

/**
 * Pengali per field. Nama agent lebih padat sinyal daripada deskripsi — penulis
 * menamai agent menurut fungsinya, dan nama tidak punya ruang untuk basa-basi.
 * Label upstream (`tags`/`categories`/`agentType`) adalah data terkurasi, lebih
 * presisi daripada prosa bebas, tapi di bawah nama karena isinya sering generik
 * (`defi`, `trading`) dan kosakatanya tidak kita kendalikan.
 *
 * Bila `name` dinaikkan ke 2.0, satu kata di judul bisa mengalahkan seluruh isi
 * deskripsi — `Grid-hub` kembali jadi masalah.
 */
const FIELD_WEIGHT = { name: 1.3, description: 1.0, label: 1.2 } as const;

type Field = keyof typeof FIELD_WEIGHT;

/**
 * Skor mentah yang dianggap "bukti penuh". Di atas ini, tambahan bukti tidak lagi
 * menaikkan `kekuatan` — deskripsi panjang tidak boleh otomatis lebih meyakinkan
 * daripada deskripsi pendek yang tepat.
 *
 * Nilainya 1.6 = satu isyarat menentukan (1.0) + satu isyarat sedang (0.6).
 * Konsekuensi langsung yang dipakai untuk mengunci `MIN_CONFIDENCE`:
 * satu isyarat menentukan sendirian memberi kekuatan 1.0/1.6 = 0.625.
 */
const EVIDENCE_CAP = 1.6;

/**
 * Lantai faktor pemisahan. Kategori yang menang telak (`pemisahan` = 1) memakai
 * faktor penuh 1.0; yang menang tipis tetap dapat `LANTAI` supaya bukti kuat
 * tidak dihapus habis oleh saingan kecil.
 *
 * 0.35 dipilih dari satu perilaku yang diinginkan: agent yang mengaku melakukan
 * keempat hal sekaligus ("grid trading + yield farming + portfolio rebalancing +
 * health factor" — kasus nyata di marketplace mana pun) harus jatuh ke `null`.
 * Dengan 0.35 kasus itu berakhir di 0.43 (< 0.55, ditolak); dengan lantai 0.6 ia
 * berakhir di 0.63 dan akan **ditebak** sebagai YIELD hanya karena kata "vault"
 * kebetulan ikut muncul. Menebak di situ persis yang merusak kepercayaan.
 */
const SEPARATION_FLOOR = 0.35;

/**
 * Ambang penerimaan. **Ini konstanta terpenting di berkas ini.**
 *
 * Ia tidak dipilih dari selera, melainkan didefinisikan oleh perilaku: harus
 * berada **di atas** plafon "satu isyarat sedang" (0.375) dan plafon "dua
 * kategori bertarung imbang" (0.375), tetapi **di bawah** "satu isyarat
 * menentukan tanpa saingan" (0.625). Rentang yang memenuhi itu adalah
 * (0.375, 0.625); 0.55 diambil di sisi konservatifnya.
 *
 * Terjemahan ke bahasa manusia: **tiket masuk minimum adalah tepat satu frasa
 * yang tak bisa berarti lain.**
 *
 * Bila diturunkan ke 0.40, agent dengan satu kata "liquidation" akan muncul di
 * kategori Health Factor — pengguna melihat agent yang salah tempat. Bila
 * dinaikkan ke 0.70, "Automated portfolio rebalancing" (deskripsi lengkap satu
 * agent nyata di 8004scan, skor 0.78) masih lolos, tapi agent seperti
 * `Assay Health` (0.69) — yang jelas-jelas HEALTH_FACTOR — akan hilang dari
 * marketplace. Keduanya diuji.
 */
const MIN_CONFIDENCE = 0.55;

/**
 * Pengali saat OASF menegaskan konteks DeFi/keuangan.
 *
 * 1.15 sengaja kecil dan punya dua batas keras yang bisa diperiksa:
 * - ia **tidak bisa** menciptakan klasifikasi dari nol (0 × 1.15 = 0);
 * - ia **tidak bisa** meloloskan kasus bertarung imbang (0.43 × 1.15 = 0.49 < 0.55).
 * Yang bisa ia lakukan hanyalah menolong kasus yang sudah nyaris lolos
 * (0.50 → 0.575). Itulah peran yang jujur untuk sinyal yang, sesuai temuan live
 * di atas, tidak sanggup membedakan kategori.
 */
const OASF_DEFI_BONUS = 1.15;

/**
 * Pengali saat OASF menyatakan domain di luar keuangan (pertanian, kesehatan,
 * logistik, …) dan tidak ada satu pun domain keuangan/blockchain.
 *
 * 0.5 dipilih agar cukup untuk **membatalkan satu isyarat menentukan**
 * (0.625 × 0.5 = 0.31 < 0.55). Itu memang yang diinginkan: agent yang mendaftarkan
 * dirinya di `agriculture/crop_management` dan menulis "yield" sedang bicara
 * hasil panen, bukan imbal hasil DeFi — seberapa pun meyakinkan kata kuncinya.
 * Bila dilonggarkan ke 0.8, agent panen itu lolos ke kategori Yield.
 */
const OASF_OFF_DOMAIN_PENALTY = 0.5;

// ---------------------------------------------------------------------------
// Tabel pola
// ---------------------------------------------------------------------------

interface Rule {
  /** Label yang muncul apa adanya di `reason`, supaya keputusan bisa dibaca. */
  readonly label: string;
  readonly tier: Tier;
  readonly pattern: RegExp;
}

/** Semua pola case-insensitive; teks sudah di-lowercase sebelum diuji. */
const RULES: Readonly<Record<Category, readonly Rule[]>> = {
  /**
   * REBALANCING mencakup dua hal yang di Fugugent dianggap satu kategori:
   * rebalancing alokasi portofolio, dan rebalancing rentang posisi LP
   * terkonsentrasi (PancakeSwap v3). Keduanya "mengembalikan posisi ke target".
   */
  REBALANCING: [
    { label: "portfolio rebalancing", tier: "decisive", pattern: /\bportfolio\s+rebalanc|\brebalanc\w*\s+(?:the\s+)?portfolio\b/ },
    { label: "target allocation", tier: "decisive", pattern: /\btarget\s+(?:asset\s+)?allocations?\b|\basset\s+allocations?\b/ },
    { label: "concentrated liquidity", tier: "decisive", pattern: /\bconcentrated\s+liquidity\b/ },
    { label: "rebalance rentang/posisi LP", tier: "decisive", pattern: /\brebalanc\w*\s+(?:the\s+)?(?:lp|range|position)\b|\blp\s+range\s+rebalanc/ },
    { label: "penanda [category:rebalancing]", tier: "decisive", pattern: /\[\s*category:\s*rebalanc[a-z-]*\s*\]/ },
    { label: "rebalancer", tier: "strong", pattern: /\brebalancers?\b/ },
    // "drift" di deskripsi agent DeFi hampir selalu berarti simpangan alokasi.
    // Batas kata mencegahnya cocok pada nama seperti "DriftHarbor".
    { label: "drift alokasi", tier: "strong", pattern: /\bdrifts?\b|\bdrifting\b/ },
    { label: "out of range / reposition", tier: "strong", pattern: /\bout\s+of\s+range\b|\brepositions?\b|\brepositioning\b/ },
    // Kosakata bobot alokasi. Ditambahkan setelah pemeriksaan atas 167 agent
    // 8004scan sungguhan: `Narrow Band Allocator` ("equal-weight allocation …
    // tops up the under-weight side") tidak punya SATU PUN isyarat REBALANCING
    // tanpa aturan ini, sehingga ia kalah dari HEALTH_FACTOR — yang hanya menang
    // karena deskripsinya menyebut "health factor" di anak kalimat penjelas
    // ("… can push a borrowing account's health factor below one"). Bukan
    // HEALTH_FACTOR yang dilemahkan, melainkan REBALANCING yang dilengkapi:
    // melemahkan frasa yang benar demi satu kasus adalah cara membuat classifier
    // yang rapuh.
    { label: "bobot alokasi (equal/under/over-weight)", tier: "strong", pattern: /\bequal[\s-]?weight\w*\b|\bunder[\s-]?weight\w*\b|\bover[\s-]?weight\w*\b|\bportfolio\s+weights?\b/ },
    // Telanjang dan lemah — agent YIELD nyata pun menulis "Rebalances daily".
    { label: "rebalance (telanjang)", tier: "weak", pattern: /\brebalanc/ },
    { label: "reallocation", tier: "weak", pattern: /\breallocat/ },
    { label: "posisi LP", tier: "weak", pattern: /\blp\s+positions?\b|\bliquidity\s+positions?\b/ },
    { label: "portfolio (telanjang)", tier: "weak", pattern: /\bportfolios?\b/ },
    { label: "allocation (telanjang)", tier: "weak", pattern: /\ballocat\w*\b/ },
  ],

  /**
   * GRID adalah kategori paling rawan salah tangkap: kata "grid" jauh lebih
   * sering berarti tata letak, jaringan listrik, atau sekadar bagian dari nama
   * merek daripada strategi grid trading.
   */
  GRID: [
    // Inti kategori ini: `grid` yang bersanding dengan kata kerja perdagangan.
    { label: "grid trading/bot/order/level", tier: "decisive", pattern: /\bgrid[\s-]?(?:trad(?:e|er|es|ing)|bot|strateg|order|level|execution|plan|market[\s-]?making)/ },
    { label: "penanda [category:grid]", tier: "decisive", pattern: /\[\s*category:\s*grid[a-z-]*\s*\]/ },
    { label: "range trading/order", tier: "strong", pattern: /\brange[\s-]?(?:trad(?:e|er|es|ing)|orders?)\b/ },
    { label: "grid harga (geometric/price grid)", tier: "strong", pattern: /\b(?:geometric|price|trading|systematic)\s+grids?\b/ },
    { label: "buy low / sell high", tier: "strong", pattern: /\bbuys?\s+low\b[^.]{0,20}\bsells?\s+high\b/ },
    // Sengaja lemah. Ini yang menahan `Grid-hub` (layanan x402) dan "CSS grid".
    { label: "grid (telanjang)", tier: "weak", pattern: /\bgrid\b/ },
    { label: "price range / price band", tier: "weak", pattern: /\bprice\s+(?:range|band)\b/ },
    // Cocok hanya bila kedua sisi order hadir — sepihak saja bukan grid.
    { label: "buy order + sell order", tier: "weak", pattern: /\bbuy\s+and\s+sell\s+orders?\b|\bbuy\s+orders?\b(?=[\s\S]*\bsell\s+orders?\b)|\bsell\s+orders?\b(?=[\s\S]*\bbuy\s+orders?\b)/ },
  ],

  /**
   * YIELD: mencari imbal hasil tertinggi dan menggabungkannya. Kata "yield"
   * sendirian tidak berarti apa-apa (panen, obligasi), jadi seluruh kekuatan
   * kategori ini bertumpu pada frasa majemuk dan pada APY/APR.
   */
  YIELD: [
    { label: "yield farming", tier: "decisive", pattern: /\byield\s+farm/ },
    { label: "yield optimizer/aggregator/routing", tier: "decisive", pattern: /\byield\s+(?:optimi|aggregat|rout|strateg|generat|harvest|pulse)/ },
    // Hanya bentuk majemuk. `compound` telanjang tidak pernah dipakai:
    // ia sama saja menunjuk protokol lending Compound.
    { label: "auto-compound", tier: "decisive", pattern: /\bauto[\s-]?compound\w*\b|\bcompounding\s+(?:rewards?|yields?|returns?)\b/ },
    { label: "penanda [category:yield]", tier: "decisive", pattern: /\[\s*category:\s*yield[a-z-]*\s*\]/ },
    { label: "APY/APR", tier: "strong", pattern: /\bap[yr]s?\b/ },
    { label: "imbal hasil tertinggi", tier: "strong", pattern: /\bhighest[\s-]?(?:earning|yielding)\b|\bbest\s+(?:apy|apr|yield)\b/ },
    // `yield` yang menempel pada sumber imbal hasil sudah jauh lebih spesifik
    // daripada `yield` lepas — "crop yield" dan "bond yield" tidak berbentuk begini.
    { label: "LP/pool/lending yield", tier: "strong", pattern: /\b(?:lp|pool|lending|staking|farming)\s+yields?\b/ },
    { label: "yield (telanjang)", tier: "weak", pattern: /\byields?\b/ },
    { label: "vault", tier: "weak", pattern: /\bvaults?\b/ },
    { label: "staking", tier: "weak", pattern: /\bstaking\b|\bstakes?\b/ },
    { label: "liquidity pool / TVL", tier: "weak", pattern: /\bliquidity\s+pools?\b|\btotal\s+value\s+locked\b|\btvl\b/ },
    { label: "impermanent loss", tier: "weak", pattern: /\bimpermanent\s+loss\b/ },
  ],

  /**
   * HEALTH_FACTOR: menjaga posisi pinjam agar tidak dilikuidasi. Kategori paling
   * bersih kosakatanya — asal `liquidat` tidak pernah tertukar dengan `liquidity`,
   * dan `health` tidak pernah dipakai telanjang (ada agent kesehatan medis).
   */
  HEALTH_FACTOR: [
    { label: "health factor", tier: "decisive", pattern: /\bhealth[\s-]?factors?\b/ },
    { label: "liquidation threshold/risk/protection", tier: "decisive", pattern: /\bliquidation\s+(?:threshold|risk|price|protection|prevention)s?\b|\bavoid(?:ing)?\s+liquidation\b|\bliquidation\s+protection\b/ },
    { label: "collateral ratio / LTV", tier: "decisive", pattern: /\bcollateral(?:isation|ization)?\s+ratios?\b|\bloan[\s-]to[\s-]value\b|\bltv\b/ },
    { label: "posisi pinjam", tier: "decisive", pattern: /\bborrow(?:ing)?\s+positions?\b|\bdebt\s+positions?\b/ },
    { label: "penanda [category:health-factor]", tier: "decisive", pattern: /\[\s*category:\s*(?:health[a-z-]*|lending|liquidation)\s*\]/ },
    // Akar `liquidat`, BUKAN `liquid` — "liquidity" tidak boleh cocok.
    { label: "liquidation", tier: "strong", pattern: /\bliquidat/ },
    { label: "collateral", tier: "strong", pattern: /\bcollateral/ },
    { label: "lending/loan position", tier: "strong", pattern: /\blending\s+positions?\b|\bloan\s+positions?\b/ },
    { label: "melunasi utang", tier: "strong", pattern: /\brepay\w*\s+(?:its\s+)?(?:the\s+)?(?:debt|loan|borrow)/ },
    { label: "protokol lending (venus/aave/…)", tier: "weak", pattern: /\bvenus\b|\baave\b|\bmorpho\b|\bcomptroller\b/ },
    { label: "borrow / debt", tier: "weak", pattern: /\bborrow\w*\b|\bdebts?\b/ },
    { label: "lending / loan", tier: "weak", pattern: /\blending\b|\bloans?\b/ },
  ],
};

/**
 * Alias label upstream → kategori kita. Dicocokkan **per token utuh** pada
 * `tags`/`categories`/`agentType`, tidak sebagai substring: `tags: ["trading"]`
 * tidak boleh menyeret agent ke GRID, dan `["defi"]` tidak boleh berarti apa pun.
 * Label terkurasi adalah bukti terstruktur terkuat yang tersedia, karena itu
 * bobotnya menentukan.
 */
const LABEL_ALIASES: Readonly<Record<string, Category>> = {
  rebalancing: "REBALANCING",
  rebalance: "REBALANCING",
  "portfolio-rebalancing": "REBALANCING",
  grid: "GRID",
  "grid-trading": "GRID",
  gridtrading: "GRID",
  yield: "YIELD",
  "yield-farming": "YIELD",
  yieldfarming: "YIELD",
  "health-factor": "HEALTH_FACTOR",
  healthfactor: "HEALTH_FACTOR",
  "health_factor": "HEALTH_FACTOR",
  "liquidation-protection": "HEALTH_FACTOR",
};

/**
 * OASF menegaskan konteks keuangan/blockchain. Diambil dari kosakata yang
 * benar-benar terpakai di 8004scan: `finance/markets/crypto`,
 * `technology/blockchain/defi`, `trust_and_safety/risk_management`,
 * `analytical_skills/market_insights`, `finance_and_business/investment_services`.
 */
const OASF_DEFI = /blockchain|crypto|defi|decentralized[_\s-]?finance|finance|investment|trading|market|risk[_\s-]?management|smart[_\s-]?contract/;

/**
 * OASF menunjuk dunia lain. Hanya berlaku bila tidak ada satu pun sinyal DeFi —
 * agent lintas bidang (mis. logistik + blockchain) tidak dihukum.
 */
const OASF_OFF_DOMAIN = /agricultur|crop|farming_practice|healthcare|medical|clinical|education|transportation|logistics|manufactur|robotics|energy|utilit|gaming|entertainment|legal|hospitality/;

// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").join(" ").toLowerCase()
    : "";
}

function tokens(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== "")
    : [];
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

interface Hit {
  readonly label: string;
  readonly tier: Tier;
  readonly weight: number;
}

interface Score {
  readonly category: Category;
  readonly raw: number;
  readonly hits: readonly Hit[];
}

/** Ringkas bukti sebuah kategori jadi satu frasa yang bisa dibaca. */
function describeHits(hits: readonly Hit[]): string {
  const TIER_ID: Record<Tier, string> = { decisive: "menentukan", strong: "sedang", weak: "lemah" };
  return hits
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => `"${h.label}" (${TIER_ID[h.tier]} ${round(h.weight)})`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/**
 * Tempatkan sebuah agent di salah satu dari empat kategori, atau tolak.
 *
 * Tidak pernah melempar dan tidak pernah mengubah `agent`: record yang cacat
 * (field hilang, tipe salah dari upstream) diperlakukan sebagai field kosong,
 * karena satu record aneh tidak boleh menjatuhkan seluruh proses indexing.
 *
 * @returns `category: null` bila kepercayaan di bawah {@link MIN_CONFIDENCE}.
 *          `reason` selalu terisi — juga saat menolak, karena "kenapa agent ini
 *          tidak muncul di mana-mana?" sama perlu dijawabnya dengan "kenapa
 *          agent ini masuk Grid?".
 */
export function classify(agent: AgentRecord): AgentClassification {
  const fields: Record<Field, string> = {
    name: text(agent?.name),
    description: text(agent?.description),
    label: [listText(agent?.tags), listText(agent?.categories), text(agent?.agentType)]
      .filter((s) => s !== "")
      .join(" "),
  };

  // --- Lapis 1a: alias label upstream terkurasi -----------------------------
  const labelTokens = [...tokens(agent?.tags), ...tokens(agent?.categories)];
  const aliasHits = new Map<Category, Hit>();
  for (const token of labelTokens) {
    const category = LABEL_ALIASES[token];
    if (category !== undefined && !aliasHits.has(category)) {
      aliasHits.set(category, {
        label: `label upstream "${token}"`,
        tier: "decisive",
        weight: WEIGHT.decisive * FIELD_WEIGHT.label,
      });
    }
  }

  // --- Lapis 1b: kata kunci pada nama/deskripsi/label -----------------------
  const scores: Score[] = CATEGORIES.map((category) => {
    const hits: Hit[] = [];
    const alias = aliasHits.get(category);
    if (alias !== undefined) hits.push(alias);

    for (const rule of RULES[category]) {
      // Satu pola dihitung SEKALI, dengan pengali field terbesar tempat ia cocok.
      // Menjumlah tiap kemunculan akan membuat pengulangan kata jadi taktik skor.
      let best = 0;
      for (const field of ["name", "description", "label"] as const) {
        if (fields[field] !== "" && rule.pattern.test(fields[field])) {
          best = Math.max(best, FIELD_WEIGHT[field]);
        }
      }
      if (best > 0) hits.push({ label: rule.label, tier: rule.tier, weight: WEIGHT[rule.tier] * best });
    }

    return { category, raw: hits.reduce((sum, h) => sum + h.weight, 0), hits };
  });

  const ranked = scores.slice().sort((a, b) => b.raw - a.raw);
  const top = ranked[0]!;
  const runnerUp = ranked[1]!;

  if (top.raw === 0) {
    return {
      category: null,
      confidence: 0,
      reason:
        "tidak dikategorikan: tidak ada satu pun kata kunci kategori yang cocok pada nama, deskripsi, tag, atau kategori upstream",
    };
  }

  // `kekuatan` memakai skor yang diplafon (bukti secukupnya sudah cukup);
  // `pemisahan` memakai skor mentah, supaya dominasi yang nyata tetap terbaca
  // walau kedua kategori sama-sama sudah melewati plafon.
  const strength = Math.min(top.raw, EVIDENCE_CAP) / EVIDENCE_CAP;
  const separation = (top.raw - runnerUp.raw) / top.raw;

  // --- Lapis 2: OASF sebagai pengali, tidak pernah sebagai pemilih ----------
  const oasf = `${listText(agent?.skills)} ${listText(agent?.domains)}`.trim();
  let oasfMultiplier = 1;
  let oasfNote = "";
  if (oasf !== "") {
    if (OASF_DEFI.test(oasf)) {
      oasfMultiplier = OASF_DEFI_BONUS;
      oasfNote = `; OASF menegaskan konteks DeFi/keuangan (x${OASF_DEFI_BONUS})`;
    } else if (OASF_OFF_DOMAIN.test(oasf)) {
      oasfMultiplier = OASF_OFF_DOMAIN_PENALTY;
      oasfNote = `; OASF menunjuk domain di luar keuangan (x${OASF_OFF_DOMAIN_PENALTY})`;
    }
  }

  const confidence = round(
    Math.min(
      1,
      Math.max(
        0,
        strength * (SEPARATION_FLOOR + (1 - SEPARATION_FLOOR) * separation) * oasfMultiplier,
      ),
    ),
  );

  const rivalNote =
    runnerUp.raw > 0
      ? `pesaing terdekat ${runnerUp.category} ${round(runnerUp.raw)}`
      : "tidak ada kategori pesaing";

  if (confidence < MIN_CONFIDENCE) {
    return {
      category: null,
      confidence,
      reason:
        `tidak dikategorikan: bukti terkuat ${top.category} ${round(top.raw)} — ${describeHits(top.hits)}; ` +
        `${rivalNote}${oasfNote}; keyakinan ${confidence} di bawah ambang ${MIN_CONFIDENCE}`,
    };
  }

  return {
    category: top.category,
    confidence,
    reason:
      `${top.category}: cocok ${describeHits(top.hits)}; bukti ${round(top.raw)}/${EVIDENCE_CAP}, ` +
      `${rivalNote}${oasfNote}; keyakinan ${confidence} (ambang ${MIN_CONFIDENCE})`,
  };
}

/**
 * Konstanta ambang, diekspor supaya pemanggil (dan test) merujuk angka yang sama
 * alih-alih menyalinnya. Menyalin ambang ke tempat lain adalah cara paling umum
 * ia jadi tidak konsisten.
 */
export const CLASSIFIER_THRESHOLDS = {
  MIN_CONFIDENCE,
  EVIDENCE_CAP,
  SEPARATION_FLOOR,
  OASF_DEFI_BONUS,
  OASF_OFF_DOMAIN_PENALTY,
} as const;
