# Fugugent — Prompt Gambar

**Tanggal:** 2026-09-08
**Tujuan:** menghasilkan aset yang **konsisten antar-jalan**. Dua orang yang menjalankan
prompt yang sama, pada hari yang berbeda, harus mendapat karakter yang sama — bukan
sekadar "ikan buntal yang mirip".

**Prompt ditulis dalam bahasa Inggris.** Ini keputusan teknis, bukan kelalaian gaya:
model gambar yang kita pakai jauh lebih patuh pada instruksi geometris (rasio, sudut,
tebal garis) dalam bahasa Inggris. Seluruh penjelasan dan kaidah tetap bahasa Indonesia.

---

## 0. Cara merakit prompt

Setiap prompt karakter = **tiga blok, digabung dengan tanda titik, berurutan:**

```
[BLOK GAYA] + [BLOK KARAKTER] + [BLOK TINGKAT]
```

Aturan yang menjaga konsistensi:

1. **Blok gaya disalin persis, karakter demi karakter.** Jangan diparafrase, jangan
   diringkas, jangan diubah urutan kalimatnya. Sebagian besar ketidakkonsistenan antar-
   jalan berasal dari sini.
2. **Rantai referensi.** Hasilkan **jangkar** lebih dulu (Guardian tingkat 1). Semua
   gambar berikutnya dijalankan dengan jangkar itu sebagai `reference_images`, dan
   gambar tingkat berikutnya memakai gambar tingkat sebelumnya dari karakter yang sama.
   Teks saja tidak cukup untuk menjaga identitas.
3. **Satu model untuk seluruh set.** Jangan mencampur model di tengah set; perbedaan
   antar-model jauh lebih besar daripada perbedaan antar-jalan pada model yang sama.
4. **Rasio 1:1, resolusi 2K** untuk semua avatar. OG image adalah satu-satunya
   pengecualian.
5. **Selalu sertakan blok negatif** di akhir bila tool mendukungnya; kalau tidak, kalimat
   larangan sudah dititipkan di dalam blok gaya.

**Setelan yang dipakai** (catat setiap perubahan di `hasil.md`):

| Parameter | Nilai |
|---|---|
| Tool | `mcp__claude_ai_pika__generate_image` |
| `provider` | `nano-banana-pro` |
| `aspect_ratio` | `1:1` (OG image: `16:9`) |
| `resolution` | `2K` |
| `num_images` | `1` |

---

## 1. BLOK GAYA (salin persis)

```
Flat vector mascot illustration in a clean modern app-icon style. Thick uniform dark
outline in colour #05121A, completely flat fills, no gradients, no texture, no glow,
and exactly one flat darker block shadow on the lower-left of the body. The character
is a cartoon pufferfish (fugu): one single egg-shaped body with no neck, two large
round white eyes with round black pupils and a single small white glint at ten
o'clock in each eye, a small omega-shaped mouth set below the eyes, two small pectoral
fins, and a three-lobed fan tail. Three-quarter front view seen slightly from above,
facing right. The character is centred in a square frame with 8 percent padding on all
sides. Solid flat background colour #0B1E2B, empty, with no scenery, no water, no
ground, no sparkles, no text, no letters, no logo and no watermark. Crisp vector edges,
high contrast, sticker-like, designed to stay readable when scaled down to a
48-pixel avatar.
```

## 2. BLOK NEGATIF (salin persis)

```
photorealistic, 3d render, realistic fish anatomy, detailed scales, gradient mesh,
soft shading, drop shadow, outer glow, blur, noise, busy background, underwater scene,
bubbles unless specified, text, letters, numbers, watermark, signature, more than one
character, human hands, extra fins, extra eyes, spikes on a calm character
```

---

## 3. BLOK KARAKTER

### 3.1 Guardian — `HEALTH_FACTOR`

```
The character is Fugu Guardian, a calm night-watchman pufferfish. Its body is wider
than it is tall, roughly a 1.15 to 1 ratio, giving it a low sturdy stance. A smooth
half-circle shell plate is fused onto its back so that the top edge of its silhouette
is a straight horizontal line, unlike any other character in the set. Body colour
#0072B2, belly colour #58A9E0 with a single curved dividing line, shell plate colour
#E3ECEF outlined in #05121A. Thick eyebrows angled gently down toward the centre,
reading as focused rather than angry. On the right edge of the shell plate there is a
narrow vertical gauge bar filled from the bottom.
```

### 3.2 Rebalancer — `REBALANCING`

```
The character is Fugu Rebalancer, a tidy perfectionist pufferfish. Its body is slightly
taller than wide, roughly a 1 to 1.1 ratio, like a standing egg. Its two pectoral fins
are unusually large and held straight out horizontally on both sides at exactly the same
height, like the arms of a balance scale, so the silhouette extends left and right past
the body. Its tail is short and small so the outstretched fins stay the dominant shape.
Body colour #CC79A7, belly colour #E9A8CC, fin tips #F4F8F9. One small round bubble
floats at the tip of each fin and the left bubble is clearly larger than the right one.
```

### 3.3 Grid — `GRID`

```
The character is Fugu Grid, a cold methodical pufferfish. Its body is a square-ish
1 to 1 egg, and a single sharp triangular dorsal fin points straight up from the top of
its head, the only sharp angle in the set. Its fan tail is cut off flat rather than
rounded. A thin rectangular dark visor runs horizontally across both eyes as one
continuous straight bar. A faint 3 by 3 square grid pattern is printed on the body in
#05121A at 20 percent opacity, and exactly one cell of that grid is filled solid.
Body colour #56B4E9, belly colour #8FD3F4.
```

### 3.4 Yield — `YIELD`

```
The character is Fugu Yield, a friendly slightly greedy forager pufferfish. Its body is
the roundest and fullest of the set, about 8 percent larger than the others even when
calm, with a 1.05 to 1 ratio. A single leaf-shaped dorsal fin curves diagonally
backwards from the upper right of its head, giving the silhouette a slanted bump.
Body colour #E69F00, belly colour #FFC24D. Three small round bubbles rise in a
diagonal line behind its tail, each one smaller than the one below it.
```

---

## 4. BLOK TINGKAT (lima)

Berlaku untuk keempat karakter. Ukuran dinyatakan relatif terhadap kotak 100 unit.

### Tingkat 1 — Tenang
```
The fish is at bloat level 1 of 5, calm. Its body is at its slimmest, about 56 units
wide and 52 units tall inside a 100 unit square. No spikes at all; the back is
completely smooth. The eyes are relaxed with slightly lowered lids and the omega mouth
is small and neutral. A thin solid arc, 2 units thick, in colour #009E73, curves around
the upper 40 percent of the character like a partial ring.
```

### Tingkat 2 — Awas
```
The fish is at bloat level 2 of 5, watchful. Its body has puffed to about 64 units wide
and 58 units tall inside a 100 unit square. Short blunt-tipped spikes have emerged about
a quarter of their length along five rows following the back and sides. One eyebrow is
raised and the eyes are a little wider. A solid ring 3 units thick in colour #F0E442
fully surrounds the character, with a single small notch cut out of it at the twelve
o'clock position.
```

### Tingkat 3 — Tegang
```
The fish is at bloat level 3 of 5, strained. Its body has puffed to about 72 units wide
and 66 units tall inside a 100 unit square. The spikes are extended about 60 percent and
their tips are becoming sharp. The eyes are narrowed, the cheeks are visibly puffed and
the mouth is pursed as if holding a breath. A dashed ring 3 units thick in colour
#E69F00 fully surrounds the character, with dashes 6 units long separated by 4 unit gaps.
```

### Tingkat 4 — Kritis
```
The fish is at bloat level 4 of 5, critical. Its body has puffed to about 80 units wide
and 74 units tall inside a 100 unit square. The spikes are fully extended and sharply
pointed. The eyes are wide open with small pupils, one bead of sweat sits at the
temple, and the mouth is open in a small circle. Two concentric solid rings, each 2
units thick and 2 units apart, in colour #D55E00, surround the character.
```

### Tingkat 5 — Gawat
```
The fish is at bloat level 5 of 5, an emergency. Its body is enormous, about 84 units
wide and 82 units tall inside a 100 unit square, so that it touches and is very slightly
cropped by the edges of the square frame; it no longer fits. The spikes are fully
extended and a second row of shorter spikes has appeared between the main rows. Both
eyes are drawn as simple crosses instead of circles and the mouth hangs wide open. The
character is surrounded by a thick warning ring made of 45 degree diagonal hazard
stripes, each stripe 4 units wide, alternating between #F4F8F9 and #05121A in strong
black and white contrast.
```

---

## 5. Prompt aset merek

### 5.1 Maskot utama / logo

```
[BLOK GAYA] The character is the Fugugent mascot, a friendly cartoon pufferfish shown at
a calm, slightly puffed state, about 62 units wide inside a 100 unit square. It has no
shell, no visor, no leaf fin and no outstretched scale arms; it is the neutral parent
form of the family. Body colour #0E7C86, belly colour #9CE9EE. Its spikes are short,
rounded and friendly, extended about 20 percent, evenly spaced in five rows. The eyes
are large, round and confident, looking slightly toward the viewer. A single thin ring
in colour #5FD4DC, 2 units thick, orbits the character at a shallow angle, suggesting a
boundary or permission perimeter rather than a halo. Perfectly symmetrical enough to
work as an app icon, with the silhouette readable as one clean shape.
```

Turunan yang harus dibuat dari file yang sama, jangan digenerate ulang:
`logo-mark.svg` (jiplak vektor), `logo-lockup.svg` (maskot + kata "Fugugent"),
`logo-mono.svg` (satu warna, untuk sponsor sheet).

### 5.2 Favicon

Favicon **tidak digenerate dari nol** — ia dipangkas dari maskot utama. Kalau memang
harus digenerate, ini promptnya:

```
[BLOK GAYA] Extreme simplification for a 16 by 16 pixel favicon: only the head and upper
body of the Fugugent pufferfish mascot, cropped square, filling 92 percent of the frame.
Body colour #0E7C86 on a solid #05121A background. Only four shapes are allowed: the
body silhouette, two eyes, and four short rounded spikes on the top edge. No belly line,
no mouth, no ring, no fins, no tail, no detail of any kind. Maximum contrast between the
body and the background so the shape survives at 16 pixels.
```

Uji sebelum diterima: perkecil ke 16 px, dan lihat di tab browser bersebelahan dengan
tab lain. Kalau tidak bisa dibedakan dari lingkaran biasa, tambah duri, jangan tambah
detail.

### 5.3 OG image (`1200×630`)

Rasio 16:9, lalu dipotong ke 1200×630. Teks **jangan** dibuat oleh model gambar —
render teksnya di lapisan Next.js (`opengraph-image.tsx`) di atas gambar ini.

```
Flat vector illustration banner, wide 16 by 9 composition, in a clean modern app style
with thick uniform #05121A outlines, completely flat fills and no gradients. Four cartoon
pufferfish characters float in a horizontal row on a solid deep navy #05121A background,
lit from above, evenly spaced, each one facing right in three-quarter view. From left to
right: a wide low blue pufferfish with a flat half-circle shell on its back in #0072B2;
a pink pufferfish with two large fins held straight out horizontally in #CC79A7; a light
blue pufferfish with a sharp triangular dorsal fin and a dark horizontal visor across its
eyes in #56B4E9; and a round amber pufferfish with a leaf-shaped dorsal fin in #E69F00.
Each character is progressively more puffed than the one before it, so the row reads as a
sequence from slim to enormous. Faint thin #14303F horizontal guide lines run behind them.
The entire left third of the image is empty flat background reserved for text. No text,
no letters, no numbers, no logo, no watermark.
```

### 5.4 Kartu kosong / fallback pihak ketiga

```
[BLOK GAYA] The character is a neutral fallback pufferfish with no distinguishing
accessories at all: no shell, no visor, no leaf fin, no outstretched arms, no bubbles.
Plain egg-shaped body, about 60 units wide inside a 100 unit square, spikes retracted.
Body colour #6E8C6E, belly 18 percent lighter. Eyes are open but neutral, mouth is a
small flat line rather than an omega shape, giving it a deliberately generic and
unremarkable presence next to the four named characters.
```

---

## 6. Daftar aset minimum

| Berkas | Prompt |
|---|---|
| `guardian.svg` | GAYA + 3.1 + Tingkat 1 |
| `rebalancer.svg` | GAYA + 3.2 + Tingkat 1 |
| `grid.svg` | GAYA + 3.3 + Tingkat 1 |
| `yield.svg` | GAYA + 3.4 + Tingkat 1 |
| `guardian-kembung-1.svg` … `-5.svg` | GAYA + 3.1 + Tingkat 1…5 |
| `maskot.svg` | §5.1 |
| `favicon-src.svg` | §5.2 |
| `og.svg` | §5.3 |
| `fallback.svg` | §5.4 |

> Aset yang benar-benar ada di repo saat ini adalah **SVG hasil gambar tangan**
> (`docs/brand/generate-svg.py`), bukan keluaran model. Alasannya ada di
> `hasil.md`. Prompt di atas tetap berlaku bila nanti ingin membuat versi
> ilustratif yang lebih kaya untuk materi pemasaran.

Semua disimpan di `landingpage/public/brand/`, dicatat di `docs/brand/hasil.md`.

---

## 7. Kriteria terima

Sebuah gambar **ditolak** kalau salah satu dari ini terjadi — tidak peduli seberapa
bagus rupanya:

1. Durinya muncul pada tingkat 1. Tingkat 1 harus mulus; kalau tidak, seluruh skala
   kehilangan titik nolnya.
2. Tingkat 5 tidak terpotong bingkai, atau matanya masih lingkaran.
3. Ada teks, angka, atau tanda air di dalam gambar.
4. Ada gradasi, cahaya, atau bayangan lembut.
5. Warna badan meleset dari hex yang ditentukan lebih dari sekilas mata bisa terima —
   periksa dengan color picker, jangan dengan perasaan.
6. Setelah diubah ke grayscale dan dikecilkan ke 48 px, karakternya tertukar dengan
   karakter lain dalam set.

Gambar model generatif **tidak akan** presisi pada hex dan rasio. Itu sudah
diperhitungkan: aset ini dipakai untuk halaman landing, OG image, dan materi presentasi.
**Avatar 48 px di marketplace harus SVG yang digambar tangan** mengikuti spec di
`karakter.md`, bukan PNG hasil generate — karena di ukuran itu presisi geometri adalah
segalanya, dan karena avatar harus bisa berubah tingkat kembungnya secara langsung
lewat CSS/props.
