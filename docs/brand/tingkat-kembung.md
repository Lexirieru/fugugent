# Fugugent — Tingkat Kembung

**Tanggal:** 2026-09-08
**Sumber ambang Guardian:** `ai/fuguguardian/app/agent/src/strategy/types.ts`
(`DEFAULT_THRESHOLDS`) dan `decide.ts`. **Bila kode berubah, dokumen ini ikut berubah**
— bukan sebaliknya. Angka di UI harus selalu sama dengan angka yang dipakai mesin
keputusan; kalau tidak, kita mengulangi persis kesalahan yang membunuh Giza/ARMA
(dashboard bercerita lain daripada rantai).

---

## 0. Kontrak visual

Lima tingkat. Tidak empat, tidak tujuh. Lima karena itu jumlah tepat untuk mencakup
empat ambang keputusan Guardian (`WARN`, `PARTIAL_REPAY`, `DELEVERAGE`, `EMERGENCY`)
plus satu keadaan "tidak ada yang perlu dilakukan".

Setiap tingkat berbeda pada **enam kanal sekaligus**. Bukan mubazir — masing-masing
kanal bertahan pada kondisi yang berbeda (ukuran kecil, grayscale, buta warna, animasi
mati, screenshot terkompresi).

| # | Kanal | Kenapa ada |
|---|---|---|
| 1 | Lebar badan | bertahan sampai 16 px dan setelah blur |
| 2 | Duri | bertahan di siluet |
| 3 | Mata & mulut | bertahan di ≥64 px, membawa muatan emosional |
| 4 | Cincin (rim) di sekeliling avatar | pola, bukan warna — bertahan di grayscale |
| 5 | Warna cincin | cepat dibaca oleh mayoritas, **tidak pernah sendirian** |
| 6 | Chip teks angka | satu-satunya kanal yang tidak ambigu; wajib ada di kartu dan detail |

**Aturan mutlak:** warna badan agent **tidak pernah** berubah karena tingkat kembung.
Yang berubah hanya bentuk badan dan cincin. Guardian yang gawat tetap kobalt; ia hanya
menjadi bulat, berduri, dan dikelilingi loreng.

---

## 1. Lima tingkat

Satuan geometri: kotak 100×100 unit, padding 8 unit (lihat `karakter.md` §1).

### Tingkat 1 — **Tenang**

- **Lebar badan** 56 u · tinggi 52 u (paling ramping)
- **Duri** tersembunyi seluruhnya; punggung mulus
- **Wajah** mata bulat rileks, kelopak sedikit turun, mulut `ω` kecil netral
- **Cincin** garis tipis 2 u, **utuh (solid)**, hanya di 40% keliling (busur atas)
- **Warna cincin** Reef Green `#009E73`
- **Chip** teks pada latar transparan, warna teks normal
- **Gerak** mengambang naik-turun 3 u, siklus 4 detik
- **Arti** tidak ada yang perlu dikerjakan. Agent hidup, memantau, tidak bertindak.

### Tingkat 2 — **Awas**

- **Lebar badan** 64 u · tinggi 58 u
- **Duri** muncul 25%, ujung masih **tumpul**
- **Wajah** satu alis naik, mata sedikit lebih terbuka, mulut tetap netral
- **Cincin** garis 3 u, **utuh**, 100% keliling, dengan **satu takik** di jam 12
- **Warna cincin** Shoal Yellow `#F0E442`
- **Chip** teks normal, ditambah label kata
- **Gerak** mengambang 2 u, siklus 3 detik
- **Arti** ambang pertama tersentuh. Agent sudah memberi tahu, belum membelanjakan apa
  pun. Ini tingkat yang paling sering dilihat pengguna dan **tidak boleh terasa seperti
  alarm** — kalau tingkat 2 sudah bikin panik, tingkat 5 kehilangan daya.

### Tingkat 3 — **Tegang**

- **Lebar badan** 72 u · tinggi 66 u
- **Duri** keluar 60%, ujung mulai runcing
- **Wajah** mata menyipit, pipi menggembung, mulut mengerucut menahan
- **Cincin** garis 3 u, **putus-putus** (dash 6 u / gap 4 u), 100% keliling
- **Warna cincin** Tide Amber `#E69F00`
- **Chip** teks normal + panah arah tren (naik/turun) — di sini arah mulai penting
- **Gerak** getar halus 1 u, 8 Hz, hanya saat data baru masuk
- **Arti** agent akan bertindak dan **membelanjakan uang**. Untuk Guardian: membayar
  sebagian hutang. Inilah tingkat pertama yang punya konsekuensi finansial, dan
  perubahan pola cincin dari utuh ke putus-putus menandainya tanpa perlu warna.

### Tingkat 4 — **Kritis**

- **Lebar badan** 80 u · tinggi 74 u
- **Duri** keluar 100%, runcing penuh
- **Wajah** mata melebar, pupil mengecil, satu tetes keringat di pelipis, mulut terbuka kecil
- **Cincin** **ganda** — dua garis 2 u dengan jarak 2 u, keduanya utuh
- **Warna cincin** Deep Vermillion `#D55E00`
- **Chip** teks tebal + ikon segitiga peringatan
- **Gerak** denyut skala 1,00 → 1,04, siklus 1,2 detik
- **Arti** tindakan agresif sedang berjalan (deleverage). Posisi masih bisa
  diselamatkan. Cincin ganda = "ada dua hal yang bergerak sekaligus".

### Tingkat 5 — **Gawat**

Ini tingkat yang harus terbaca tanpa warna sama sekali.

- **Lebar badan** 84 u · tinggi 82 u — **menyentuh dan sedikit terpotong bingkai
  kotak**. Satu-satunya tingkat yang keluar dari kotaknya. Fugu sudah tidak muat lagi.
- **Duri** 100% + baris duri sekunder di sela baris utama
- **Wajah** mata menjadi **silang (×)** — satu-satunya tingkat dengan mata bukan
  lingkaran; mulut terbuka lebar
- **Cincin** **loreng diagonal 45°**, lebar pita 4 u, berselang-seling
  `#F4F8F9` dan `#05121A` — kontras luminans 17,7:1, terbaca pada monokrom murni,
  pada layar rusak, dan pada cetakan hitam-putih
- **Warna** Alarm Red `#A4210E` dipakai hanya sebagai **blok isi chip**, dengan teks
  putih di atasnya (kontras 7,49:1). Merahnya adalah bonus, bukan pembawa pesan.
- **Chip** blok penuh, teks putih, huruf kapital, berisi angka + kata: `HF 0,98 · GAWAT`
- **Gerak** tidak ada. **Sengaja diam.** Semua tingkat lain bergerak; tingkat 5 membeku.
  Perubahan dari bergerak ke berhenti adalah sinyal yang sangat kuat secara periferal,
  dan ia tetap bekerja untuk pengguna yang mematikan animasi (lihat §5).
- **Arti** ambang terakhir sudah dilewati. Untuk Guardian: posisi berada di titik
  likuidasi.

**Empat kanal tingkat 5 yang tidak bergantung warna sedikit pun:** siluet terpotong
bingkai · mata silang · loreng hitam-putih · teks kapital pada chip. Hilangkan warna
seluruhnya dan tingkat 5 tetap satu-satunya yang tidak mungkin dikira tingkat lain.

---

## 2. Ringkasan tabel

| # | Nama | Lebar | Duri | Cincin (pola) | Cincin (warna) | Gerak |
|---|---|---|---|---|---|---|
| 1 | Tenang | 56 u | 0% | busur tipis utuh | `#009E73` | mengambang lambat |
| 2 | Awas | 64 u | 25% tumpul | utuh + takik | `#F0E442` | mengambang |
| 3 | Tegang | 72 u | 60% | putus-putus | `#E69F00` | getar saat update |
| 4 | Kritis | 80 u | 100% | ganda | `#D55E00` | denyut |
| 5 | Gawat | 84 u, terpotong | 100% + sekunder | **loreng 45° hitam-putih** | `#A4210E` (blok chip saja) | **diam** |

---

## 3. Pemetaan Guardian — `HEALTH_FACTOR`

Ini pemetaan yang mengikat, disalin langsung dari perbandingan di `decide.ts`. Perhatikan
bahwa **semua batas bersifat inklusif ke sisi yang lebih gawat** — kode memeriksa dari
kondisi paling gawat ke paling ringan supaya kasus tepat di ambang selalu jatuh ke
tindakan yang lebih aman. Visualnya harus meniru itu persis; kalau UI menampilkan
"Tegang" sementara agent sudah menjalankan `DELEVERAGE`, kita berbohong.

| Tingkat | Kondisi HF | `Action` di kode | Yang dikerjakan agent |
|---|---|---|---|
| 1 Tenang | `HF > 1,5` **atau `HF = null`** | `NONE` | memantau saja |
| 2 Awas | `1,2 < HF ≤ 1,5` | `WARN` | memberi tahu, tidak membelanjakan |
| 3 Tegang | `1,1 < HF ≤ 1,2` | `PARTIAL_REPAY` | membayar sebagian hutang |
| 4 Kritis | `1,0 < HF ≤ 1,1` | `DELEVERAGE` | mengurangi leverage |
| 5 Gawat | `HF ≤ 1,0` | `EMERGENCY` | tindakan darurat; sudah di titik likuidasi |

**Kasus `HF = null` (tidak ada hutang).** Ini keadaan **paling aman**, bukan keadaan
tidak diketahui, dan kode sudah menyatakannya begitu (`"Tidak ada hutang sehingga tidak
ada risiko likuidasi."`). Visualnya: tingkat 1 penuh, dengan chip `∞` menggantikan
angka. Jangan pernah menampilkan `—` atau `N/A`; itu membuat keadaan teraman terlihat
seperti data yang gagal dibaca.

**Angka pendamping wajib.** Selain HF, chip Guardian menampilkan `dropToLiquidationBps`
sebagai persen: *"agunan boleh turun 6,4% sebelum likuidasi"*. Untuk banyak orang
kalimat itu lebih bisa ditindaklanjuti daripada "HF 1,18", dan ia sudah dihitung oleh
kode. Di kartu 48 px hanya angka HF yang muat; persentase muncul pada hover dan di
halaman detail.

**Keadaan data basi.** Kalau pembacaan on-chain gagal atau lebih tua dari 2× interval
poll, jangan tampilkan tingkat apa pun. Tampilkan siluet fugu **berlubang (outline saja,
tanpa isi)** dengan chip `data basi · terakhir 4m lalu`. Menebak tingkat dari data lama
adalah kebohongan yang paling mahal di produk ini.

---

## 4. Pemetaan tiga agent lain

Prinsipnya sama: tiap agent memetakan **satu metrik risiko utama** yang bisa
diverifikasi on-chain ke lima tingkat yang sama. Metriknya berbeda per kategori — itu
memang yang dimaksud "metrik setara-dalam per kategori" di spec §7.5.

### Rebalancer — `REBALANCING`
Metrik: **persen waktu posisi LP berada di luar range** (rolling 24 jam), dari
perbandingan tick posisi dan tick pool.

| Tingkat | Waktu di luar range 24j |
|---|---|
| 1 Tenang | < 5% |
| 2 Awas | 5–15% |
| 3 Tegang | 15–30% |
| 4 Kritis | 30–50% |
| 5 Gawat | > 50%, **atau** di luar range > 24 jam tanpa rebalance yang menguntungkan |

Kondisi kedua pada tingkat 5 penting: posisi bisa "hanya" 40% di luar range tetapi
macet karena `ΔFee − Gas − Slippage − ΔIL` selalu negatif. Itu keadaan gawat yang
sesungguhnya — agent tidak bisa menolong, dan pengguna harus tahu.

### Grid — `GRID`
Metrik: **drawdown terhadap ekuitas puncak** sejak langganan dimulai.

| Tingkat | Drawdown |
|---|---|
| 1 Tenang | < 2% |
| 2 Awas | 2–5% |
| 3 Tegang | 5–10% |
| 4 Kritis | 10–18% |
| 5 Gawat | > 18%, **atau** harga keluar dari batas atas/bawah grid |

Harga keluar batas grid = strategi berhenti bekerja sama sekali (semua modal berada di
satu sisi). Grid harus mengembang penuh di situ walau drawdown-nya belum 18%, karena
inilah mode kegagalan struktural yang sudah kami janjikan untuk dinyatakan terbuka.

### Yield — `YIELD`
Metrik: **utilisasi pool tempat dana ditempatkan** (`borrow / supply`) — proksi
langsung untuk risiko "tidak bisa menarik dana".

| Tingkat | Utilisasi |
|---|---|
| 1 Tenang | < 70% |
| 2 Awas | 70–85% |
| 3 Tegang | 85–92% |
| 4 Kritis | 92–97% |
| 5 Gawat | > 97%, **atau** penarikan gagal karena likuiditas habis |

APR tinggi **tidak pernah** mengecilkan fugu. Kembung hanya bicara risiko. Kalau APR
naik karena utilisasi naik, fugu mengembang — itu justru pesan yang benar, dan itu yang
membedakan kami dari dashboard yang memajang APR headline tanpa konteks.

---

## 5. Aturan implementasi

1. **Ambang datang dari satu sumber.** Backend mengirim `bloatLevel: 1|2|3|4|5` yang
   sudah dihitung dari metrik mentah; frontend **tidak boleh** menghitung ulang ambang.
   Frontend juga menerima metrik mentah untuk ditampilkan, tapi bukan untuk memutuskan.
2. **Transisi naik cepat, turun lambat.** Mengembang 400 ms `ease-out`; mengempis
   900 ms `ease-in-out`. Risiko datang mendadak, pemulihan tidak. Ini juga mencegah
   avatar berkedip-kedip saat metrik bergetar di sekitar ambang.
3. **Histeresis 3%.** Untuk turun satu tingkat, metrik harus melewati ambang sejauh 3%
   ke arah aman. Tanpa ini, HF 1,199 → 1,201 → 1,199 membuat fugu berkedip dan
   pengguna berhenti mempercayainya.
4. **`prefers-reduced-motion`.** Semua gerak dimatikan; bentuk, cincin, dan chip
   tetap membawa seluruh informasi. Tidak ada informasi yang **hanya** ada di animasi —
   termasuk "diam" pada tingkat 5, yang tetap ditandai loreng dan mata silang.
5. **Ukuran minimum tampil.** Cincin dan duri boleh disederhanakan di bawah 32 px,
   tetapi chip angka tidak boleh dihilangkan di ukuran mana pun yang menampilkan
   tingkat 4 atau 5. Kalau tidak muat, jangan tampilkan avatarnya sama sekali —
   tampilkan barisnya sebagai teks.
6. **Aria.** `role="img"` dengan `aria-label` yang berisi kalimat penuh, bukan angka
   telanjang: *"Fugu Guardian, tingkat 4 dari 5, kritis. Health factor 1,06. Agunan
   boleh turun 5,7 persen sebelum likuidasi."*
7. **Jangan pernah memakai tingkat kembung untuk hal selain risiko.** Bukan untuk
   popularitas, bukan untuk AUM, bukan untuk jumlah hirer. Satu mekanik, satu makna —
   begitu ia dipakai untuk dua hal, ia berhenti berarti apa pun.
