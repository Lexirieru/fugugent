@AGENTS.md

# frontend — Fugugent

Next.js 16 + React 19 + Tailwind v4, package manager **bun**.

Baca `../CLAUDE.md` dan `../docs/specs/2026-09-08-fugugent-design.md` (§7 dan §8)
sebelum membangun UI.

## Aturan UI yang ditegakkan

- **Tanpa dead end.** Setiap empty state menyebut aksi dan menyediakan tombolnya.
  Juri menguji ini secara eksplisit.
- **Detail agent = halaman ber-URL**, bukan modal. Bisa di-share, punya OG image fugu.
- **Estimasi biaya sebelum hire**, bukan sekadar peringatan.
- **Badge `Hired`** untuk mencegah user membayar dua kali.
- **Jangan pernah mengirim kontrol setengah jadi.** Lebih baik hilangkan elemennya
  daripada menampilkannya rusak.
- **Setiap angka bisa diverifikasi** — klik menuju tx hash di BscScan. Ini menjawab
  kegagalan nyata pasar: Giza/ARMA ditutup Feb 2026 setelah dashboard-nya menampilkan
  AUM besar sementara pengukuran on-chain menunjukkan posisi nyaris nol.
- **Fugu mengembang seiring risiko** — tingkat kembung dipetakan dari metrik risiko nyata.

## Perintah

```bash
bun dev
bun run build
bun run lint
```
