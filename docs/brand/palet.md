# Fugugent — Palet Warna

**Tanggal:** 2026-09-08
Semua rasio kontras di dokumen ini **dihitung** (WCAG 2.1 relative luminance), bukan
diperkirakan. Ambang: **AA teks normal 4,5:1** · **AA teks besar (≥18,66 px bold /
≥24 px) 3,0:1** · **AAA teks normal 7,0:1** · **komponen non-teks 3,0:1**.

---

## 1. Keputusan kuning BNB `#F0B90B`

**Kami sengaja menjauh.** `#F0B90B` bukan warna merek Fugugent; ia dipakai **hanya**
sebagai warna ekosistem — lencana "BNB Chain Testnet", ikon jaringan, footer — dan
tidak pernah sebagai warna tombol utama, tautan, atau latar merek.

Tiga alasan, berurutan dari yang paling mengikat:

1. **Kuning sudah punya pekerjaan lain di produk ini.** Tingkat kembung 2 ("Awas")
   memakai `#F0E442`. Kalau kuning juga jadi warna merek, setiap tombol dan setiap
   header ikut terlihat seperti peringatan, dan peringatan yang sesungguhnya kehilangan
   suaranya. Di produk yang seluruh nilainya adalah membaca risiko dalam sekali lihat,
   ini bukan soal selera — ini merusak fungsi.
2. **Kuning gagal sebagai teks.** `#F0B90B` di atas putih `#F4F8F9` hanya **1,69:1** —
   jauh di bawah AA untuk teks maupun 3,0:1 untuk komponen. Merek yang warnanya tidak
   bisa dipakai menulis akan terus-menerus dilanggar oleh implementasinya sendiri.
3. **Setiap peserta hackathon BNB memakai warna itu.** Menjadi kuning ke-lima puluh di
   ruangan bukan strategi diferensiasi. Fugugent justru punya identitas yang jauh lebih
   kuat untuk dipakai: laut dalam, dan ikan yang mengembang di dalamnya.

Yang **kami ambil** dari BNB Chain adalah kaidahnya, bukan hex-nya: satu warna aksen
hangat yang tegas di atas latar gelap. Kami memakainya untuk Fugu Yield (`#E69F00`) —
cukup dekat untuk terasa seekosistem, cukup jauh untuk tidak tertukar.

**Aturan pemakaian `#F0B90B`:** hanya di atas latar gelap (`#05121A` → 10,51:1), hanya
sebagai isi lencana atau ikon, ukuran minimal 16 px, tidak pernah sebagai warna teks di
atas latar terang, tidak pernah di dalam komponen risiko.

---

## 2. Warna dasar

| Token | Hex | Pakai untuk |
|---|---|---|
| `abyss-900` | `#05121A` | latar aplikasi (gelap), garis luar semua ilustrasi |
| `abyss-800` | `#0B1E2B` | permukaan kartu di mode gelap |
| `abyss-700` | `#14303F` | permukaan terangkat, header tabel |
| `line` | `#23485C` | garis pemisah di mode gelap |
| `foam-100` | `#F4F8F9` | latar aplikasi (terang), teks di atas latar gelap |
| `foam-200` | `#E3ECEF` | permukaan kartu di mode terang, isi perisai Guardian |
| `ink` | `#06131A` | teks utama di atas latar terang |
| `muted-dark` | `#9FB9C4` | teks sekunder **di atas latar gelap** |
| `muted-light` | `#4A6472` | teks sekunder **di atas latar terang** |

## 3. Warna merek

| Token | Hex | Catatan |
|---|---|---|
| `teal-700` | `#0A6470` | warna merek untuk teks/tautan **di atas latar terang** |
| `teal-600` | `#0E7C86` | isi tombol utama; teks putih di atasnya |
| `teal-300` | `#5FD4DC` | warna merek untuk teks/tautan/ikon **di atas latar gelap** |
| `teal-200` | `#9CE9EE` | sorotan, cahaya di sekitar fugu, garis fokus di mode gelap |
| `bnb-yellow` | `#F0B90B` | **hanya** lencana ekosistem, hanya di atas latar gelap |

## 4. Warna kategori agent

Diambil dari palet **Okabe–Ito**, set yang dirancang agar tetap terbedakan pada
deuteranopia, protanopia, dan tritanopia. Ini bukan pilihan estetis yang kebetulan
aman — ini titik awalnya.

| Agent | Token | Hex | Perut |
|---|---|---|---|
| Guardian (`HEALTH_FACTOR`) | `agent-guardian` | `#0072B2` | `#58A9E0` |
| Rebalancer (`REBALANCING`) | `agent-rebalancer` | `#CC79A7` | `#E9A8CC` |
| Grid (`GRID`) | `agent-grid` | `#56B4E9` | `#8FD3F4` |
| Yield (`YIELD`) | `agent-yield` | `#E69F00` | `#FFC24D` |

Guardian, Grid, dan Rebalancer akan saling mendekat pada penglihatan dikromat. Itu
**diterima dan disengaja**, karena pembeda utamanya adalah siluet (lihat
`karakter.md` §6), dan karena setiap kartu selalu menyertakan nama kategori sebagai
teks. Warna di sini adalah kanal ketiga, bukan pertama.

## 5. Warna tingkat kembung

Hanya boleh muncul di dalam komponen risiko (cincin avatar, chip, bar). **Tidak boleh**
dipakai untuk apa pun yang lain — bukan untuk tombol, bukan untuk grafik, bukan untuk
lencana.

| Tingkat | Token | Hex | Pola pendamping (wajib) |
|---|---|---|---|
| 1 Tenang | `risk-1` | `#009E73` | busur tipis utuh |
| 2 Awas | `risk-2` | `#F0E442` | cincin utuh + takik |
| 3 Tegang | `risk-3` | `#E69F00` | cincin putus-putus |
| 4 Kritis | `risk-4` | `#D55E00` | cincin ganda |
| 5 Gawat | `risk-5` | `#A4210E` | **loreng diagonal 45°** `#F4F8F9`/`#05121A` |

`risk-3` sengaja sama dengan `agent-yield`. Keduanya tidak pernah muncul pada peran
yang sama dalam satu komponen (satu di badan, satu di cincin), dan menambah satu oranye
lagi hanya akan memperkecil jarak antar-warna di seluruh sistem.

---

## 6. Tabel kontras (dihitung)

### Pasangan teks yang **lolos AA** — pakai ini

| Latar depan | Latar belakang | Rasio | Status |
|---|---|---|---|
| `ink #06131A` | `foam-100 #F4F8F9` | **17,60** | AAA |
| `foam-100 #F4F8F9` | `abyss-900 #05121A` | **17,73** | AAA |
| `foam-100 #F4F8F9` | `abyss-800 #0B1E2B` | **15,91** | AAA |
| `foam-100 #F4F8F9` | `abyss-700 #14303F` | **12,89** | AAA |
| `muted-light #4A6472` | `foam-100 #F4F8F9` | **5,85** | AA |
| `muted-dark #9FB9C4` | `abyss-900 #05121A` | **9,22** | AAA |
| `teal-700 #0A6470` | `foam-100 #F4F8F9` | **6,40** | AA (hampir AAA) |
| `teal-600 #0E7C86` | `foam-100 #F4F8F9` | **4,63** | AA teks normal |
| `putih #FFFFFF` | `teal-600 #0E7C86` | **4,95** | AA — tombol utama |
| `putih #FFFFFF` | `teal-700 #0A6470` | **6,84** | AA — tombol utama (hover) |
| `teal-300 #5FD4DC` | `abyss-900 #05121A` | **10,77** | AAA |
| `teal-300 #5FD4DC` | `abyss-800 #0B1E2B` | **9,67** | AAA |
| `ink #06131A` | `bnb-yellow #F0B90B` | **10,44** | AAA — teks pada lencana BNB |
| `putih #FFFFFF` | `risk-5 #A4210E` | **7,49** | AAA — chip Gawat |
| `ink #06131A` | `risk-2 #F0E442` | **14,23** | AAA — chip Awas |
| `agent-guardian #0072B2` | `foam-100 #F4F8F9` | **4,85** | AA |
| `putih #FFFFFF` | `agent-guardian #0072B2` | **5,19** | AA |
| `agent-grid #56B4E9` | `abyss-900 #05121A` | **8,21** | AAA |
| `agent-yield #E69F00` | `abyss-900 #05121A` | **8,42** | AAA |
| `agent-rebalancer #CC79A7` | `abyss-900 #05121A` | **6,19** | AA |
| `risk-5 #A4210E` | `foam-100 #F4F8F9` | **7,01** | AAA |

### Pasangan yang **GAGAL** — jangan dipakai untuk teks

| Latar depan | Latar belakang | Rasio | Catatan |
|---|---|---|---|
| `bnb-yellow #F0B90B` | `foam-100 #F4F8F9` | 1,69 | alasan utama §1 |
| `risk-2 #F0E442` | `foam-100 #F4F8F9` | 1,24 | kuning hanya sebagai isi, teks `ink` di atasnya |
| `teal-300 #5FD4DC` | `foam-100 #F4F8F9` | 1,65 | teal terang khusus mode gelap |
| `agent-grid #56B4E9` | `foam-100 #F4F8F9` | 2,16 | pakai `#0072B2` bila butuh teks biru di latar terang |
| `agent-yield #E69F00` | `foam-100 #F4F8F9` | 2,11 | pakai sebagai isi + teks `ink` |
| `agent-rebalancer #CC79A7` | `foam-100 #F4F8F9` | 2,86 | idem |
| `risk-5 #A4210E` | `abyss-900 #05121A` | 2,53 | **penting:** di mode gelap, tingkat 5 harus berupa blok isi `#A4210E` dengan teks putih, bukan teks merah |
| `risk-1 #009E73` | `foam-100 #F4F8F9` | 3,20 | cukup untuk komponen non-teks, tidak untuk teks |

Baris `risk-5` pada latar gelap adalah jebakan yang paling mudah dilanggar dan paling
mahal akibatnya: keadaan paling gawat justru menjadi paling sulit dibaca. Karena itu
tingkat 5 **selalu** blok isi + teks putih + loreng, di mode terang maupun gelap.

---

## 7. Token CSS

```css
:root {
  --abyss-900:#05121A; --abyss-800:#0B1E2B; --abyss-700:#14303F; --line:#23485C;
  --foam-100:#F4F8F9; --foam-200:#E3ECEF; --ink:#06131A;
  --muted-dark:#9FB9C4; --muted-light:#4A6472;

  --teal-700:#0A6470; --teal-600:#0E7C86; --teal-300:#5FD4DC; --teal-200:#9CE9EE;
  --bnb-yellow:#F0B90B;

  --agent-guardian:#0072B2;   --agent-guardian-belly:#58A9E0;
  --agent-rebalancer:#CC79A7; --agent-rebalancer-belly:#E9A8CC;
  --agent-grid:#56B4E9;       --agent-grid-belly:#8FD3F4;
  --agent-yield:#E69F00;      --agent-yield-belly:#FFC24D;

  --risk-1:#009E73; --risk-2:#F0E442; --risk-3:#E69F00;
  --risk-4:#D55E00; --risk-5:#A4210E;
}
```

## 8. Tipografi (ringkas)

- **Judul & angka:** satu grotesk dengan angka *tabular* — angka di kartu agent berganti
  tiap detik lewat WebSocket, dan lebar yang berubah-ubah membuat baris bergoyang.
  Aktifkan `font-variant-numeric: tabular-nums` di setiap tempat yang menampilkan
  metrik. Ini aturan yang mengikat, bukan preferensi.
- **Angka finansial** memakai format Indonesia: `1,18` (koma desimal), `6,4%`. Sudah
  konsisten dengan `formatHf()` dan `formatPercentFromBps()` di kode Guardian.
- **Ukuran minimum** teks metrik pada kartu: 13 px, bobot 500. Di bawah itu, hilangkan
  metriknya — jangan mengecilkannya.
