# Mock Lending Testnet + Guardian Tersambung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fugu Guardian benar-benar melindungi posisi pinjaman di BSC testnet — membaca posisi, memutuskan, dan **mengeksekusi transaksi** lewat session key Altana, semuanya di satu jaringan.

**Architecture:** Bangun protokol lending mock ber-antarmuka Aave v3 di testnet (`MockLendingPool` + `MockPriceFeed` + dua token), sehingga adapter yang sudah ada bisa dipakai apa adanya hanya dengan mengganti alamat. Lalu sambungkan lapisan strategi ke runtime agent: loop pemantauan → `decide()` → eksekusi ber-batas → catat.

**Tech Stack:** Solidity 0.8.30 + Foundry, TypeScript + viem, `@altananetwork/sdk` 0.7.1, vitest.

**Spec:** `docs/specs/2026-09-08-fugugent-design.md` §5 · **Status jujur:** `docs/STATUS.md`

## Global Constraints

- Solidity `^0.8.30`, OZ 5.7.0, **tanpa `__gap`** (append-only), custom errors.
- `MockLendingPool.getUserAccountData` **wajib** mengembalikan enam nilai dengan urutan dan satuan persis seperti Aave v3: `totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor`. Base unit = **USD 8 desimal**. HF basis **1e18**. Tanpa hutang → HF = `type(uint256).max`.
- Adapter TypeScript yang sudah ada **tidak boleh diubah logikanya** — hanya alamat dan chain yang berbeda. Kalau mock benar, adapter jalan apa adanya. Itu ujian kebenaran mock.
- Semua nilai TS sebagai `bigint`; import lokal berekstensi `.js`.
- **Eksekusi wajib lewat session key Altana**, bukan admin key. Spend cap ditegakkan di kode agent, bukan hanya dipercayakan ke Altana.
- Jangan sentuh `healthFactor.ts`, `decide.ts`, `explain.ts`, `backtest.ts` — semuanya sudah lolos review.
- Perintah kontrak dari `contracts/`, perintah agent dari `ai/fuguguardian/app/agent/`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `contracts/src/mocks/MockPriceFeed.sol` | AggregatorV3 yang harganya bisa di-set owner — untuk mensimulasikan penurunan harga. |
| `contracts/src/mocks/MockToken.sol` | ERC20 18 desimal dengan `mint` terbuka (testnet). |
| `contracts/src/mocks/MockLendingPool.sol` | Protokol lending ber-antarmuka Aave v3. Satu-satunya yang memegang dana. |
| `contracts/test/MockLendingPool.t.sol` | Test kontrak mock. |
| `contracts/script/DeployMocks.s.sol` | Deploy + seed likuiditas + buat posisi contoh. |
| `ai/.../src/strategy/chain/testnet.ts` | Konfigurasi alamat testnet + `createTestnetReader`. |
| `ai/.../src/strategy/execute.ts` | Eksekusi keputusan lewat session key, dengan spend cap dan kill switch. |
| `ai/.../src/strategy/guard.ts` | Loop pemantauan: baca → decide → execute → catat. |
| `ai/.../src/strategy/__tests__/execute.test.ts` | Test batas belanja dan kill switch. |

---

### Task 1: Mock price feed & token

**Files:** Create `contracts/src/mocks/MockPriceFeed.sol`, `contracts/src/mocks/MockToken.sol`, `contracts/test/Mocks.t.sol`

**Interfaces:**
- `MockPriceFeed(uint8 decimals_, int256 initialAnswer)` — `setAnswer(int256)` onlyOwner, `latestRoundData()`, `decimals()`, `description()`
- `MockToken(string name, string symbol)` — `mint(address,uint256)` terbuka, 18 desimal

- [ ] **Step 1: Tulis test**

`contracts/test/Mocks.t.sol` — uji: feed mengembalikan harga awal; `setAnswer` mengubahnya dan memperbarui `updatedAt`; non-owner tidak bisa `setAnswer`; token punya 18 desimal dan `mint` menambah saldo.

- [ ] **Step 2: Jalankan, pastikan gagal.** `forge test --match-contract MocksTest`
- [ ] **Step 3: Implementasi.** `MockPriceFeed` menyimpan `answer` dan `updatedAt`; `setAnswer` menyetel `updatedAt = block.timestamp`. `MockToken` mewarisi OZ `ERC20` dan `Ownable` tidak diperlukan untuk mint (testnet).
- [ ] **Step 4: Hijau.** `forge test --match-contract MocksTest -vv`
- [ ] **Step 5: Commit.** `feat(contracts): mock price feed dan token untuk testnet`

---

### Task 2: `MockLendingPool` ber-antarmuka Aave v3

**Files:** Create `contracts/src/mocks/MockLendingPool.sol`, `contracts/test/MockLendingPool.t.sol`

**Interfaces yang mengikat:**
```solidity
function addAsset(address token, address feed, uint16 ltvBps, uint16 liquidationThresholdBps) external;   // onlyOwner
function supply(address asset, uint256 amount) external;
function withdraw(address asset, uint256 amount) external;
function borrow(address asset, uint256 amount) external;
function repay(address asset, uint256 amount) external;
function getUserAccountData(address user) external view returns (
    uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor);
```

**Aturan perhitungan yang mengikat:**
```
nilaiUsd8(asset, amount) = amount × hargaFeed8 / 10^tokenDecimals
totalCollateralBase      = Σ nilaiUsd8(agunan)
totalDebtBase            = Σ nilaiUsd8(hutang)
currentLiquidationThreshold = rata-rata tertimbang nilai agunan atas liquidationThresholdBps
ltv                      = rata-rata tertimbang nilai agunan atas ltvBps
healthFactor             = totalCollateralBase × currentLiquidationThreshold × 1e18 / (10000 × totalDebtBase)
                           bila totalDebtBase == 0 → type(uint256).max
availableBorrowsBase     = max(0, totalCollateralBase × ltv / 10000 − totalDebtBase)
```
`borrow` menolak bila membuat HF turun di bawah 1e18. `withdraw` menolak dengan aturan sama.

- [ ] **Step 1: Tulis test.** Minimal: supply menaikkan agunan; tanpa hutang HF = `type(uint256).max`; supply 1000 USD lalu borrow 500 USD pada LT 80% memberi HF tepat 1,6e18; harga agunan turun setengah membuat HF 0,8e18; `borrow` yang melanggar HF ditolak; `repay` menaikkan HF kembali; rata-rata tertimbang benar untuk dua agunan dengan LT berbeda.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasi.** Simpan daftar aset per user. Gunakan `SafeERC20`. Jangan pakai `__gap`. Kontrak ini **tidak** upgradeable — ia alat uji, bukan bagian produk.
- [ ] **Step 4: Hijau,** dan pastikan `forge test` seluruh suite tetap hijau (sebelumnya 104).
- [ ] **Step 5: Commit.** `feat(contracts): MockLendingPool ber-antarmuka Aave v3`

---

### Task 3: Deploy mock + seed likuiditas + posisi contoh

**Files:** Create `contracts/script/DeployMocks.s.sol`; update `contracts/deployments/bsc-testnet.json`

- [ ] **Step 1: Tulis script.** Deploy `MockToken` mUSD dan mBNB; `MockPriceFeed` untuk keduanya (mUSD $1,00; mBNB harga BNB saat itu, mis. $750); `MockLendingPool`; `addAsset` keduanya (mUSD LTV 80%/LT 85%, mBNB LTV 60%/LT 75%); mint token ke deployer; **supply likuiditas** mUSD ke pool supaya ada yang bisa dipinjam; lalu buat **posisi contoh**: supply mBNB sebagai agunan dan borrow mUSD sehingga HF berada di sekitar 1,8.
- [ ] **Step 2: Simulasi tanpa broadcast.** Pastikan sukses dan HF posisi contoh tercetak.
- [ ] **Step 3: Deploy sungguhan** dengan `--broadcast`.
- [ ] **Step 4: Verifikasi on-chain** dengan `cast call getUserAccountData` — tempelkan keenam nilainya, dan pastikan HF-nya masuk akal.
- [ ] **Step 5: Catat alamat** ke `deployments/bsc-testnet.json` di bawah kunci `mocks`.
- [ ] **Step 6: Commit.** `feat(contracts): deploy mock lending + seed likuiditas di testnet`

---

### Task 4: Adapter testnet

**Files:** Create `ai/.../src/strategy/chain/testnet.ts`, `ai/.../src/strategy/__tests__/testnet.test.ts`

**Interfaces:** `createTestnetReader(rpcUrl?)` → `{ client, readPosition(account) }`, memakai `readAavePosition` **yang sudah ada** dengan alamat `MockLendingPool`.

**Aturan:** jangan menulis ulang logika pembacaan. Kalau `readAavePosition` tidak bisa dipakai apa adanya, itu berarti mock-nya salah — perbaiki mock, bukan adapter.

- [ ] **Step 1: Test** yang membaca posisi contoh dari testnet dan memastikan: `healthFactor` bukan null, `collateralBase > 0`, `debtBase > 0`, `liquidationThresholdBps` di antara 1 dan 10000. Timeout 30 detik.
- [ ] **Step 2: Gagal dulu.** — [ ] **Step 3: Implementasi.** — [ ] **Step 4: Hijau.**
- [ ] **Step 5: Commit.** `feat(guardian): adapter testnet menunjuk mock lending`

---

### Task 5: Eksekusi ber-batas lewat session key

**Files:** Create `ai/.../src/strategy/execute.ts`, `ai/.../src/strategy/__tests__/execute.test.ts`

**Interfaces:**
```ts
export interface ExecuteLimits { maxPerActionUsd8: bigint; maxPerDayUsd8: bigint; minIntervalSeconds: number; }
export interface ExecuteDeps { sendRepay: (asset: `0x${string}`, amount: bigint) => Promise<`0x${string}`>; now: () => number; }
export interface ExecuteState { spentTodayUsd8: bigint; dayStartedAt: number; lastActionAt: number; killed: boolean; }
export async function executeDecision(d: Decision, pos: Position, limits: ExecuteLimits, state: ExecuteState, deps: ExecuteDeps): Promise<ExecuteResult>
```

**Aturan yang mengikat — semua ditegakkan SEBELUM transaksi dikirim:**
1. `state.killed === true` → tidak pernah mengirim apa pun. Kill switch mutlak.
2. `d.action === "NONE"` atau `"WARN"` → tidak mengirim apa pun.
3. `d.suggestedRepayBase > limits.maxPerActionUsd8` → **potong** ke batas itu, jangan tolak; catat bahwa dipotong.
4. `state.spentTodayUsd8 + jumlah > limits.maxPerDayUsd8` → potong ke sisa anggaran; bila sisa nol, tidak mengirim.
5. `deps.now() - state.lastActionAt < limits.minIntervalSeconds` → tidak mengirim (cooldown).
6. Setelah kirim berhasil, perbarui `spentTodayUsd8` dan `lastActionAt`. Reset harian bila `now` melewati `dayStartedAt + 86400`.

`deps.sendRepay` disuntikkan supaya test tidak menyentuh jaringan.

- [ ] **Step 1: Test** untuk keenam aturan di atas plus: pemotongan per-aksi, pemotongan harian, reset harian, cooldown menolak lalu mengizinkan setelah lewat, dan kill switch mengalahkan segalanya.
- [ ] **Step 2: Gagal dulu.** — [ ] **Step 3: Implementasi.** — [ ] **Step 4: Hijau, tanpa menyentuh jaringan.**
- [ ] **Step 5: Commit.** `feat(guardian): eksekusi ber-batas dengan spend cap, cooldown, kill switch`

---

### Task 6: Loop pemantauan

**Files:** Create `ai/.../src/strategy/guard.ts`, `ai/.../src/strategy/__tests__/guard.test.ts`

**Interfaces:** `runGuardCycle(deps): Promise<CycleResult>` — satu siklus: baca posisi → `decide` → `executeDecision` → hasilkan catatan. Dan `startGuardLoop(deps, intervalMs)` yang memanggilnya berulang dengan penanganan error.

**Aturan:**
- Satu siklus **tidak boleh melempar**. Kegagalan pembacaan RPC dicatat dan siklus berikutnya tetap jalan — agent yang mati diam-diam lebih berbahaya daripada agent yang mengeluh.
- Penjelasan dGrid dipanggil **setelah** eksekusi, tidak pernah sebelum, dan kegagalannya diabaikan.
- Setiap siklus menghasilkan catatan berisi: waktu, HF, aksi, jumlah yang dikirim, tx hash bila ada, dan alasan.

- [ ] **Step 1: Test** dengan dependensi disuntikkan: siklus normal menghasilkan catatan; kegagalan pembacaan tidak melempar dan tercatat; kegagalan penjelasan tidak mengubah hasil eksekusi; aksi `NONE` tidak memanggil `sendRepay`.
- [ ] **Step 2: Gagal dulu.** — [ ] **Step 3: Implementasi.** — [ ] **Step 4: Hijau.**
- [ ] **Step 5: Commit.** `feat(guardian): loop pemantauan yang tidak pernah mati diam-diam`

---

### Task 7: E2E sungguhan di testnet

**Files:** Create `ai/.../scripts/e2e-guardian.ts`; update `docs/e2e/2026-09-08-e2e-testnet.md`

Script yang menjalankan skenario penuh di testnet dan mencetak buktinya:
1. Baca posisi contoh, cetak HF awal.
2. **Turunkan harga mBNB** lewat `MockPriceFeed.setAnswer` sehingga HF jatuh di bawah ambang `partialRepay`.
3. Jalankan satu siklus Guardian.
4. Cetak: keputusan, jumlah yang dibayar, **tx hash**, dan HF sesudahnya.
5. Pastikan HF sesudah lebih tinggi daripada sebelum, dan cetak selisihnya.

- [ ] **Step 1: Tulis script.**
- [ ] **Step 2: Jalankan sungguhan** di testnet. Tempelkan seluruh keluarannya.
- [ ] **Step 3: Dokumentasikan** hasilnya di `docs/e2e/` dengan tx hash yang bisa diklik.
- [ ] **Step 4: Perbarui `docs/STATUS.md`** — pindahkan butir "strategi belum tersambung" dari daftar BELUM ke daftar SUDAH, dengan bukti.
- [ ] **Step 5: Commit.** `feat(guardian): E2E perlindungan posisi terbukti di testnet`

---

## Definition of Done

- [ ] `forge test` hijau; `corepack pnpm test` hijau
- [ ] Mock lending live di testnet dengan likuiditas dan posisi contoh
- [ ] `readAavePosition` yang sudah ada dipakai **apa adanya** terhadap mock — membuktikan antarmukanya benar
- [ ] Guardian mengeksekusi repay sungguhan lewat session key, dengan tx hash
- [ ] Spend cap, cooldown, dan kill switch ditegakkan di kode dan diuji
- [ ] HF posisi terbukti naik setelah intervensi agent
- [ ] `docs/STATUS.md` diperbarui jujur
