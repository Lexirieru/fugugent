# Fugugent — Hasil Produksi Aset

**Tanggal:** 2026-09-08

---

## 1. Tool pembuat gambar: TIDAK TERSEDIA

Dua MCP server pembuat gambar yang tersedia di lingkungan ini **tidak terhubung** saat
pekerjaan ini dijalankan. Dicoba, dan gagal, empat kali:

| Panggilan | Hasil |
|---|---|
| `mcp__claude_ai_pika__generate_image` (nano-banana-pro, prompt penuh Guardian) | `MCP server "claude.ai pika" is not connected` |
| `mcp__claude_ai_pika__generate_image` (nano-banana-2-lite, prompt minimal) | `MCP server "claude.ai pika" is not connected` |
| `mcp__claude_ai_Higgsfield__generate_image` (nano_banana_pro, prompt penuh Guardian) | `MCP server "claude.ai Higgsfield" is not connected` |
| `mcp__claude_ai_Higgsfield__balance` (uji koneksi) | `MCP server "claude.ai Higgsfield" is not connected` |

**Nol gambar dihasilkan oleh model generatif.** Tidak ada satu pun berkas di
`landingpage/public/brand/` yang berasal dari model gambar. Prompt di
`prompt-gambar.md` **belum pernah dijalankan** dan karena itu belum diverifikasi
terhadap keluaran nyata — anggap ia sebagai spesifikasi yang matang, bukan sebagai
resep yang sudah terbukti.

## 2. Yang dikerjakan sebagai gantinya

Aset digambar tangan sebagai **SVG parametrik**, dihasilkan oleh
`docs/brand/generate-svg.py` (Python, tanpa dependensi). Skrip itu menerjemahkan
geometri di `karakter.md` dan `tingkat-kembung.md` menjadi bentuk — kotak 100×100,
lebar badan per tingkat, sudut duri, pola cincin, semuanya angka yang sama persis
dengan yang ada di dokumen.

Ini bukan sekadar penambal. `prompt-gambar.md` §7 sudah menyatakan lebih dulu bahwa
**avatar 48 px harus SVG gambar tangan, bukan PNG hasil generate**, karena di ukuran
itu presisi geometri menentukan segalanya dan karena tingkat kembung harus bisa
berubah lewat props, bukan lewat mengganti berkas. Jadi yang ada di repo sekarang
adalah justru aset yang memang dibutuhkan produk; yang hilang adalah versi ilustratif
yang lebih kaya untuk materi pemasaran.

Menjalankan ulang:

```bash
python3 docs/brand/generate-svg.py landingpage/public/brand
```

## 3. Berkas yang benar-benar ada

Semua di `landingpage/public/brand/`. **13 berkas, semuanya SVG.**

| Berkas | Isi | Rujukan spec |
|---|---|---|
| `guardian.svg` | Guardian, tingkat kembung 1 | `karakter.md` §2 |
| `rebalancer.svg` | Rebalancer, tingkat kembung 1 | `karakter.md` §3 |
| `grid.svg` | Grid, tingkat kembung 1 | `karakter.md` §4 |
| `yield.svg` | Yield, tingkat kembung 1 | `karakter.md` §5 |
| `guardian-kembung-1.svg` | Tenang — `HF > 1,5`, `NONE` | `tingkat-kembung.md` §3 |
| `guardian-kembung-2.svg` | Awas — `1,2 < HF ≤ 1,5`, `WARN` | idem |
| `guardian-kembung-3.svg` | Tegang — `1,1 < HF ≤ 1,2`, `PARTIAL_REPAY` | idem |
| `guardian-kembung-4.svg` | Kritis — `1,0 < HF ≤ 1,1`, `DELEVERAGE` | idem |
| `guardian-kembung-5.svg` | Gawat — `HF ≤ 1,0`, `EMERGENCY` | idem |
| `maskot.svg` | Maskot utama / logo | `prompt-gambar.md` §5.1 |
| `favicon-src.svg` | Sumber favicon (latar `#05121A`) | `prompt-gambar.md` §5.2 |
| `og.svg` | OG image 1200×630 | `prompt-gambar.md` §5.3 |
| `fallback.svg` | Fugu netral untuk agent pihak ketiga | `karakter.md` §7 |

`guardian.svg` dan `guardian-kembung-1.svg` isinya identik — disengaja, supaya
pemakai bisa merujuk salah satu tanpa perlu tahu konvensi yang lain.

## 4. Pemeriksaan yang benar-benar dijalankan

Dirender dengan `qlmanage -t` (WebKit) dan diperiksa secara visual.

| Uji | Hasil |
|---|---|
| Render 4 karakter berdampingan, tingkat 1 | lolos — keempat siluet berbeda |
| Render 5 tingkat Guardian berdampingan | lolos — progresi lebar terbaca berurutan |
| **Grayscale penuh** (`feColorMatrix saturate 0`) pada 48 px | **lolos** — keempat karakter tetap bisa dipasangkan ke namanya; kelima tingkat tetap berurutan karena pola cincin (busur / utuh+takik / putus-putus / ganda / loreng) tidak bergantung warna sama sekali |
| OG image 1200×630 | lolos — teks di sepertiga kiri, empat fugu menaik dari ramping ke gawat di kanan |

Tiga cacat ditemukan dan diperbaiki dalam proses ini, dicatat supaya tidak terulang:

1. **Kelopak mata tingkat 1 digambar sebagai setengah lingkaran**, bukan segmen di atas
   tali busur, sehingga mata tertutup separuh dan seluruh keluarga terlihat memakai
   kacamata hitam. Diperbaiki dengan menghitung lebar tali busur `√(r² − k²)`.
2. **Sirip dada ditempatkan di tengah perut** sehingga terbaca sebagai mulut kedua.
   Dipindah ke tepi kiri-bawah badan.
3. **Duri terlalu pendek** untuk terlihat di bawah 64 px. Panjangnya dinaikkan dari
   9 ke 10,5 unit dan tingkat 5 dikecilkan sedikit (88→86 unit) supaya durinya
   menembus keluar cincin loreng, bukan tersembunyi di baliknya.

## 5. Yang belum dikerjakan

- **Tidak ada berkas PNG.** Lingkungan ini tidak punya rasterizer SVG
  (`rsvg-convert`, `inkscape`, ImageMagick, `cairosvg` — semuanya tidak ada); yang ada
  hanya `qlmanage`, yang selalu mengeluarkan kanvas persegi dengan bantalan putih dan
  karena itu tidak layak dipakai sebagai aset. SVG sudah langsung bisa dipakai di
  `next/image` dan `<img>`, jadi ini bukan penghalang. Bila PNG/ICO dibutuhkan untuk
  favicon lama, hasilkan lewat pipeline build (`sharp`) di `landingpage/`, bukan
  dengan mengecek berkas hasil rasterisasi ke repo.
- **Rangkaian lima tingkat untuk Rebalancer, Grid, dan Yield.** Skrip sudah
  mendukungnya (`character("grid", 4)` dan seterusnya); hanya belum ditulis ke berkas
  karena tugas ini hanya meminta rangkaian Guardian. Menambahkannya satu baris.
- **Versi ilustratif hasil model generatif.** Menunggu MCP pembuat gambar hidup.
  Prompt sudah siap dan lengkap di `prompt-gambar.md`.
- **Simulasi buta warna sungguhan** (deuteranopia/protanopia). Yang dijalankan baru
  grayscale penuh — uji yang lebih keras untuk urutan luminans, tetapi bukan
  pengganti simulasi dikromat. Jalankan sebelum peluncuran.
