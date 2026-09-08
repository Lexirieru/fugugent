# Fugu Guardian — Strategi Health Factor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fugu Guardian bisa membaca posisi pinjaman nyata di BNB Chain, memutuskan kapan harus bertindak dengan logika deterministik yang teruji, dan menjelaskan keputusannya dalam bahasa manusia — tanpa LLM pernah menyentuh keputusan finansial.

**Architecture:** Tiga lapis yang dipisah tegas. **Lapis murni** (`strategy/`) berisi rumus dan keputusan sebagai fungsi tanpa I/O — bisa di-unit-test dan di-backtest. **Lapis adapter** (`strategy/chain/`) membaca on-chain dan menerjemahkan ke tipe domain. **Lapis penjelasan** (`strategy/explain.ts`) memanggil dGrid secara asinkron setelah keputusan diambil. Keputusan tidak pernah menunggu LLM.

**Tech Stack:** TypeScript, viem (sudah ada lewat SDK), vitest, dGrid lewat `@ai-sdk/openai`.

**Spec:** `docs/specs/2026-09-08-fugugent-design.md` (§5) dan `docs/research/06-agent-strategies.md` (§4)

## Global Constraints

- **Fungsi di `strategy/` harus MURNI**: tanpa network, tanpa `Date.now()`, tanpa `process.env`, tanpa membaca file. Waktu, harga, dan posisi masuk sebagai parameter. Ini yang membuatnya bisa di-backtest.
- **Semua nilai on-chain sebagai `bigint`**, tidak pernah `number`. Presisi 1e18 tidak muat di float.
- **Health factor basis 1e18.** `HF = 1.0` adalah `10n ** 18n`.
- **Aave mengembalikan `healthFactor = 2^256-1` bila user tidak punya hutang** — terverifikasi live. Perlakukan sebagai "tak terhingga", bukan angka.
- **LLM tidak pernah mengambil keputusan finansial.** `explain.ts` hanya menerima keputusan yang sudah jadi dan mengubahnya jadi kalimat.
- Alamat kontrak yang dipakai **hanya** yang sudah diverifikasi live (tercantum per task). Jangan menambah alamat baru tanpa memverifikasinya dengan `cast call`.
- Data dibaca dari **BSC mainnet (chain 56)** karena Venus dan Aave ada di sana; eksekusi transaksi tetap di testnet. Pembacaan bersifat read-only dan tidak berbiaya.
- Custom error class, bukan `throw new Error("string")` telanjang, untuk kondisi yang bisa ditangani pemanggil.
- Perintah dijalankan dari `ai/fuguguardian/app/agent/`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `src/strategy/types.ts` | Tipe domain: `Position`, `Decision`, `Action`, `Thresholds`. Tidak ada logika. |
| `src/strategy/healthFactor.ts` | Rumus murni: normalisasi HF, jarak ke likuidasi, stress test harga. |
| `src/strategy/decide.ts` | Mesin keputusan murni: posisi + ambang → aksi + alasan. |
| `src/strategy/chain/venus.ts` | Adapter read-only Venus (`getAccountLiquidity`). |
| `src/strategy/chain/aave.ts` | Adapter read-only Aave v3 (`getUserAccountData`). |
| `src/strategy/explain.ts` | Ubah `Decision` jadi kalimat lewat dGrid, asinkron, boleh gagal. |
| `src/strategy/backtest.ts` | Harness: deret harga → berapa likuidasi dicegah vs baseline manusia. |
| `src/strategy/__tests__/*.test.ts` | Unit test per modul. |
| `vitest.config.ts` | Konfigurasi test. |

---

### Task 1: Fondasi test & tipe domain

**Files:**
- Create: `vitest.config.ts`, `src/strategy/types.ts`, `src/strategy/__tests__/types.test.ts`
- Modify: `package.json` (tambah vitest + script test)

**Interfaces:**
- Produces:
  - `type Protocol = "venus" | "aave"`
  - `type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY"`
  - `interface Position { protocol: Protocol; account: `0x${string}`; collateralBase: bigint; debtBase: bigint; liquidationThresholdBps: bigint; healthFactor: bigint | null; blockNumber: bigint; }`
  - `interface Thresholds { warn: bigint; partialRepay: bigint; deleverage: bigint; }`
  - `interface Decision { action: Action; healthFactor: bigint | null; dropToLiquidationBps: bigint | null; reason: string; suggestedRepayBase: bigint; }`
  - `const HF_ONE = 10n ** 18n`
  - `const DEFAULT_THRESHOLDS: Thresholds`
  - `class PositionError extends Error`

- [ ] **Step 1: Tambah vitest**

```bash
corepack pnpm add -D vitest
```
Tambahkan ke `package.json` bagian `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Tulis `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Tulis test tipe lebih dulu**

`src/strategy/__tests__/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, HF_ONE, PositionError } from "../types.js";

describe("konstanta domain", () => {
  it("HF_ONE adalah 1e18", () => {
    expect(HF_ONE).toBe(10n ** 18n);
  });

  it("ambang default berurutan menurun dan semuanya di atas 1.0", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBeGreaterThan(DEFAULT_THRESHOLDS.partialRepay);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBeGreaterThan(DEFAULT_THRESHOLDS.deleverage);
    expect(DEFAULT_THRESHOLDS.deleverage).toBeGreaterThan(HF_ONE);
  });

  it("ambang default sesuai riset: 1.5 / 1.2 / 1.1", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBe(1_500_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBe(1_200_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.deleverage).toBe(1_100_000_000_000_000_000n);
  });

  it("PositionError membawa nama yang benar", () => {
    const e = new PositionError("uji");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PositionError");
    expect(e.message).toBe("uji");
  });
});
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `corepack pnpm test`
Expected: gagal — `../types.js` belum ada.

- [ ] **Step 5: Tulis `src/strategy/types.ts`**

```ts
/** Health factor dinyatakan dalam basis 1e18, mengikuti Aave v3. HF 1.0 = 1e18. */
export const HF_ONE = 10n ** 18n;

export type Protocol = "venus" | "aave";

/**
 * Aksi yang boleh diambil Guardian, dari paling ringan ke paling agresif.
 * Keputusan ini SELALU dihasilkan kode deterministik, tidak pernah oleh LLM.
 */
export type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY";

/**
 * Snapshot posisi pinjaman pada satu blok. Semua nilai uang dalam "base unit"
 * protokol yang bersangkutan (Aave memakai basis 8 desimal USD).
 */
export interface Position {
  protocol: Protocol;
  account: `0x${string}`;
  collateralBase: bigint;
  debtBase: bigint;
  /** Ambang likuidasi dalam basis point, mis. 8000n = 80%. */
  liquidationThresholdBps: bigint;
  /** null berarti tidak ada hutang sama sekali — bukan berbahaya, justru paling aman. */
  healthFactor: bigint | null;
  blockNumber: bigint;
}

export interface Thresholds {
  warn: bigint;
  partialRepay: bigint;
  deleverage: bigint;
}

export interface Decision {
  action: Action;
  healthFactor: bigint | null;
  /** Berapa basis point harga agunan boleh turun sebelum HF mencapai 1.0. */
  dropToLiquidationBps: bigint | null;
  reason: string;
  /** Jumlah yang disarankan dibayar agar HF kembali aman; 0n bila tidak perlu. */
  suggestedRepayBase: bigint;
}

/**
 * Ambang default dari docs/research/06 §4.2. Ini keputusan produk, bukan angka
 * baku protokol — riset kita sendiri menandainya sebagai contoh yang harus
 * dikalibrasi ulang lewat backtest untuk aset yang lebih volatil.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  warn: 1_500_000_000_000_000_000n,
  partialRepay: 1_200_000_000_000_000_000n,
  deleverage: 1_100_000_000_000_000_000n,
};

export class PositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionError";
  }
}
```

- [ ] **Step 6: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: 4 test PASS.

- [ ] **Step 7: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): fondasi test dan tipe domain strategi"
```

---

### Task 2: Rumus health factor murni

**Files:**
- Create: `src/strategy/healthFactor.ts`, `src/strategy/__tests__/healthFactor.test.ts`

**Interfaces:**
- Consumes: `Position`, `HF_ONE`, `PositionError` dari `types.js`
- Produces:
  - `function computeHealthFactor(collateralBase: bigint, debtBase: bigint, liquidationThresholdBps: bigint): bigint | null`
  - `function dropToLiquidationBps(hf: bigint | null): bigint | null`
  - `function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null`
  - `function repayToReachTarget(pos: Position, targetHf: bigint): bigint`

**Rumus yang mengikat:**
```
HF        = collateral × liquidationThresholdBps / 10000 × 1e18 / debt
dropToLiq = 10000 − (10000 × 1e18 / HF)          // basis point, 0 bila HF ≤ 1
HF setelah harga agunan turun d bps:
            HF' = HF × (10000 − d) / 10000
repay agar HF mencapai target:
            debt_target = collateral × lt / 10000 × 1e18 / target
            repay = debt − debt_target   (0 bila sudah aman)
```

- [ ] **Step 1: Tulis test lebih dulu**

`src/strategy/__tests__/healthFactor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  computeHealthFactor,
  dropToLiquidationBps,
  healthFactorAfterPriceDrop,
  repayToReachTarget,
} from "../healthFactor.js";
import { HF_ONE, type Position } from "../types.js";

const pos = (collateral: bigint, debt: bigint, ltBps = 8000n): Position => ({
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: collateral,
  debtBase: debt,
  liquidationThresholdBps: ltBps,
  healthFactor: computeHealthFactor(collateral, debt, ltBps),
  blockNumber: 1n,
});

describe("computeHealthFactor", () => {
  it("agunan 1000, hutang 500, LT 80% menghasilkan HF 1.6", () => {
    expect(computeHealthFactor(1000n, 500n, 8000n)).toBe(1_600_000_000_000_000_000n);
  });

  it("tepat di ambang likuidasi menghasilkan HF 1.0", () => {
    expect(computeHealthFactor(1000n, 800n, 8000n)).toBe(HF_ONE);
  });

  it("hutang nol berarti tidak ada risiko sama sekali, dikembalikan null", () => {
    expect(computeHealthFactor(1000n, 0n, 8000n)).toBeNull();
  });

  it("agunan nol dengan hutang berjalan menghasilkan HF nol", () => {
    expect(computeHealthFactor(0n, 100n, 8000n)).toBe(0n);
  });
});

describe("dropToLiquidationBps", () => {
  it("HF 2.0 berarti agunan boleh turun 50%", () => {
    expect(dropToLiquidationBps(2n * HF_ONE)).toBe(5000n);
  });

  it("HF 1.25 berarti agunan boleh turun 20%", () => {
    expect(dropToLiquidationBps(1_250_000_000_000_000_000n)).toBe(2000n);
  });

  it("HF tepat 1.0 berarti tidak ada ruang turun sama sekali", () => {
    expect(dropToLiquidationBps(HF_ONE)).toBe(0n);
  });

  it("HF di bawah 1.0 tetap nol, bukan negatif", () => {
    expect(dropToLiquidationBps(900_000_000_000_000_000n)).toBe(0n);
  });

  it("tanpa hutang, jarak ke likuidasi tidak terdefinisi", () => {
    expect(dropToLiquidationBps(null)).toBeNull();
  });
});

describe("healthFactorAfterPriceDrop", () => {
  it("HF 1.6 setelah agunan turun 25% menjadi 1.2", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 500n), 2500n)).toBe(1_200_000_000_000_000_000n);
  });

  it("turun sebesar jarak ke likuidasi mendaratkan HF tepat di 1.0", () => {
    const p = pos(1000n, 500n);
    const d = dropToLiquidationBps(p.healthFactor)!;
    expect(healthFactorAfterPriceDrop(p, d)).toBe(HF_ONE);
  });

  it("posisi tanpa hutang tetap aman berapa pun harga turun", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 0n), 9000n)).toBeNull();
  });
});

describe("repayToReachTarget", () => {
  it("menghitung pembayaran yang membawa HF ke target", () => {
    const p = pos(1000n, 800n); // HF 1.0
    const repay = repayToReachTarget(p, 1_600_000_000_000_000_000n);
    expect(repay).toBe(300n); // sisa hutang 500 memberi HF 1.6
  });

  it("posisi yang sudah lebih aman dari target tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 100n), 1_200_000_000_000_000_000n)).toBe(0n);
  });

  it("posisi tanpa hutang tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 0n), 2n * HF_ONE)).toBe(0n);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `corepack pnpm test`
Expected: gagal — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/strategy/healthFactor.ts` — semua fungsi murni, tanpa I/O:
```ts
import { HF_ONE, type Position } from "./types.js";

const BPS = 10_000n;

/**
 * Health factor gaya Aave v3, basis 1e18.
 * Mengembalikan null bila tidak ada hutang — itu bukan angka besar, melainkan
 * ketiadaan risiko. Aave sendiri mengembalikan 2^256-1 untuk kasus ini; kita
 * menormalkannya jadi null supaya pemanggil tidak pernah salah membandingkannya.
 */
export function computeHealthFactor(
  collateralBase: bigint,
  debtBase: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (debtBase === 0n) return null;
  return (collateralBase * liquidationThresholdBps * HF_ONE) / (BPS * debtBase);
}

/** Berapa basis point harga agunan boleh turun sebelum HF menyentuh 1.0. */
export function dropToLiquidationBps(hf: bigint | null): bigint | null {
  if (hf === null) return null;
  if (hf <= HF_ONE) return 0n;
  return BPS - (BPS * HF_ONE) / hf;
}

/** HF seandainya harga agunan turun sebesar `dropBps`. */
export function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null {
  if (pos.debtBase === 0n) return null;
  const sisa = dropBps >= BPS ? 0n : BPS - dropBps;
  return computeHealthFactor(
    (pos.collateralBase * sisa) / BPS,
    pos.debtBase,
    pos.liquidationThresholdBps,
  );
}

/** Jumlah yang harus dibayar agar HF mencapai `targetHf`; 0n bila sudah aman. */
export function repayToReachTarget(pos: Position, targetHf: bigint): bigint {
  if (pos.debtBase === 0n || targetHf === 0n) return 0n;
  const hutangTarget =
    (pos.collateralBase * pos.liquidationThresholdBps * HF_ONE) / (BPS * targetHf);
  if (hutangTarget >= pos.debtBase) return 0n;
  return pos.debtBase - hutangTarget;
}
```

- [ ] **Step 4: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: seluruh test PASS. Bila `healthFactorAfterPriceDrop` meleset satu unit karena pembulatan integer, **jangan** melonggarkan assertion — periksa urutan operasi: kalikan dulu, bagi belakangan.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): rumus health factor murni dan teruji"
```

---

### Task 3: Mesin keputusan

**Files:**
- Create: `src/strategy/decide.ts`, `src/strategy/__tests__/decide.test.ts`

**Interfaces:**
- Consumes: `healthFactor.js`, `types.js`
- Produces: `function decide(pos: Position, thresholds?: Thresholds): Decision`

**Aturan yang mengikat** (urutan pemeriksaan dari paling gawat ke paling ringan):
| Kondisi | Action | suggestedRepayBase |
|---|---|---|
| `hf === null` (tanpa hutang) | `NONE` | 0n |
| `hf <= HF_ONE` | `EMERGENCY` | repay agar HF = warn |
| `hf <= deleverage` | `DELEVERAGE` | repay agar HF = warn |
| `hf <= partialRepay` | `PARTIAL_REPAY` | repay agar HF = warn |
| `hf <= warn` | `WARN` | 0n |
| selain itu | `NONE` | 0n |

`reason` harus menyebut angka HF dan jarak ke likuidasi dalam persen, dalam bahasa Indonesia, tanpa jargon.

- [ ] **Step 1: Tulis test lebih dulu**

`src/strategy/__tests__/decide.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import { DEFAULT_THRESHOLDS, HF_ONE, type Position } from "../types.js";

// helper: bangun posisi dengan HF yang diinginkan pada LT 80%
function posWithHf(hf: bigint): Position {
  // collateral tetap 10_000; debt = collateral × lt / 10000 × 1e18 / hf
  const collateral = 10_000n;
  const debt = hf === 0n ? 0n : (collateral * 8000n * HF_ONE) / (10_000n * hf);
  return {
    protocol: "aave",
    account: "0x0000000000000000000000000000000000000001",
    collateralBase: collateral,
    debtBase: debt,
    liquidationThresholdBps: 8000n,
    healthFactor: debt === 0n ? null : hf,
    blockNumber: 1n,
  };
}

describe("decide", () => {
  it("posisi tanpa hutang tidak memerlukan aksi apa pun", () => {
    const p = posWithHf(0n);
    const d = decide(p);
    expect(d.action).toBe("NONE");
    expect(d.suggestedRepayBase).toBe(0n);
    expect(d.dropToLiquidationBps).toBeNull();
  });

  it("HF 2.0 aman, tidak ada aksi", () => {
    expect(decide(posWithHf(2n * HF_ONE)).action).toBe("NONE");
  });

  it("HF tepat di ambang peringatan memicu WARN", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).action).toBe("WARN");
  });

  it("WARN tidak menyarankan pembayaran apa pun", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).suggestedRepayBase).toBe(0n);
  });

  it("HF tepat di ambang partial repay memicu PARTIAL_REPAY", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).action).toBe("PARTIAL_REPAY");
  });

  it("PARTIAL_REPAY menyarankan pembayaran yang lebih dari nol", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).suggestedRepayBase).toBeGreaterThan(0n);
  });

  it("HF tepat di ambang deleverage memicu DELEVERAGE", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.deleverage)).action).toBe("DELEVERAGE");
  });

  it("HF tepat 1.0 sudah darurat", () => {
    expect(decide(posWithHf(HF_ONE)).action).toBe("EMERGENCY");
  });

  it("HF di bawah 1.0 tetap darurat, bukan lempar error", () => {
    expect(decide(posWithHf(900_000_000_000_000_000n)).action).toBe("EMERGENCY");
  });

  it("alasan menyebut angka health factor", () => {
    const d = decide(posWithHf(1_300_000_000_000_000_000n));
    expect(d.reason).toMatch(/1[.,]3/);
  });

  it("alasan menyebut jarak ke likuidasi dalam persen untuk posisi berisiko", () => {
    const d = decide(posWithHf(1_250_000_000_000_000_000n));
    expect(d.reason).toMatch(/20([.,]0)?\s*%/);
  });

  it("ambang khusus menggantikan ambang default", () => {
    const ketat = { warn: 3n * HF_ONE, partialRepay: 2n * HF_ONE, deleverage: 15n * HF_ONE / 10n };
    expect(decide(posWithHf(25n * HF_ONE / 10n), ketat).action).toBe("WARN");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `corepack pnpm test`

- [ ] **Step 3: Implementasi**

`src/strategy/decide.ts`. Fungsi murni; `reason` disusun dari angka, bukan dari LLM. Format HF dengan dua desimal dan jarak likuidasi dengan satu desimal, memakai pemisah desimal koma sesuai bahasa Indonesia. Urutan pemeriksaan persis seperti tabel di atas — dari paling gawat ke paling ringan, sehingga kasus batas jatuh ke tindakan yang lebih aman.

Petunjuk implementasi yang mengikat:
- `suggestedRepayBase` untuk `PARTIAL_REPAY`, `DELEVERAGE`, dan `EMERGENCY` dihitung dengan `repayToReachTarget(pos, thresholds.warn)` — target pemulihannya adalah ambang peringatan, bukan sekadar lewat dari ambang terdekat.
- `WARN` dan `NONE` selalu `0n`.
- `dropToLiquidationBps` diisi dari `dropToLiquidationBps(pos.healthFactor)`.

- [ ] **Step 4: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: seluruh test PASS.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): mesin keputusan deterministik dengan ambang bertingkat"
```

---

### Task 4: Adapter on-chain Venus & Aave

**Files:**
- Create: `src/strategy/chain/client.ts`, `src/strategy/chain/aave.ts`, `src/strategy/chain/venus.ts`, `src/strategy/__tests__/chain.test.ts`

**Interfaces:**
- Consumes: `viem`, `types.js`
- Produces:
  - `chain/client.ts`: `function createReader(rpcUrl?: string)` → `{ client, readAavePosition, readVenusLiquidity }`. Ditaruh di file sendiri karena dipakai kedua adapter.
  - `async function readAavePosition(client, account): Promise<Position>`
  - `async function readVenusLiquidity(client, account): Promise<{ liquidityBase: bigint; shortfallBase: bigint; blockNumber: bigint }>`

**Alamat yang sudah diverifikasi live (jangan diganti tanpa verifikasi ulang):**
```
BSC mainnet RPC   https://bsc-dataseed.bnbchain.org
Aave v3 Pool      0x6807dc923806fE8Fd134338EABCA509979a7e0cB
Venus Comptroller 0xfD36E2c2a6789Db23113685031d7F16329158384
```

**Fakta yang mengikat, terverifikasi live:**
- `getUserAccountData` mengembalikan enam nilai berurutan: `totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor`.
- Untuk akun tanpa hutang, `healthFactor` bernilai `2n ** 256n - 1n`. Adapter **wajib** menormalkannya menjadi `null`.
- `getAccountLiquidity` mengembalikan tiga nilai: `error, liquidity, shortfall`.

- [ ] **Step 1: Tulis test lebih dulu**

`src/strategy/__tests__/chain.test.ts`. Test ini **menyentuh jaringan sungguhan** (read-only, gratis) — beri `timeout` 30 detik per test.
```ts
import { describe, expect, it } from "vitest";
import { createReader } from "../chain/client.js";
import { readVenusLiquidity } from "../chain/venus.js";

const AKUN_KOSONG = "0x0000000000000000000000000000000000000001" as const;

describe("adapter Aave v3 (BSC mainnet, read-only)", () => {
  it("membaca posisi akun kosong tanpa melempar", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    expect(pos.protocol).toBe("aave");
    expect(pos.account).toBe(AKUN_KOSONG);
    expect(pos.blockNumber).toBeGreaterThan(0n);
  });

  it("menormalkan healthFactor tak terhingga menjadi null", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    // akun tanpa hutang: Aave mengembalikan 2^256-1
    expect(pos.debtBase).toBe(0n);
    expect(pos.healthFactor).toBeNull();
  });
});

describe("adapter Venus (BSC mainnet, read-only)", () => {
  it("membaca likuiditas akun tanpa melempar", { timeout: 30_000 }, async () => {
    const r = createReader();
    const v = await readVenusLiquidity(r.client, AKUN_KOSONG);
    expect(v.shortfallBase).toBe(0n);
    expect(v.blockNumber).toBeGreaterThan(0n);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `corepack pnpm test`

- [ ] **Step 3: Implementasi**

Di `chain/client.ts`, buat `createReader(rpcUrl = "https://bsc-dataseed.bnbchain.org")` yang membangun `publicClient` viem terhadap chain `bsc`, meng-ekspos `client` mentah, lalu mendelegasikan ke `readAavePosition` dan `readVenusLiquidity` dari kedua adapter. Adapter sendiri menerima `client` sebagai parameter sehingga tetap bisa diuji terpisah.

`readAavePosition` memanggil `getUserAccountData`, lalu:
- `healthFactor` dinormalkan: bila nilainya `2n ** 256n - 1n` **atau** `debtBase === 0n`, jadikan `null`.
- `liquidationThresholdBps` diisi dari `currentLiquidationThreshold` (Aave sudah mengembalikannya dalam basis point).
- `blockNumber` diambil dari `client.getBlockNumber()`.

`readVenusLiquidity` memanggil `getAccountLiquidity` dan mengembalikan `liquidity` serta `shortfall`. Bila nilai `error` bukan `0n`, lempar `PositionError` dengan pesan yang menyebut kode error tersebut.

Beri komentar di kepala kedua file bahwa pembacaan dilakukan di **mainnet** karena Venus dan Aave hanya ada di sana, bersifat read-only, dan tidak berbiaya.

- [ ] **Step 4: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: seluruh test PASS. Bila RPC menolak, coba `https://bsc-rpc.publicnode.com` — **jangan** memakai domain `binance.org`, terbukti diblokir dari jaringan ini.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): adapter read-only Venus dan Aave v3"
```

---

### Task 5: Lapisan penjelasan lewat dGrid

**Files:**
- Create: `src/strategy/explain.ts`, `src/strategy/__tests__/explain.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Position`, `buildModel` dari `../model.js`
- Produces: `async function explainDecision(pos: Position, decision: Decision, deps?: { generate?: GenerateFn }): Promise<string>`

**Aturan yang mengikat:**
- Fungsi ini **tidak boleh** mengubah keputusan. Ia menerima `Decision` yang sudah jadi dan hanya menghasilkan kalimat.
- Bila pemanggilan LLM gagal atau melebihi 20 detik, **kembalikan `decision.reason` apa adanya** — jangan melempar. Penjelasan yang gagal tidak boleh pernah menghentikan perlindungan posisi.
- Prompt harus memuat angka yang sudah dihitung dan melarang model mengarang angka lain.
- `deps.generate` ada supaya test bisa menyuntikkan fungsi palsu tanpa menyentuh jaringan.

- [ ] **Step 1: Tulis test lebih dulu**

`src/strategy/__tests__/explain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { explainDecision } from "../explain.js";
import { HF_ONE, type Decision, type Position } from "../types.js";

const pos: Position = {
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: 1000n,
  debtBase: 500n,
  liquidationThresholdBps: 8000n,
  healthFactor: 1_600_000_000_000_000_000n,
  blockNumber: 1n,
};

const keputusan: Decision = {
  action: "WARN",
  healthFactor: 1_600_000_000_000_000_000n,
  dropToLiquidationBps: 3750n,
  reason: "Health factor 1,60. Agunan boleh turun 37,5% sebelum likuidasi.",
  suggestedRepayBase: 0n,
};

describe("explainDecision", () => {
  it("memakai keluaran model bila pemanggilan berhasil", async () => {
    const teks = await explainDecision(pos, keputusan, {
      generate: async () => "Posisi Anda masih aman.",
    });
    expect(teks).toBe("Posisi Anda masih aman.");
  });

  it("jatuh kembali ke alasan deterministik bila model gagal", async () => {
    const teks = await explainDecision(pos, keputusan, {
      generate: async () => {
        throw new Error("dGrid mati");
      },
    });
    expect(teks).toBe(keputusan.reason);
  });

  it("jatuh kembali ke alasan deterministik bila model mengembalikan teks kosong", async () => {
    const teks = await explainDecision(pos, keputusan, { generate: async () => "   " });
    expect(teks).toBe(keputusan.reason);
  });

  it("tidak pernah mengubah keputusan yang diterimanya", async () => {
    const salinan = { ...keputusan };
    await explainDecision(pos, keputusan, { generate: async () => "apa pun" });
    expect(keputusan).toEqual(salinan);
  });

  it("prompt memuat angka health factor dan melarang mengarang", async () => {
    let promptTertangkap = "";
    await explainDecision(pos, keputusan, {
      generate: async (p) => {
        promptTertangkap = p;
        return "ok";
      },
    });
    expect(promptTertangkap).toContain("1,60");
    expect(promptTertangkap.toLowerCase()).toContain("jangan");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `corepack pnpm test`

- [ ] **Step 3: Implementasi**

`src/strategy/explain.ts`. Default `generate` memakai `generateText` dari `ai` dengan model dari `buildModel()`. Bungkus dengan `Promise.race` terhadap timeout 20 detik. Tangkap semua kegagalan dan kembalikan `decision.reason`.

Prompt harus menyebut: protokol, angka HF terformat, jarak ke likuidasi dalam persen, aksi yang diambil, dan jumlah yang disarankan dibayar bila ada — lalu menutup dengan larangan tegas mengarang angka di luar yang diberikan.

Beri komentar di kepala file yang menyatakan bahwa modul ini berada **di luar jalur kritis**: keputusan sudah diambil sebelum fungsi ini dipanggil, dan kegagalannya tidak pernah mengubah perlindungan yang berjalan.

- [ ] **Step 4: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: seluruh test PASS tanpa menyentuh jaringan (semuanya memakai `deps.generate` palsu).

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): penjelasan dGrid di luar jalur kritis, gagal dengan aman"
```

---

### Task 6: Harness backtest — membuktikan agent mengalahkan manusia

**Files:**
- Create: `src/strategy/backtest.ts`, `src/strategy/__tests__/backtest.test.ts`

**Interfaces:**
- Consumes: `healthFactor.js`, `decide.js`, `types.js`
- Produces:
  - `interface BacktestResult { candles: number; agentInterventions: number; agentLiquidations: number; humanLiquidations: number; liquidationsAvoided: number; }`
  - `function runBacktest(input: { startCollateralBase: bigint; startDebtBase: bigint; liquidationThresholdBps: bigint; priceSeriesBps: bigint[]; humanReactionCandles: number; thresholds?: Thresholds }): BacktestResult`

**Model simulasi yang mengikat:**
- `priceSeriesBps[i]` adalah harga agunan relatif terhadap harga awal, dalam basis point (`10000n` = harga awal).
- Pada tiap candle, hitung HF dari agunan yang sudah disesuaikan harga, lalu `decide`.
- **Agent** bertindak pada candle yang sama saat aksi bukan `NONE`/`WARN`: hutang dikurangi `suggestedRepayBase`.
- **Manusia** baru bertindak `humanReactionCandles` candle setelah aksi pertama kali dibutuhkan.
- Likuidasi tercatat bila HF ≤ 1.0 sebelum pihak bersangkutan sempat bertindak.
- `liquidationsAvoided = humanLiquidations − agentLiquidations`.

- [ ] **Step 1: Tulis test lebih dulu**

`src/strategy/__tests__/backtest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runBacktest } from "../backtest.js";

const dasar = {
  startCollateralBase: 10_000n,
  startDebtBase: 5_000n,
  liquidationThresholdBps: 8000n,
};

describe("runBacktest", () => {
  it("pasar tenang tidak menghasilkan intervensi maupun likuidasi", () => {
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 10_050n, 9_980n, 10_010n],
      humanReactionCandles: 3,
    });
    expect(r.agentInterventions).toBe(0);
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
    expect(r.liquidationsAvoided).toBe(0);
  });

  it("menghitung setiap candle yang diberikan", () => {
    const r = runBacktest({ ...dasar, priceSeriesBps: [10_000n, 9_000n, 8_000n], humanReactionCandles: 1 });
    expect(r.candles).toBe(3);
  });

  it("penurunan tajam melikuidasi manusia yang lambat tetapi tidak melikuidasi agent", () => {
    // agunan jatuh 45% dalam dua candle; manusia baru bereaksi lima candle kemudian
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n],
      humanReactionCandles: 5,
    });
    expect(r.agentInterventions).toBeGreaterThan(0);
    expect(r.humanLiquidations).toBeGreaterThan(r.agentLiquidations);
    expect(r.liquidationsAvoided).toBe(r.humanLiquidations - r.agentLiquidations);
  });

  it("manusia yang bereaksi secepat agent tidak tertolong lebih banyak", () => {
    const seri = [10_000n, 7_000n, 5_500n, 5_400n];
    const cepat = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: 0 });
    expect(cepat.liquidationsAvoided).toBe(0);
  });

  it("posisi tanpa hutang tidak pernah terlikuidasi seberapa pun harga jatuh", () => {
    const r = runBacktest({
      ...dasar,
      startDebtBase: 0n,
      priceSeriesBps: [10_000n, 1_000n, 100n],
      humanReactionCandles: 0,
    });
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `corepack pnpm test`

- [ ] **Step 3: Implementasi**

`src/strategy/backtest.ts`, fungsi murni tanpa I/O. Jalankan dua simulasi terpisah di atas deret harga yang sama: satu untuk agent, satu untuk manusia dengan penundaan reaksi. Catat likuidasi ketika HF menyentuh atau turun di bawah `HF_ONE` sebelum pihak itu sempat bertindak.

Beri komentar di kepala file yang menyatakan keterbatasannya secara jujur: simulasi ini tidak memodelkan gas, slippage, kegagalan transaksi, maupun kongesti jaringan, sehingga angkanya adalah batas atas keunggulan agent — bukan janji.

- [ ] **Step 4: Jalankan sampai hijau**

Run: `corepack pnpm test`
Expected: seluruh test PASS.

- [ ] **Step 5: Jalankan seluruh suite dan catat jumlahnya**

Run: `corepack pnpm test`
Expected: seluruh test dari Task 1–6 hijau.

- [ ] **Step 6: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): harness backtest likuidasi-dicegah"
```

---

## Definition of Done

- [ ] `corepack pnpm test` hijau seluruhnya di `ai/fuguguardian/app/agent/`
- [ ] Seluruh fungsi di `src/strategy/` selain `chain/` dan `explain.ts` murni — tanpa network, tanpa `Date.now()`, tanpa `process.env`
- [ ] Adapter berhasil membaca Aave dan Venus dari BSC mainnet dalam test sungguhan
- [ ] `explainDecision` terbukti mengembalikan alasan deterministik saat LLM gagal
- [ ] Tidak ada keputusan finansial yang melewati LLM
- [ ] Backtest melaporkan `liquidationsAvoided` yang bisa dijelaskan asal angkanya
