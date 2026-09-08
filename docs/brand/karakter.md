# Fugugent — Karakter

**Tanggal:** 2026-09-08
**Ruang lingkup:** identitas visual empat agent Fugu. Kategori terkunci di
`contracts/src/types/FuguTypes.sol` (`REBALANCING | GRID | YIELD | HEALTH_FACTOR`)
dan tidak boleh diubah dari sisi brand.

Dokumen pendamping: `tingkat-kembung.md` (state risiko), `palet.md` (warna),
`prompt-gambar.md` (produksi gambar).

---

## 0. Ide inti

Fugu mengembang seiring beban risiko. Ini bukan hiasan: tingkat kembung adalah
**pembacaan metrik**, sama seriusnya dengan angka di sebelahnya. Karena itu ada satu
aturan yang tidak boleh dilanggar di seluruh sistem:

> **Warna badan menyatakan siapa agent itu. Bentuk badan menyatakan seberapa berat
> risikonya.** Warna badan tidak pernah berubah karena risiko; kembung tidak pernah
> berubah karena kategori.

Konsekuensinya: seorang pengguna buta warna tetap bisa membaca risiko (bentuk), dan
seorang pengguna yang melihat kartu dalam ukuran 48 piksel tetap bisa membedakan agent
(siluet). Dua kanal yang saling melengkapi, bukan saling menumpuk.

Ini juga alasan mengapa kami tidak memakai wajah gembira/sedih sebagai penanda utama:
ekspresi hilang di bawah ~64 piksel, sedangkan siluet dan lebar badan bertahan.

---

## 1. Aturan keluarga

Yang membuat keempatnya terlihat satu spesies, bukan empat stok gambar:

| Aspek | Aturan |
|---|---|
| Sudut pandang | 3/4 depan, sedikit dari atas, menghadap **kanan**. Tidak pernah profil murni, tidak pernah dari belakang. |
| Bidang | Kotak 1:1. Badan hidup di kotak 100×100 unit dengan padding 8 unit di semua sisi. |
| Konstruksi | Badan = telur/bulat telur. Kepala dan badan satu bentuk — fugu tidak punya leher. |
| Garis luar | Tebal seragam **3 unit** (di 48 px ≈ 1,5–2 px), warna `#05121A` (Abyss 900), **bukan hitam murni**. |
| Mata | Dua lingkaran besar, jarak antar-mata = 1 diameter mata, pupil bulat + **satu** kilau putih di jam 10. |
| Mulut | Kecil, di bawah titik tengah mata, bentuk `ω` pipih. |
| Sirip | Dua sirip dada kecil, satu sirip ekor kipas 3 lembar. |
| Perut | Selalu 18% lebih terang dari warna badan, batasnya garis lengkung tunggal. |
| Duri | Titik keluar duri **sama persis** di keempat karakter: 5 baris mengikuti kontur punggung dan sisi. Yang berbeda cuma seberapa keluar. |
| Bayangan | Satu blok datar (bukan gradasi) di sisi kiri-bawah badan, 12% lebih gelap. |
| Rendering | Vektor datar, tanpa gradasi mesh, tanpa tekstur, tanpa outline ganda. |
| Properti | Setiap agent punya **satu** properti khas, dan properti itu **menempel di badan** — tidak dipegang. Tangan tidak terbaca di 48 px. |

**Uji keluarga:** jika keempat siluet hitam diletakkan berdampingan, orang harus bisa
bilang "ini empat ikan yang sama jenisnya" *dan* menunjuk mana yang mana. Kalau salah
satu gagal, desainnya yang salah, bukan pembacanya.

---

## 2. Fugu Guardian — `HEALTH_FACTOR`

**Tugas:** menjaga posisi lending dari likuidasi (Venus, Aave v3).

**Watak.** Penjaga malam. Tenang sampai ke titik membosankan, dan itu memang
prestasinya. Tidak pernah menaikkan suara; kalau Guardian bergerak, artinya angkanya
memang sudah menyentuh ambang. Bicara dalam angka, bukan dalam kata sifat: bukan
"posisimu agak berisiko", tapi "HF 1,18 — 6,4% penurunan harga lagi sampai likuidasi".

**Siluet.** Paling **lebar dan rendah** dari keempatnya (rasio lebar:tinggi ≈ 1,15:1).
Ciri unik: **garis punggung lurus** karena ada cangkang perisai setengah-lingkaran yang
menempel di punggung. Hanya Guardian yang punya bagian atas rata — tiga lainnya
melengkung. Alis tebal, sedikit turun ke tengah (fokus, bukan marah).

**Warna.** Badan Guardian Cobalt `#0072B2` · perut `#58A9E0` · perisai Foam `#E3ECEF`
dengan garis Abyss. Mata putih `#F4F8F9`, pupil Abyss 900.

**Properti khas.** Perisai punggung, dengan **satu bilah meteran vertikal** di sisi
kanan perisai yang terisi dari bawah — itulah bar Health Factor. Di level tenang
terisi penuh; di level gawat tinggal segaris.

**Yang membuatnya terbaca di 48 px.** Punggung rata. Itu saja sudah cukup: dalam siluet
monokrom 48 px, Guardian adalah satu-satunya bentuk dengan tepi atas horizontal, dan
satu-satunya yang lebih lebar daripada tinggi. Warna kobalt gelap menjadi pembeda
kedua, bukan pertama.

---

## 3. Fugu Rebalancer — `REBALANCING`

**Tugas:** menjaga bobot portofolio / posisi LP PancakeSwap v3 tetap dalam range.

**Watak.** Perfeksionis yang gelisah halus. Tidak tahan melihat sesuatu miring. Tapi ia
juga tahu merapikan itu ada ongkosnya — ia hanya bergerak bila `ΔFee − Gas − Slippage −
ΔIL > 0`. Jadi wataknya: rewel, tetapi berhitung. Bukan tipe yang menyentuh posisi
setiap jam.

**Siluet.** Badan sedikit lebih **tinggi daripada lebar** (≈ 1:1,1) — telur berdiri.
Ciri unik: **dua sirip dada besar terentang mendatar**, simetris, pada ketinggian yang
sama persis, seperti lengan timbangan. Hanya Rebalancer yang punya lebar melewati badan
ke kiri dan kanan. Ekor pendek dan kecil supaya lengan itu tetap jadi bentuk dominan.

**Warna.** Badan Rebalancer Orchid `#CC79A7` · perut `#E9A8CC` · ujung sirip Foam.

**Properti khas.** Satu gelembung di ujung tiap sirip, **berukuran tidak sama** —
gelembung kiri lebih besar dari kanan saat portofolio miring, dan menjadi sama besar
saat seimbang. Ini properti yang ikut hidup: perbedaan ukuran gelembung = deviasi bobot.

**Yang membuatnya terbaca di 48 px.** Bentuk "T mendatar": dua titik di kiri dan kanan
pada garis tinggi yang sama. Bahkan saat detail sirip hilang, dua titik itu bertahan
sebagai dua piksel gelap simetris — pola yang tidak dimiliki tiga lainnya.

---

## 4. Fugu Grid — `GRID`

**Tugas:** perdagangan grid di PancakeSwap v3 (swap langsung; PancakeSwap tidak punya
order-book on-chain, jadi Grid memantau `slot0()` sendiri).

**Watak.** Metodis dan dingin. Tidak punya pendapat soal arah pasar — hanya soal level.
Dan ia jujur soal kelemahannya: strategi grid secara struktural mean-reversion, jadi
**rugi di pasar trending**, dan itu ditulis terbuka di halaman agent. Karakter yang
mengakui batasnya lebih dipercaya daripada karakter yang tersenyum terus.

**Siluet.** Paling **bersudut**. Badan tetap bulat telur (aturan keluarga), tapi sirip
punggung berbentuk **segitiga tajam tunggal** yang mencuat tegak — satu-satunya sudut
runcing di keluarga ini saat level tenang. Ekor kipas dipotong rata, bukan melengkung.

**Warna.** Badan Grid Sky `#56B4E9` · perut `#8FD3F4` · garis kisi Abyss 900 pada
opasitas 20%.

**Properti khas.** **Visor persegi tipis** melintang di kedua mata (satu garis horizontal
gelap), plus **kisi 3×3** tercetak samar di badan. Level grid yang sudah terisi
ditandai satu kotak kisi yang penuh warna.

**Yang membuatnya terbaca di 48 px.** Dua tanda yang bertahan: segitiga tegak di atas
badan, dan satu garis gelap horizontal melintasi wajah. Kisi 3×3 akan menyatu jadi
tekstur abu-abu di ukuran kecil — itu tidak apa-apa, ia berperan sebagai "badan agak
lebih gelap", bukan sebagai informasi.

---

## 5. Fugu Yield — `YIELD`

**Tugas:** memindahkan posisi ke pool ber-APR-tertimbang-risiko tertinggi
(Venus, Aave v3, Lista).

**Watak.** Pemburu yang ramah dan sedikit rakus. Selalu mengendus. Optimis, tapi
optimisme yang dihitung: ia hanya pindah kalau selisih APR melebihi ongkos migrasi.
Dari keempatnya, dialah yang paling mudah disukai — dan justru karena itu halaman
detailnya harus paling keras soal disclaimer.

**Siluet.** Paling **bulat dan penuh** bahkan pada level tenang — baseline-nya memang
lebih besar 8% dari tiga lainnya (dia sudah gemuk sebelum risiko datang; itu bagian
dari leluconnya). Ciri unik: **sirip punggung berbentuk daun**, melengkung miring ke
belakang — tonjolan diagonal di kanan-atas siluet.

**Warna.** Badan Yield Amber `#E69F00` · perut `#FFC24D`. Satu-satunya fugu berwarna
hangat, dan itu disengaja.

**Properti khas.** **Tiga gelembung menaik** di belakang ekor, ukurannya mengecil ke
atas — arus hasil yang mengalir. Gelembung ini juga jadi indikator: makin cepat
animasinya, makin sering agent memindahkan posisi.

**Yang membuatnya terbaca di 48 px.** Tonjolan daun diagonal di kanan-atas + suhu
warna. Dalam deret empat avatar, Yield adalah satu-satunya bercak hangat; dalam siluet
monokrom, satu-satunya dengan tonjolan miring (bukan tegak seperti Grid, bukan rata
seperti Guardian).

---

## 6. Matriks pembeda 48 piksel

Diurutkan dari kanal yang paling tahan penyusutan ke yang paling cepat hilang.

| Kanal | Guardian | Rebalancer | Grid | Yield |
|---|---|---|---|---|
| **Tepi atas siluet** | rata (perisai) | melengkung | segitiga tegak | tonjolan miring |
| **Rasio lebar:tinggi** | 1,15 : 1 | 1 : 1,1 | 1 : 1 | 1,05 : 1 (baseline +8%) |
| **Lebar melewati badan** | tidak | ya, kiri+kanan | tidak | tidak |
| **Tanda pada wajah** | alis tebal | — | garis visor mendatar | — |
| **Suhu warna** | dingin gelap | dingin muda (magenta) | dingin terang | **hangat** |
| **Tekstur badan** | polos | polos | kisi samar | polos |

**Uji wajib sebelum aset dianggap selesai:**

1. Render 48×48 px, lalu ubah ke **grayscale**. Keempatnya harus tetap bisa
   dipasangkan ke nama yang benar oleh orang yang baru melihatnya satu kali.
2. Render 48×48 px, lalu **blur 2 px**. Siluet harus tetap berbeda.
3. Letakkan keempatnya di latar `#0B1E2B` dan `#F4F8F9`. Tidak boleh ada yang hilang
   di salah satunya.
4. Simulasi deuteranopia dan protanopia. Guardian/Grid/Rebalancer akan saling mirip
   dalam hue — itu diterima, karena pembedanya siluet. Yang **tidak** diterima adalah
   kalau dua siluet ikut mirip.

---

## 7. Agent pihak ketiga (fallback)

Spec `§8` menetapkan fugu fallback berwarna deterministik dari ID agent. Aturan brand:

- Fallback memakai **siluet netral**: badan telur polos, tanpa properti khas, tanpa
  perisai/visor/daun/lengan. Properti khas milik empat agent first-party dan tidak
  boleh bocor ke pihak ketiga — itu yang membuat empat agent kami terbaca sebagai
  lantai kualitas, bukan sekadar empat dari 309 ribu.
- Hue diambil dari `hash(agentId) mod 360`, tetapi **saturasi dan lightness dikunci**
  (S 42%, L 52%) supaya tidak pernah ada kartu yang menyala lebih terang daripada
  agent terkurasi, dan supaya kontras teks tetap bisa diprediksi.
- Hue di rentang 95°–150° (hijau) dan 0°–20° (merah) **dilewati** — dua rentang itu
  milik semantik risiko, bukan milik identitas.
- Fallback tetap ikut sistem kembung: ia mengembang juga, karena metriknya sama.
