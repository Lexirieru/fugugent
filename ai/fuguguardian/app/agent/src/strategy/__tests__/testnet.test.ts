import { describe, expect, it } from "vitest";
import { createTestnetReader } from "../chain/testnet.js";
import { computeHealthFactor } from "../healthFactor.js";

/** Pemilik posisi contoh di MockLendingPool BSC testnet. */
const AKUN_CONTOH = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;

describe("adapter testnet (MockLendingPool, read-only)", () => {
  it(
    "membaca posisi contoh dari mock lending pool testnet",
    { timeout: 30_000 },
    async () => {
      const r = createTestnetReader();
      const pos = await r.readPosition(AKUN_CONTOH);

      expect(pos.healthFactor).not.toBeNull();
      expect(pos.collateralBase).toBeGreaterThan(0n);
      expect(pos.debtBase).toBeGreaterThan(0n);
      expect(pos.liquidationThresholdBps).toBeGreaterThanOrEqual(1n);
      expect(pos.liquidationThresholdBps).toBeLessThanOrEqual(10_000n);

      // Health factor SENGAJA tidak dipatok ke angka snapshot.
      //
      // Versi sebelumnya menuntut HF ≈ 1,8 — nilai posisi contoh sesaat setelah
      // deploy. Itu bukan menguji adapter, melainkan menguji "belum ada yang
      // menyentuh testnet", dan langsung merah begitu E2E Guardian
      // (`scripts/e2e-guardian.ts`) melakukan persis apa yang memang tugasnya:
      // membayar sebagian hutang, sehingga hutang posisi contoh berkurang
      // permanen dan HF-nya naik. Test yang merah karena produknya bekerja
      // adalah test yang salah menagih.
      //
      // Yang benar-benar harus dijamin adapter ini: angka yang dilaporkan pool
      // dibaca dari posisi tuple yang tepat dan dalam satuan yang tepat. Itu
      // diperiksa dengan menghitung ulang HF dari `collateralBase`,
      // `debtBase`, dan `liquidationThresholdBps` pada bacaan yang SAMA memakai
      // implementasi TypeScript yang berdiri sendiri. Kalau urutan field
      // tertukar atau satuannya meleset, kedua angka ini tidak akan cocok.
      const hf = pos.healthFactor as bigint;
      expect(hf).toBeGreaterThan(0n);
      expect(hf).toBe(
        computeHealthFactor(pos.collateralBase, pos.debtBase, pos.liquidationThresholdBps),
      );

      // Identitas posisi tetap dipaku — dua nilai ini TIDAK berubah oleh repay,
      // jadi memakukannya tidak mengembalikan kerapuhan yang baru saja dibuang.
      //
      //   - `collateralBase`: repay hanya menyentuh sisi hutang. Agunan posisi
      //     contoh tetap 10 mBNB, dan pada harga feed $750 nilainya $7.500,00.
      //   - `liquidationThresholdBps`: konfigurasi aset di pool, bukan keadaan
      //     posisi.
      //
      // Tanpa keduanya, test ini lolos terhadap pool mana pun ber-ABI Aave v3
      // dengan posisi apa pun yang kebetulan konsisten secara internal — alamat
      // pool yang salah pun tidak akan ketahuan.
      //
      // Ketergantungannya jelas dan disengaja: `collateralBase` benar hanya
      // selama harga mBNB di feed adalah $750. E2E (`scripts/e2e-guardian.ts`)
      // menurunkan harga itu sementara, lalu SELALU memulihkannya lewat
      // `finally` — termasuk saat ia gagal di tengah jalan. Kalau test ini
      // merah di sini, itu sinyal jujur bahwa testnet ditinggalkan dalam
      // keadaan tidak pulih, bukan sekadar test yang cerewet.
      expect(pos.collateralBase).toBe(750_000_000_000n); // $7.500,00 @ $750/mBNB
      expect(pos.liquidationThresholdBps).toBe(7_500n); // 75%
    },
  );
});
