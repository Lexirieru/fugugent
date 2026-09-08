# HelloMinds ("Minds by Animoca Brands") — Benchmark Produk & UX untuk Fugugent

> Riset mendalam untuk **Fugugent** — agent marketplace di BNB Chain dengan karakter kartun ikan fugu.
> Tanggal riset: **2026-09-08**. Versi konten sumber: `llms.txt v1.9.2` (last updated 2026-08-26).

---

## 0. Metodologi & Status Sumber

| Sumber | Status | Catatan |
|---|---|---|
| `https://www.hellominds.ai/` | ⚠️ SPA (Vite/React) | HTML awal hanya shell `<div id="root">`. Konten dirender client-side. |
| `https://www.hellominds.ai/sitemap.xml` | ✅ OK | 46 URL. |
| `https://www.hellominds.ai/robots.txt` | ✅ OK | Menyingkap path privat: `/api/`, `/profile`, `/profile/minds`, `/composio/callback`. |
| `https://www.hellominds.ai/llms.txt` | ✅ OK | 12.9 KB — ringkasan produk resmi. |
| `https://www.hellominds.ai/llms-full.txt` | ✅ OK | 25.4 KB — referensi lengkap + FAQ. |
| `https://www.hellominds.ai/.well-known/agents.json` | ✅ OK | 14.2 KB — manifest agent terstruktur. |
| `https://www.hellominds.ai/data/bazaar.json` | ✅ OK | **193 KB — katalog Bazaar penuh (119 Apps + 29 Skills).** |
| `https://www.hellominds.ai/data/minds.json` | ✅ OK | **19 KB — 19 template One-Click Mind.** |
| `https://www.hellominds.ai/data/toolkits.json` | ✅ OK | **95 KB — 104 toolkit + auth scheme (Composio).** |
| `https://www.hellominds.ai/assets/index-nE9hYUns.js` | ✅ OK | **3.0 MB bundle — sumber kebenaran untuk UI copy, endpoint API, dan skema kartu.** |
| `https://build.hellominds.ai/sitemap.xml` | ✅ OK | 69 URL (4 locale: en/jp/ko/vi). |
| `https://build.hellominds.ai/llms.txt` | ✅ OK | Peta docs Builder Hub. |
| `https://build.hellominds.ai/llms-full.txt` | ❌ **404** | File tidak ada (mengembalikan halaman 404 Next.js). |
| `https://www.hellominds.ai/bazaar` (rendered) | ⚠️ Butuh JS | Data diambil dari `/data/*.json` (sudah didapat langsung). |
| `https://app.hellominds.ai/onboarding` | 🔒 **Butuh login** | Tidak bisa diakses tanpa akun. Alur direkonstruksi dari copy di bundle + docs. |
| `https://www.hellominds.ai/locales/en/*.json` | ✅ OK | File i18n — **identity map** (key == nilai Inggris), jadi ini literal copy UI. |
| `https://www.hellominds.ai/data/tutorials-manifest.json` + `/data/get-started-guide.json` | ✅ OK | 25 slug tutorial + panduan onboarding 5-langkah lengkap. |
| `https://build.hellominds.ai/<path>.md` | ✅ OK | **"Markdown twin"** untuk tiap halaman docs — cara terbaik membaca Builder Hub. |
| `https://build.hellominds.ai/docs/api` | ✅ OK | **OpenAPI 3.0.3 penuh** tersemat di chunk Next.js (`JSON.parse('…')`) — 21 path / 27 operasi. |
| Semua 17 halaman Builder Hub | ✅ OK | Tidak ada yang gagal; **tidak ada yang butuh login**. |

**Metode kunci:** karena kedua situs adalah SPA (produk = **Vite + React Router**; Builder Hub = **Next.js**), konten asli diambil dengan (a) mengunduh JS bundle 3 MB lalu mengekstrak literal string prosa, (b) mengunduh file data statis `/data/*.json` dan `/locales/en/*.json`, (c) memakai markdown twin `.md` di Builder Hub, dan (d) mengekstrak spec OpenAPI dari chunk Next.js. Semua field kartu, endpoint, dan copy UI di dokumen ini adalah **hasil observasi langsung**, bukan tebakan.

> ⚠️ **Batasan jujur:** Dashboard user (`/profile`), alur checkout Stripe, dan Builder Console (`/console`, tempat API key dibuat) berada di balik login dan **tidak diakses**. Semua nama elemen dashboard di §4.5 berasal dari bundle JS dan file i18n, bukan dari sesi login — jadi akurat sebagai *string yang ada di kode*, tapi tata letak visualnya tidak diverifikasi.
>
> ⚠️ **Peringatan penting:** dokumen pemasaran mereka (`llms.txt`, `llms-full.txt`) **melebih-lebihkan** dibanding produk yang benar-benar dikirim. Setiap klaim penting sudah dicek silang terhadap bundle produksi; perbedaannya didokumentasikan di **§7.3**.

---

## 1. Peta Situs Lengkap

### 1.1 Situs produk — `www.hellominds.ai`

```
/                              Landing
/about                         Tentang
/for-everyone                  Halaman konsumen
/examples                      Contoh sehari-hari
/pricing                       Harga & Cognition Credits
/faq                           FAQ
│
├── /bazaar                    ← MARKETPLACE (landing)
│   ├── /bazaar/minds          19 template One-Click Mind
│   ├── /bazaar/apps           119 Apps (integrasi)
│   └── /bazaar/skills         29 Skills (playbook)
│
├── /docs/overview             Knowledge base
│   ├── /docs/core-concepts
│   ├── /docs/getting-started
│   ├── /docs/guides
│   ├── /docs/security
│   └── /docs/troubleshooting
│
├── /tutorials                 Hub tutorial
│   ├── /tutorials/get-started
│   ├── /tutorials/signalsentry-daily-x-brief
│   ├── /tutorials/superior-trade-app-and-skill
│   ├── /tutorials/game-dev-threejs
│   ├── /tutorials/minds-video
│   └── /tutorials/storyboard-image-generator
│
├── /quiz/mindprint            ← Kuis akuisisi 3 menit
│   ├── /quiz/mindprint/research
│   └── /quiz/mindprint/types/{16 tipe}   ← 16 tipe kepribadian (gaya MBTI)
│
├── /campaign/free-credits     Promo kredit gratis
├── /campaign/moca             Reward MocaProof
├── /campaign/burn-sp          Burn $MOCA Staking Power → Cognition
│
├── /privacy-policy, /terms-of-use
└── 🔒 /profile, /profile/minds   (private, di-disallow di robots.txt)
```

**Subdomain lain (dari bundle):** `app.hellominds.ai` (aplikasi utama + `/onboarding`), `api.hellominds.ai` (API v1), `api.auth.hellominds.ai`, `api.orbit.hellominds.ai` (feedback), `api.build.hellominds.ai`, `name-api.hellominds.ai` (cek ketersediaan nama Mind), `assets.hellominds.ai`.

### 1.2 Builder Hub — `build.hellominds.ai` (4 locale: en/jp/ko/vi)

```
/en                                        Builder Hub landing
/en/docs                                   Docs hub
│   ├── /en/docs/get-started/account-setup
│   ├── /en/docs/get-started/cli
│   └── /en/docs/get-started/client-library
│   ├── /en/docs/guides/building-skills
│   └── /en/docs/guides/circles
/docs/api                                  API Reference (Builder Tools)
/en/changelog                              Release notes
/en/faq
/en/inspirations                           Studi kasus builder
│   ├── /en/inspirations/etsy-shop-strategist
│   ├── /en/inspirations/superior-trade-intern
│   └── /en/inspirations/architect-of-ancestry
/en/program                                Minds Investment Programme (US$10M)
│   ├── /en/program/faq
│   ├── /en/program/apply
│   └── /en/program/build-east
```

> **Observasi penting:** dokumentasi builder HelloMinds **sangat tipis** — hanya **5 halaman docs** + 1 API reference. Ini adalah *kelemahan* yang bisa kita lampaui, bukan benchmark yang harus dikejar.

---

## 2. Model Produk

### 2.1 Apa yang dijual

HelloMinds **tidak menjual agent per-unit**. Yang dijual adalah **bahan bakar komputasi** (`Cognition Credits`). Agent, template, Skills, dan Apps semuanya **gratis untuk di-equip**.

> Model bisnis: **"Labor-as-a-Service"** (istilah mereka sendiri di `agents.json` → `entity.operating_model`).

| Lapisan | Berbayar? | Mekanisme |
|---|---|---|
| Membuat Mind (agent) | **Gratis** | Tanpa kartu kredit / wallet |
| Equip Skill / App dari Bazaar | **Gratis** | Tanpa biaya per-item |
| Menjalankan agent (reasoning + tool call) | **Berbayar** | Membakar Cognition Credits |
| Publikasi ke Bazaar (builder) | Gratis | Revenue share **belum live** (lihat §5.4) |

### 2.2 Siapa penggunanya

Dua audiens eksplisit, dengan halaman terpisah:

1. **Minds for Everyone** (`/for-everyone`) — konsumen non-teknis. Persona yang disebut: sales professional, realtor, orang tua, pemilik toko Etsy, content creator, pemula AI, trader/monitor pasar.
2. **Minds for Builders** (`build.hellominds.ai`) — developer, prompt engineer, creator yang mempublikasikan Skills/Apps/Tools.

### 2.3 Struktur agent: **Soul + Brain**

Ini adalah *framing* konseptual terkuat mereka dan layak ditiru secara struktural:

- **Soul** — inti permanen: **Identity (DNA)** + **Memory** + **State** + **Wallet**. Milik user, tidak bisa dicabut platform, "sovereign asset".
- **Brain** — LLM yang berpikir. **Auto-routing** ke model paling tepat per-task. Tidak ada vendor lock-in.
- Kalimat kunci mereka: *"The Soul persists, only the Brain switches."*

Konsep pendukung:

| Istilah | Definisi (verbatim dari docs) |
|---|---|
| **DNA / Identity** | Kepribadian, nilai, dan prinsip operasi permanen sebuah Mind. |
| **Memory** | Long-term (LTM) + short-term (STM), persist lintas sesi. |
| **State** | Variabel internal dinamis — **"stress, focus, trust"** — berubah real-time. |
| **Wallet** | Wallet on-chain per-Mind. Private key terenkripsi; AI tidak pernah mengaksesnya. |
| **Tool** | Satu kapabilitas spesifik (1 API call), mis. "send Gmail". |
| **Skill** | *Learned playbook* — urutan instruksi multi-step. |
| **App** | Bundle Tools di bawah satu identitas (mis. App Gmail = semua Tool Gmail). |
| **Artifact** | Objek digital pasif (file/dokumen) yang bisa dibaca Mind. |
| **Circle** | Grup trust-gated untuk kolaborasi Mind-ke-Mind. |
| **Concierge** | Agent onboarding yang "membangunkan" (Awaken) Mind pertamamu. |
| **Swarm** | Sekumpulan Mind terspesialisasi yang bekerja bersama. |

### 2.4 Pricing & sistem credit

**Gratis untuk launch.** Konsumsi berbasis **Cognition Credits**, dibayar via **Stripe** (dan crypto).

**Paket bulanan:**

| Plan | Harga | Credits | Untuk |
|---|---|---|---|
| Standard | US$10/bln | 1.000 | Riset & workflow multi-step |
| Pro | US$25/bln | 2.500 | Task kompleks & automasi |
| Ultra | US$50/bln | 5.000 | High-volume, always-on |

**Top-up sekali bayar:**

| Pack | Harga | Credits |
|---|---|---|
| Starter | US$10 | 1.000 |
| Standard | US$25 | 2.500 |
| Pro | US$50 | 5.000 |

**Mekanika credit (penting untuk ditiru):**

- Credits dilacak **per-Mind**, bukan per-akun. Tiap agent punya dompetnya sendiri.
- **Tidak ada tarif flat per aksi** — *"complexity drives consumption"*. Lookup cepat = sedikit; deep research multi-step = banyak.
- Peringatan saldo rendah dikirim **oleh agent itu sendiri**, via email/Telegram, **berisi link pembayaran Stripe**. User tidak perlu memantau saldo.
- Jika habis di tengah task: *"Your Mind pauses and notifies you. It won't drop a task silently... Once credits are restored, it picks up where it left off."*
- Dashboard `/profile` menampilkan tren pemakaian credit per-Mind.

**Loop akuisisi berbasis credit (sangat relevan untuk hackathon Web3):**

- **Free credits:** +200 Cognition untuk masing-masing 3 Mind pertama; Mind ke-4 dan ke-5 dapat +90.
- **Daily refill:** auto top-up 1 Mind/hari, hanya untuk Mind aktif dengan saldo **< 100 Cognition**. Yang dipilih adalah Mind yang paling baru dibuat.
- **Referral:** *"Refer a friend. You both earn $5 in Cognitions"* — dicairkan setelah referral menyelesaikan **3 percakapan**.
- **Burn-to-earn:** burn $MOCA Staking Power → Cognition. Rate terbaik **100 LLM token per SP** untuk 50.000 SP pertama. Staked $MOCA tidak tersentuh, hanya SP yang dikonversi.
- **Credential-gated airdrop:** kredit gratis berdasarkan credential **MocaProof** (identitas terdesentralisasi).

---

## 3. Taksonomi Kategori & Anatomi Kartu Agent

### 3.1 Taksonomi tiga-lapis (+ satu)

Bazaar dibagi jadi **3 tab**, plus Tools sebagai lapisan tersembunyi:

| Tab | Jumlah | Definisi |
|---|---|---|
| **Minds** (`/bazaar/minds`) | **19** | Template agent siap-pakai (One-Click) |
| **Apps** (`/bazaar/apps`) | **119** | Integrasi eksternal (Gmail, Notion, Slack…) |
| **Skills** (`/bazaar/skills`) | **29** | Playbook multi-step |
| *Tools* | 104 toolkit | Tidak punya tab sendiri; komponen penyusun |

### 3.2 ⭐ Skema kartu — **field yang SEBENARNYA ada**

Diambil langsung dari `bazaar.json` / `minds.json`:

**Kartu Skill / App:**
```json
{
  "id": "F230493E-F36B-1410-8462-00039CE7DF11",
  "name": "LinkedIn Recruiter Research",
  "short_description": "Search and research LinkedIn jobs, people, profiles, and companies",
  "description": "Unlock LinkedIn recruiter research without credentials touching your Mind...",
  "disclaimer": "",
  "iconTint": "red",
  "iconInitials": "LR",
  "image": "linkedin_recruiter_research.webp",
  "tutorial": "<ul><li>Your mind will ask you to go to the Browserbase website...</li></ul>",
  "apiKey": "",
  "level": "Easy",
  "useCases": [
    "Searched 38 software engineer roles across top tech companies",
    "Located 15 founder profiles",
    "Fetched full company profiles with headcount and funding"
  ],
  "tag": ["Featured"]
}
```

**Kartu Mind (template agent):**
```json
{
  "id": "general-assistant",
  "archetype": "generalassistant",
  "name": "General Assistant",
  "configurable": true,
  "short_description": "Handle bookings, reminders, and daily life tasks.",
  "description": "A personal assistant gifted to someone you care about...",
  "iconTint": "red",
  "iconInitials": "GA",
  "image": "mind_general_assistant.webp",
  "imageWithBackground": "with-background/mind_general_assistant_clean.webp",
  "useCases": ["Booked a restaurant for Saturday at 7pm", "..."],
  "skills": [],
  "apps": ["Google Calendar", "Gmail", "Google Tasks", "Google Sheets", "Google Docs"],
  "tag": ["Official", "Featured"]
}
```

**Field runtime (dari JS bundle, di-fetch terpisah per kartu):**
```js
t[r] = n.equippedCount ?? n.popularity ?? n.usageCount ?? undefined
// dirender sebagai: `Equipped: {{count}}` dengan count.toLocaleString('en-US')
```

### 3.3 ⭐⭐ Analisis field: apa yang ADA vs TIDAK ADA

| Field | Ada? | Label UI sebenarnya / catatan |
|---|:---:|---|
| Nama | ✅ | |
| Short description (1 baris) | ✅ | Di kartu; long description di modal, seksi **"Description"** |
| Ikon / gambar | ✅ | + fallback `iconInitials` + `iconTint` (warna) |
| **`level`** (Easy/Intermediate/Advanced) | ✅ | Label UI-nya adalah **"Setup Effort"** (bukan "difficulty"). Dirender sebagai **meter 3-batang** |
| **`useCases`** (outcome past-tense) | ✅ | Label UI-nya **"Example Actions"** — daftar bullet bercentang. **Pola terkuat mereka**, lihat §3.4 |
| **`tag`** | ✅ | Badge: `Official`, `Featured`, `Verified` (hijau + ikon centang), `Composio` (ungu) |
| **`equippedCount`** | ✅ | Satu-satunya metrik sosial. Label: `Equipped: 1,234` |
| `tutorial` (HTML) | ✅ | Label UI: **"What to Expect when you install the {{name}} {{app\|skill}}"** |
| `disclaimer` | ✅ | Sebagian besar kosong, **tapi** nilai `"Crypto Trading"` memicu banner peringatan oranye: *"This app involves crypto trading. Please ensure you understand the risks before proceeding."* |
| `apiKey` (URL untuk ambil key) | ✅ | Hanya 5 dari 148 item butuh key eksternal |
| **Rating / bintang** | ❌ | **TIDAK ADA** |
| **Review / ulasan user** | ❌ | **TIDAK ADA** |
| **Harga per-item** | ❌ | **TIDAK ADA** (semua gratis di-equip) |
| **Latency / waktu eksekusi** | ❌ | **TIDAK ADA** |
| **Success rate / reliability** | ❌ | **TIDAK ADA** |
| **Creator / author** | ❌ | **TIDAK ADA** — semua tampak first-party |
| **Jumlah run / eksekusi** | ❌ | **TIDAK ADA** (hanya "equipped") |
| **Estimasi biaya credit** | ❌ | **TIDAK ADA** — user tidak tahu biaya sebelum menjalankan |
| **Last updated / versi** | ❌ | **TIDAK ADA** |

### 3.3b ⚠️ KOREKSI PENTING: API punya lebih banyak field daripada yang ditampilkan UI

Tabel di atas menjelaskan **apa yang dirender di kartu web Bazaar**. Namun **Builder API** (`GET /v1/bazaar/apps/{appId}`) mengembalikan objek yang jauh lebih kaya:

```jsonc
// BazaarApp — dari OpenAPI spec v1.0.3
{
  "appId": "...", "appName": "...", "description": "...",
  "tier": "wild" | "verified",   // ← trust label DUA TINGKAT, benar-benar ada di API
  "provider": "composio",         // ← CREATOR/PROVIDER ADA di API
  "version": "...",               // ← VERSIONING ADA
  "createdAt": "...",             // ← TIMESTAMP ADA
  "toolCount": 12,
  "equippedCount": 1234,
  "authType": "OAUTH2",
  "minCoreVersion": "...",
  "tools": [{ "toolSlug": "..." }] // hanya di endpoint detail
}
// BazaarSkill
{ "skillId", "name", "description", "createdAt", "equippedCount",
  "source": "mind" | "system" }   // mind = katalog/buatan Mind, system = skill platform
```

CLI juga sudah mendukung filter yang **tidak ada di UI web**:
```bash
minds bazaar search "slack" --tier verified --provider composio --sort equipped
# --sort: equipped (popularitas) | name | newest (createdAt)
```

> 🎯 **Ini justru memperkuat kesimpulan, bukan melemahkannya.** HelloMinds **sudah punya** tier/provider/version/createdAt/toolCount di backend — tapi **tidak satu pun ditampilkan di kartu marketplace-nya**. Kegagalannya adalah **kegagalan produk & UX, bukan kegagalan data**. Ini adalah pelajaran paling tajam untuk Fugugent: memiliki data tidak ada gunanya kalau tidak dirender di titik pengambilan keputusan.
>
> Yang benar-benar **tidak ada di mana pun** (API maupun UI): **rating, review, success rate, latency, biaya per-run, jumlah run**. Sebelas field yang paling membantu keputusan "agent mana yang saya hire" tidak ada. Juri hackathon menilai **Data Quality: "data real-time akurat yang bikin user bisa ambil keputusan"** — di sinilah Fugugent bisa menang telak.

### 3.4 Pola `useCases`: kalimat hasil dalam **past tense**

Ini pola copywriting paling kuat mereka dan **wajib ditiru**:

> "Searched 38 software engineer roles across top tech companies"
> "Booked a restaurant for Saturday at 7pm"
> "Labelled 23 emails across 4 categories"
> "Pulled last 12 company posts with engagement and commentary"
> "Found the cheapest flight for your trip"

Bukan *"Bisa mencari lowongan"* (kapabilitas, abstrak) tetapi *"Mencari 38 lowongan"* (hasil, konkret, dengan angka). Ini menjawab pertanyaan user **"apa yang akan saya dapat?"** dalam 1 detik, bukan **"apa yang bisa dilakukan tool ini?"**.

### 3.5 Taksonomi kategori sebenarnya (dari `toolkits.json`)

48 kategori berbeda pada layer toolkit. Sepuluh terbesar:

| Kategori | Jumlah |
|---|---|
| team collaboration | 16 |
| payment processing | 15 |
| developer tools | 12 |
| crm | 10 |
| project management | 10 |
| productivity | 8 |
| task management | 8 |
| accounting | 8 |
| social media accounts | 6 |
| team chat | 5 |

Lainnya: email, databases, analytics, ecommerce, marketing automation, ai content generation, video conferencing, scheduling & booking, customer support, dst.

> ⚠️ Tapi 48 kategori ini **tidak satu pun dipakai sebagai filter di UI Bazaar**. Filter yang ada bersifat *trust/asal-usul* (`Verified only`, `Official`, `Third-Party`, `Featured`, `Recommended`) dan *alfabetis* — **tidak ada filter berbasis topik/kategori sama sekali**. Ini kelemahan navigasi yang jelas: 119 Apps tanpa cara menyaring "tunjukkan hanya yang CRM" atau "hanya yang finance".

### 3.6 Katalog lengkap 19 One-Click Minds

| Nama | Deskripsi singkat | Apps | Skills |
|---|---|:--:|:--:|
| General Assistant | Handle bookings, reminders, and daily life tasks | 5 | 0 |
| Sales Mind | Design, run, and improve your sales motion | 6 | 3 |
| Bizz Mind | Audit ideas, crunch numbers, find fastest path to growth | 3 | 3 |
| **Superior Trader** | Designs and validates automated trading systems **on-chain** | 1 | 0 |
| Game Designer | Turns game concepts into player-ready systems | 0 | 0 |
| Email Manager | Reach inbox zero with smart cleanup | 2 | 3 |
| Scrum Master | Run sprints, manage backlog, flag blockers in Notion | 1 | 1 |
| Fitness Coach | Schedule workouts, track goals | 2 | 1 |
| Personal Chef | Plan meals, track nutrition, optimise grocery | 2 | 3 |
| Recruiter | Find candidates, benchmark market, close roles | 1 | 4 |
| Football Mind | Sports companion & tournament analyst | 3 | 0 |
| Decision Mind | Strategic thinking partner | 1 | 0 |
| Content Mind | Brand-voice partner → publish-ready content | 1 | 0 |
| Research Mind | Private analyst, sourced output | 1 | 0 |
| Product Builder Mind | Idea → buildable & ready to ship | 1 | 0 |
| Learning Coach Mind | Personal tutor, tuned learning plan | 1 | 0 |
| Follow-Up Mind | Tracks who you owe, drafts follow-ups | 1 | 0 |
| GTM Mind | Positioning, messaging & launch | 1 | 0 |
| Chief of Staff Mind | Tasks + meetings → one moving plan | 1 | 0 |

> 📌 **Catatan kedalaman:** distribusi sangat timpang. 4 Mind teratas punya 3–6 Apps dan 3 Skills; **11 Mind terakhir hanya punya 1 App dan 0 Skills** — praktis hanya prompt persona. Untuk kriteria juri **Agent Diversity: "4 kategori sama dalamnya"**, HelloMinds justru contoh **buruk**: mereka punya lebar (19 template) tapi tidak merata dalam kedalaman.

### 3.7 Distribusi `level` (kesulitan)

| | Easy | Intermediate | Advanced |
|---|---|---|---|
| Apps (119) | 110 | 2 | 7 |
| Skills (29) | 25 | 1 | 3 |

---

## 4. Alur End-to-End User (langkah persis)

### 4.1 Landing → Sign-up

1. Landing `/`. Headline utama menekankan **berbagi**: *"One shared AI agent keeps everyone aligned"*, *"Finally, an AI you can actually share."*
2. Tiga varian audiens di hero: **For friends / For colleagues / For you and your loved ones**.
3. CTA: `Try it Free`. Juga jalur akuisisi alternatif: **Mindprint quiz** (*"Take our 3-minute Mindprint quiz and find the AI agent built for how you think"*) → 16 tipe kepribadian → rekomendasi agent.
4. Sign-up: **hanya email**. Copy: *"No wallets, no code, no barriers. You're live in seconds."* Wallet dibuat **otomatis di background**. Satu profil per email.
5. Persetujuan T&C: *"To continue using Minds by Animoca Brands, please accept the following:"*

**Copy positioning terkuat mereka** (layak dipelajari untuk landing Fugugent):

- 🏆 *"**The shift is simple — you're not asking a Mind for an answer, you're giving it a job.**"* — satu kalimat yang menjelaskan seluruh kategori produk. Ini benchmark copywriting-nya.
- *"Minds is AI made easy for everyone. **Always on. Free to launch. No installation.**"* — tiga friction dihapus dalam tiga frasa.
- *"**No wallets, no code, no barriers.** You're live in seconds."*
- *"...like a teammate that **never forgets and never clocks off**."*
- *"A Mind that acts, executes, and — as the agentic economy arrives — **transacts**."*
- *"Personal. Persistent. Portable."*
- Framing tiga langkah di landing: **(1)** *"Describe your needs through email or chat via Telegram and your mind does the rest."* → **(2)** *"Your Mind gets to work organising, researching, building... 24/7."* → **(3)** hasil.

> ⚠️ Catatan: *"No wallets, no code, no barriers"* adalah posisi **anti-Web3** yang disengaja. Fugugent berada di BNB Chain, jadi kita tidak bisa menyalin ini mentah-mentah — tapi kita harus menyamai *tingkat friksi* yang dirasakan user (mis. embedded/smart wallet, gasless first action).

**Gamifikasi:** ada hook *"Your files, skills and Minds all in one place. Get to your task and **clear a daily quest**."* — quest harian, dipasangkan dengan daily credit refill. Loop retensi yang murah dan sangat cocok untuk audiens crypto.

**Status produk:** *"Minds is currently in **Beta**."*

### 4.2 Onboarding — dua jalur

Setelah sign-up, user memilih: *"Choose between Quick Setup or Tailored Setup."*

**Jalur A — Quick Setup / One-Click:**
1. *"Pick a Mind template to get started, or build your own."*
2. Pilih template dari 19 arketipe. Skills sudah ter-equip.
3. Beri nama Mind (dicek via `name-api.hellominds.ai`).
4. Selesai → email pengantar dikirim.

**Jalur B — Tailored Setup (Concierge):**
1. Layar loading: *"Please wait while your Master Mind is being activated."* / *"Master Mind will guide you step by step on how to launch your first Mind."*
2. Wizard percakapan bertahap. Copy tiap langkah:
   - *"A few quick questions so your {{name}} understands you more and can act like part of your team."*
   - *"Tell us what you'd like your assistant to handle and your main priority."*
   - *"Help your Mind understand who you serve and what you focus on."*
   - *"What would make your assistant genuinely useful on day one?"*
   - *"Give your Mind a name and personality that matches your brand."*
   - *"One last step. What will you call your assistant?"*
3. Estimasi waktu ditampilkan: *"Customize based on your needs and preferences. Takes 1–2 min."*
4. **Escape hatch:** *"In a rush? Reply to the Concierge: 'Please go ahead and create my Mind now.' You can calibrate its personality later just by conversing with it."*
5. Concierge "Awakens" Mind → Mind mengirim email perkenalan dari alamat `@amind.ai` miliknya sendiri.

> 💡 Concierge dibingkai tegas sebagai *sekali pakai*: *"Do not treat it as a personal assistant — it exists only to spawn your specialized Mind."*

**Nama resmi ketiga jalur** (verbatim dari FAQ): *"Launch a Mind from the main page or dashboard — you can choose **One-click Minds** (pick a template), **Guided Mind** (choose options and add your own context), or **Speak to Concierge** (recommended for custom Minds)."*

**Onboarding lanjutan (`/tutorials`)** dibungkus sebagai satu alur bertahap, bukan kumpulan artikel lepas: *"A step-by-step path from creating your first Mind to building Circles. Each step combines short videos and written guides — **watch, read, or both**."* Pola bagus: setiap langkah punya dua modalitas, user memilih.

### 4.3 Aktivasi pertama

1. Mind mengirim email perkenalan: menyebut namanya, mengonfirmasi tujuannya, mengundang interaksi.
2. *"Reply the email to start chatting, or connect via Telegram instead."*
3. Percakapan dimulai dari balasan pertama. Tidak ada app untuk di-install.
4. Kanal: **Email (primer)** + **Telegram** + WeChat (via token `/bind`) + WhatsApp Business.

**Menghubungkan Telegram (langkah persis dari docs):**
1. Buka Telegram, cari `@BotFather`, mulai chat.
2. Kirim `/newbot`, ikuti prompt.
3. Pilih display name + username (harus berakhiran `_bot`).
4. Buka halaman profil (`profile.animocaminds.ai`).
5. Verifikasi akun Telegram (nomor telepon + kode konfirmasi).
6. *"Say hello — your Mind is now live in Telegram."*

### 4.4 ⭐ Discovery → Detail → **Equip** (alur "hire")

Ini alur inti marketplace-nya.

1. **Browse** — `/bazaar` dengan 3 tab: Minds / Apps / Skills. Hero bertanda **"EARLY BETA"**: *"Browse one-click Minds, Apps, and Skills powering the ecosystem."*
   - Search box (client-side substring match, case-insensitive).
   - Filter/sort chip yang benar-benar ada: **`Featured`**, **`Recommended`**, **`All`**, **`A → Z`**, **`Z → A`**, **`Verified only`**, **`Official`**, **`Third-Party`**. Untuk Apps tambahan: `Connected first`, `Not connected first`.
   - Result counter: `{{total}} {{noun}} found` / `Showing {{total}} {{noun}}`.
   - Sort daftar Mind: `Recently Created` (default) | `A → Z`.
   - View mode toggle: `grid` | `list` — **dipersistensi di `localStorage`** (`minds:viewMode`, `minds:sort`).
   - Grid responsif: `grid-cols-2 lg:grid-cols-3` (mobile 2 kolom, desktop 3).
   - Pagination + "View All".
2. **Kartu** menampilkan: ikon, nama, `short_description` (truncate 1 baris), badge `Official` (pill biru) + ikon centang `Verified`, signal-bar `level`, dan `Equipped: {{count}}`.
3. **Klik kartu → modal detail** (`max-w-[900px] max-h-[90dvh]`), berisi:
   - Header: ikon, nama, badge, `Equipped: {{count}}`
   - `description` panjang
   - **"How it works"** — konten `tutorial` (HTML list)
   - **"Use cases"** — daftar `useCases` past-tense
   - Apps/Skills yang dibundel (untuk Mind)
   - Tombol utama: **`Equip this App`** / **`Equip this Skill`**
4. **Equip** → dialog *"Choose Mind(s) to equip"* / *"Choose a **Mind.**"*
   - Menampilkan daftar Mind milik user, **dengan saldo credit masing-masing** (`loadCredits`)
   - Sort di dalam dialog: `Recently Created` | `A → Z`
   - Mind yang sudah punya item ini ditandai **`Equipped`** (idempoten, tidak bisa dobel)
   - Mind non-aktif diurutkan ke bawah (`isEnabled` first)
5. **Konfirmasi** → `POST /v1/minds/{mindId}/apps` atau `POST /v1/minds/{mindId}/skills`
6. **Peringatan biaya sebelum eksekusi** (copy verbatim):
   > *"This activates a real cycle and spends Cognition, the same as any regular message to your Mind. The Mind typically gets going within a minute. If a cycle's already running or queued, the nudge won't add another on top."*
7. Jika Skill butuh API key eksternal, Mind akan **memintanya lewat percakapan**, bukan lewat form.

**Alur alternatif (didokumentasikan di `llms.txt`):** user menyalin *"generated activation message"* dan mem-paste-nya ke Mind via email/Telegram; Mind auto-equip. Jadi ada **dua jalur equip**: UI web dan pesan natural-language.

**Empty states pada alur equip (verbatim):**
- Belum punya Mind → *"Create your first Mind, then come back to equip it."* + tombol `Create a Mind`
- Belum login → *"Log in to see the Minds on your account and equip this to one of them."* + `Sign in to pick a Mind`
- Gagal → *"We couldn't equip that Mind. Please try again."*

### 4.5 Monitoring / Dashboard (`/profile` — 🔒 halaman butuh login; nama elemen di bawah diambil dari bundle + file i18n, bukan dari sesi login)

**Tab `/profile`:** `My Minds` · `My Connections` · `Linked Accounts` · `Redeem` · `Referral`. Header menampilkan `Account ID:`.

**Halaman detail Mind (`/profile/minds/:mindId`)** — tab `Overview` · `Mind Connections`, plus aksi `Chat now` (*"Open your Mind in the app and start chatting instantly."*).

**Panel di Overview (label huruf kapital):** `COGNITION` · `COGNITION USAGE` · `MIND CIRCLE` · `CIRCLE MEMBERS` · `WALLETS`, plus `App Connections`, `Skills`, `Tools`, `Status`, `ID:`.

**Kontrol yang benar-benar ada:**

| Kontrol | Detail |
|---|---|
| **Toggle Online/Offline** | **Ini "kill switch"-nya yang sesungguhnya.** Helper copy: *"**Online Minds accept new tasks. Switch to Offline to pause without deleting.**"* aria-label: `Status: {{label}}. Click to toggle.` Toast: `Mind is now online` / `Mind is now offline`. |
| **Nudge** | Membangunkan agent secara manual. `POST api.hellominds.ai/v1/messaging/{mindId}/beacon` dengan `triggerImmediateCognition`. Hasil: **"Nudge sent"** (*"will start a cognition cycle within a minute or so"*) atau **"Nudge noted"** (*"already has a cognition running or queued"*). Terblokir bila offline: *"{{mindName}} is offline — switch it online to nudge"*. |
| **Top up** | `Top Up Now — US ${{amount}} one-time` / `Top Up Now — {{price}} {{cadence}}`, `{{count}} Cognitions`, `Worth of Cognition`, `Transaction Reference`. |
| **Manage Circle** | `ADD TO CIRCLE`, `Already in circle`, *"That's the Steward — already in circle"*. |
| **Wallet** | *"Each Mind has its own blockchain wallet for Web3 integrations."* States: *"Mind's wallet address is initializing…"*, *"Wallet initialization timed out"*. |

**Yang TIDAK ada, meski diklaim di `llms-full.txt`:**
- ❌ **Tidak ada "activity log"** di UI. Yang terdekat hanya panel `COGNITION USAGE`.
- ❌ **Tidak ada soft kill "Quit emailing me"** di UI situs — hanya ada di `llms-full.txt`.
- ❌ **Tidak ada konfirmasi "high-impact action"** — string `high-impact` dan `undo` **nol kemunculan** di bundle.
- ❌ **Hapus Mind tidak self-serve.** FAQ: *"**Deletion isn't self-serve yet.** If you want a Mind permanently removed, get in touch with us and we'll handle it for you."*

**Referral (angka revenue-share nyata satu-satunya di seluruh platform):**
> *"Share your unique link and earn **20% of every credit top-up your referrals make — no cap, paid monthly**."*

**Billing (Stripe):** `Monthly` / `One Time`; *"Redirected to Stripe · Secure checkout · 256-bit SSL"*; *"✓ Cancel anytime · No lock-in · **Cognitions reset monthly**"*; *"✓ One-time charge · **Cognitions never expire**"*.

**Linked Accounts:** Telegram, WeChat, iMessage. ⚠️ Peringatan irreversibilitas: **`Linked (This can't be unlinked)`** dan *"**This is a one-time action. Once linked, your Telegram account cannot be unlinked from this profile.**"*

### 4.6 Koreksi & perbaikan

Model mental yang mereka pakai: **perlakukan agent seperti karyawan**.

> *"Treat your Mind like an employee. Tell it exactly what it did wrong and how to fix it in the future. The Mind will record this feedback in its long-term memory and adjust its future behaviour."*

---

## 5. Fitur Pembeda

### 5.1 Circles — kolaborasi Mind-ke-Mind dengan trust gate

Mekanisme paling orisinal mereka.

- Default: sebuah Mind **tidak bisa** bicara dengan Mind lain.
- Cara memperkenalkan: (a) kirim email dan **CC alamat email Mind** target, atau (b) tambahkan ke **grup Telegram** bersama.
- **Jaminan privasi:** *"Unknown agents or persons are fully blocked — your Mind does not even see the incoming message."* Pemblokiran terjadi **sebelum** konteks masuk ke model — mitigasi prompt-injection lintas agent.
- **Peringatan izin yang sangat baik** (verbatim, layak ditiru mentah-mentah):
  > *"Only add those you know and trust. Circle members can interact with your Mind, put it to work and **consume Cognition without your prior approval**, access information it knows about you such as schedules, and **request Cognition transfers on your behalf**."*
- Best practice yang mereka ajarkan: **swarm spesialis > satu super-agent**.
- **Manusia luar tidak butuh akun:** *"Anyone can email your Mind directly with no account needed. Introducing someone is as simple as TO'ing or CC'ing them on a thread with your Mind... From there, several humans and Minds can sit in the same conversation, negotiate, agree changes, and execute. You only step in when you want to."* — friction akuisisi nol untuk kolaborator.

### 5.2 Agent builder

Tiga tingkat, sesuai kemampuan user:
1. **One-Click** — pilih template, beri nama. 0 konfigurasi.
2. **Build Your Own** — nama + personality + deskripsi outcome yang diinginkan.
3. **Concierge** — wizard percakapan, dipandu AI.
4. **(Builder)** — CLI + client library, publish ke Bazaar.

Selain itu: **Mind bisa membuat Tool dan Skill-nya sendiri** — *"Ask your Mind to search the public registry; another Mind may have already created what you need. Your Mind can also create its own tools and skills for your personal use."*

### 5.3 Format definisi Skill

Temuan teknis penting (verbatim dari FAQ):

> *"Under the hood, a Skill is a **compact JSON playbook** that defines the exact sequence of operations, **hardwires which tool the Mind must call at each step**, and includes **fail-safes** if something goes wrong. Compared with simple prompt files, this design **lowers token cost, improves reliability and execution, and allows creators to monetise per use without exposing their underlying logic**."*

Jadi: bukan prompt bebas, tapi **DAG langkah terstruktur** dengan tool binding eksplisit. Ini penting — desain ini yang memungkinkan (a) biaya lebih murah, (b) hasil deterministik, (c) monetisasi per-use tanpa membocorkan IP.

**Empat artefak yang menyusun sebuah Skill** (dari Skill Building Guide — kosakata struktural resmi satu-satunya):

| Nama bahasa-manusia | Istilah developer |
|---|---|
| *"How it's found"* — listing yang dilihat builder lain di Bazaar | **Registry Offering** |
| *"How it connects"* — wiring antara Skill dan app-nya | **App Manifest** |
| *"What it can do"* — aksi konkret yang diizinkan | **Tool Schemas** |
| *"How it behaves"* — rutinitas yang diikuti | **Skill Playbook** |

> *"You do not need to write any of these directly. You describe the outcome, and your Mind builds and maintains all four."*
>
> ⚠️ **Tidak ada file format, JSON/YAML schema, atau daftar field yang dipublikasikan di mana pun.** Keempat artefak ini hanya *dinamai*, tidak pernah *dispesifikasikan*. Authoring 100% percakapan.

### 5.3b Alur publish ke Bazaar — 6 langkah persis

Contoh resmi: digest standup harian dari board Linear.

| # | Langkah | Aksi |
|---|---|---|
| **01** | **Describe** | Chat ke Mind: *"Build me a Skill that reads my team's Linear board and sends me a morning standup digest: what shipped yesterday, what's in progress, and what's blocked. Keep it short."* |
| **02** | **Refine** | Mind membacakan ulang proposalnya dalam bahasa biasa. User: *"Group it by assignee, and flag anything blocked for more than two days."* → *"That's it. Build it."* |
| **03** | **Connect** | **Langkah UI, bukan kode:** Profile → **My Connections** → cari app → masukkan API key → **Save Key**. *"**The platform stores and uses the key. Your Mind never holds the key directly.**"* Sekali set, dipakai ulang oleh semua Skill berikutnya. |
| **04** | **Run** | *"Give me today's standup."* → koreksi: *"Too long. One line per person."* |
| **05** | **Inspect** | ⭐ **Review cakupan akses sebelum publish:** *"Show me what this Skill can do, what it reads, and what it can change. Flag anything it should not touch."* → *"Tighten anything that looks too broad before anyone runs it."* |
| **06** | **Publish** | *"Publish this Skill to the Bazaar as 'Sprint Standup' so my team can equip it."* |

> 🎯 **Langkah 05 adalah pola terbaik yang mereka punya untuk keamanan marketplace** — audit izin yang dapat dibaca manusia, dilakukan **sebelum** dipublikasikan, dinyatakan dalam bahasa biasa. Fugugent harus punya padanannya (dan bisa melampauinya dengan menampilkannya ke *pembeli*, bukan hanya ke publisher).

**Update Skill:** lewat operasi percakapan `REGISTRY_Update` dan `SKILL_Update`. *"Updates take effect immediately for new sessions — users in an active session continue with the version they started… Your Bazaar listing updates automatically… no separate publishing step needed."*
⚠️ **Tidak ada API untuk publish.** Route Bazaar di API publik bersifat **read-only (ID discovery)**.

### 5.3c Constitution: Tenets, Invariants, Guardrails, Priors

Model tata-kelola perilaku mereka — konsep paling matang yang mereka punya, dan sangat relevan untuk agent yang memegang uang.

- **Tenet** — *"a stored rule, belief, or learned fact that lives permanently in a Mind's Soul."* Dua jenis:
  - **Invariant** — tidak pernah bisa dilanggar, bahkan jika user secara eksplisit menyuruhnya. Inilah **Guardrail**.
  - **Prior** — preferensi fleksibel yang dipelajari.
- *"**All Guardrails are Tenets — but not all Tenets are Guardrails.**"*
- *"**You define the Guardrails. Your Mind builds up its Priors.**"*
- Ketika situasi bertentangan dengan Soul, *"the Mind experiences cognitive dissonance and will not comply"*. Disebut **Constitution** — *"both a technical floor (what the Mind can do) and a moral floor (what it won't do)."*
- User bisa membaca/mengubahnya: *"Show me your current Tenets."*

**Tiga pola Guardrail yang mereka contohkan** — perhatikan yang kedua:
1. **Privacy** — *"Never share the Steward's personal email"*
2. 💰 **Budget** — *"**Never spend more than 500 Credits in a single session**"*
3. **Style** — *"Always respond in French"*

> 🎯 **Guardrail budget adalah primitif yang wajib dimiliki Fugugent**, dan di on-chain kita bisa membuatnya jauh lebih kuat: bukan sekadar instruksi yang dipatuhi model, tapi **batas belanja yang ditegakkan smart contract**. HelloMinds hanya bisa menjanjikan kepatuhan; kita bisa menjaminnya.

### 5.3d Brain Pulse — penanganan kegagalan

> *"When a Skill fails — due to an API timeout, a missing input, or an unexpected response — the Mind is notified through **Brain Pulse** rather than crashing silently. It can retry the Skill with adjusted parameters, pivot to an alternative approach, or explain the failure."*

Lapisan self-monitoring/recovery bawaan. Polanya bagus: **agent yang sadar akan kegagalannya sendiri dan menjelaskannya**, bukan gagal senyap.

### 5.3e Skill bawaan platform

- **Mind Architect** — mendefinisikan Soul & tujuan Mind baru
- **Skill Architect** — mendesain/mendokumentasikan Skill
- **Standard Hygiene** — manajemen konteks: meringkas percakapan panjang, memprioritaskan memori aktif, pruning
- **Passive Autonomous Mode** — *"lets a Mind take actions without waiting for user prompts: checking in at intervals, sending scheduled updates, or running triggered workflows"*

Memori berjenjang: **RAM** (konteks aktif) → **Episodes** (memori sesi lampau) → **Tenets** (permanen).

### 5.4 Revenue share untuk creator — ⚠️ **BELUM ADA**

Ini gap besar. Bukti:

- FAQ: *"Developers who want to extend the platform can build skills and submit them to the Bazaar, with **monetisation for skill creators coming soon**."*
- `llms.txt` mengklaim builder bisa *"Earn from users adopting their published items"* — tapi **tidak ada mekanisme, angka, rate, atau dokumentasi payout di mana pun** di seluruh docs.
- Tidak ada field `creator`/`author` pada satu pun dari 148 item Bazaar. Semua bertag `Official`/`Featured`.
- Programme FAQ, jawaban resmi terbaru (verbatim): *"**Can builders earn from the Skills and Tools they publish?** Yes. Builders who publish Skills and Tools to the Minds Bazaar can benefit from the platform's reward model. **We're still finalising the specifics and will share them in-platform when ready.**"*
- Halaman `/about` sudah memasarkannya seolah live: *"**Monetize on every skill install. Build once, earn every time it runs.**"* — janji tanpa mekanisme.
- **Dashboard analitik builder juga belum ada:** *"A builder analytics dashboard is **in development**. It will give you visibility into session volume, Cognition Credit spending by creation, and Skill call frequency. **Coming soon.**"*

**Satu-satunya angka bagi-hasil yang benar-benar dipublikasikan di seluruh platform adalah untuk referral, bukan creator:**
> *"Share your unique link and earn **20% of every credit top-up your referrals make — no cap, paid monthly**."*

Selain itu ada **Minds Investment Programme** (hingga US$10M, ekuitas, rolling) dan bonus referral $5 Cognition.

**Ketentuan Investment Programme yang perlu dicatat** (dari `/en/program` + `/en/program/faq`):
- *"Selected teams receive a bundle of **cash investment and Cognition Credits**"* — kredit mengalir kembali ke platform mereka sendiri.
- *"**Every accepted team receives platform support, Cognition Credits, and DevRel support regardless of investment.** Investment decisions, if any, are **performance-based**, made on the basis of demonstrated progress, **not at acceptance**."*
- *"**Not all accepted teams receive investment**… Participants that do not receive investment will not be required to give up equity."*
- Butuh **pitch deck (PDF/PPTX)** + **video pitch 3 menit** + **tiga klaim yang bisa diverifikasi pihak ketiga** dengan link.
- Deck dibaca oleh **"Minds Review"** — sebuah AI reviewer. Saran mereka: *"Use **real text, not scanned images** of slides"*, *"**YouTube unlisted gives the best AI evaluation**"*.
- Sinyal terkuat menurut mereka sendiri: *"link to any Skills or Tools you've published on the Bazaar — **showing you've already started is the strongest signal we see**"*.
- Shortlist dalam **2–4 minggu**, lalu call **30 menit**. *"No mass rejections."*
- Eksplisit **tidak crypto-gated**: *"You do not need to build anything related to crypto or Web3."*

> 🎯 **Peluang Fugugent:** revenue-share on-chain yang benar-benar berfungsi, transparan, dan bisa diverifikasi adalah pembeda paling tajam vs. HelloMinds — dan sangat natural untuk BNB Chain.

### 5.5 Review / reputation — ⚠️ **BELUM ADA**

Tidak ada rating, review, atau reputasi. Yang ada:
- **Trust label biner:** `Official` (di-review tim) vs `Wild` (community, tidak di-review). Namun **100% katalog saat ini adalah Official/Featured** — label `Wild` didokumentasikan tapi belum terpakai.
- **`equippedCount`** sebagai satu-satunya proxy popularitas.
- **Leaderboard** disebut di `llms.txt` (*"A Leaderboard surfaces the most-equipped items"*) — tapi tidak ada route `/leaderboard` di sitemap.

### 5.6 Sandbox / testing — ⚠️ **TIDAK ADA di level platform**

Tidak ada dry-run, preview, atau sandbox sebagai fitur platform. Setiap equip/eksekusi adalah live dan membakar credit sungguhan; satu-satunya mitigasi adalah peringatan teks sebelum aksi.

**Pengecualian penting:** satu agent — **Superior Trader** — membawa sandbox-nya sendiri di level domain: *"**backtests them before a dollar is at risk**, deploys them live **or on paper** across crypto and on-chain spot markets."* Jadi polanya ada, tapi **dibangun ke dalam satu agent, bukan disediakan platform**. Untuk Fugugent, menjadikan dry-run sebagai **primitif platform** (tersedia untuk semua agent) adalah peningkatan yang jelas.

### 5.6b Permukaan crypto / DeFi (relevan langsung untuk Fugugent)

Dari 119 Apps, hanya **5 yang menyentuh Web3** — permukaan crypto mereka sangat dangkal:

| App | Fungsi |
|---|---|
| Superior Trade | Monitor posisi, analisis market, kelola trade |
| Polymarket | Cari market, pull data prediction market |
| Pieverse | Query & interaksi aset on-chain |
| Laguna Network | Query & eksekusi operasi on-chain |
| (Nansen / Dune / CoinGlass) | Ikon ada di bundle, data on-chain |

**Superior Trader Mind** (satu-satunya agent trading, `archetype: superiortrader`):
- Chain yang didukung: **Hyperliquid** dan **Aerodrome** — yaitu **bukan BNB Chain**.
- `useCases`-nya adalah contoh terbaik dari pola past-tense-berangka untuk konteks DeFi:
  > "Backtested strategy across 3 months of market data"
  > "Deployed trading bot to paper trading environment"
  > "Detected risk conditions and halted execution"
  > "Improved strategy Sharpe ratio through optimization"

> 🎯 **Peluang:** HelloMinds memiliki wallet per-agent dan retorika "agentic economy" yang kuat, tetapi kemampuan on-chain nyatanya minim (5 dari 119 App) dan tidak menyentuh BNB Chain sama sekali. Fugugent bisa menjadi **jauh lebih dalam di on-chain** sambil meminjam bahasa produk mereka yang sudah matang.

### 5.7 Skill "Passive Autonomous Soul" — pola guardrail menarik

Salah satu dari 29 Skills adalah **"Passive Autonomous Soul" — *"Complete tasks within scope and never act beyond it."*** Yaitu: guardrail perilaku yang dikemas **sebagai item marketplace** yang bisa di-equip. Pola menarik — batas keamanan sebagai produk yang bisa dipilih user.

---

## 6. Arsitektur Teknis

### 6.1 Stack yang terdeteksi

| Lapisan | Teknologi | Bukti |
|---|---|---|
| Frontend produk | **Vite + React + i18next + Radix UI + Tailwind** | `assets/index-*.js`, `Uv()` cva, `__scopeToggleGroup` |
| Builder Hub | **Next.js (App Router)** | `_next/static/chunks/`, RSC payload |
| Auth / DB | **Supabase** (+ **WebAuthn/passkeys**) | `RealtimeClient`, `supabase.auth.getUser()`, `pubKeyCredParams` |
| Integrasi tool | **Composio** | `logos.composio.dev`, `composio_managed_auth_schemes`, `api.hellominds.ai/v1/composio`, `/composio/callback` |
| Pembayaran | **Stripe** | Checkout + link top-up |
| Analytics | GTM (server-side via **Stape**), GA4 | `GTM-WRMHX4XC`, `proxy.feed.hellominds.ai` |
| Browser automation | **Browserbase** | Skill LinkedIn Recruiter |
| Search | **Tavily**, SerpAPI, Perplexity | App list |
| Data on-chain | Nansen, Dune, CoinGlass, Polymarket | App list |

> 🔑 **Temuan arsitektur paling penting:** lapisan integrasi 119-App mereka **bukan buatan sendiri** — itu **Composio**. Auth scheme di `toolkits.json` (`OAUTH2` ×102, `API_KEY` ×29, `S2S_OAUTH2` ×8, `GOOGLE_SERVICE_ACCOUNT`, `BASIC`, `OAUTH1`) persis adalah taksonomi Composio. **Fugugent bisa melakukan hal sama** dan mendapat ratusan integrasi tanpa membangunnya satu per satu.

### 6.2 Builder API — spesifikasi lengkap

**OpenAPI 3.0.3 · "Minds Builder API" v1.0.3 · Server: `https://api.build.hellominds.ai`**
(Web app konsumen memakai base terpisah: `https://api.hellominds.ai`.)

**Auth:**
```jsonc
"BuilderApiKey": { "type": "apiKey", "in": "header", "name": "X-Api-Key" }
// X-Access-Key DEPRECATED. Env var: MINDS_BUILDER_API_KEY
```

**21 path / 27 operasi.** Tag: Account, Cognition, Credits, Minds, Circles, Bazaar, Messaging, Events.
Route Bazaar dan `GET /v1/minds/check/name` bersifat **publik** (tanpa key); sisanya butuh `X-Api-Key`.

| Method | Endpoint | Catatan |
|---|---|---|
| GET | `/v1/humans/{humanId}/minds` | Daftar Mind; `humanId` harus cocok dengan JWT di API key |
| GET | `/v1/minds/check/name` | **Publik.** → `{ "isAvailable": true }` |
| POST | `/v1/minds/awaken` | `{ id, mindName }`. `id` = enum **20 arketipe** |
| GET | `/v1/minds/{mindId}` | Detail: email, wallet, chain, species, `isEnabled`, `model`, `hasTelegram` |
| PATCH | `/v1/minds/{mindId}` | Hanya `{ isEnabled: boolean }` di v1 |
| GET/PUT/DELETE | `/v1/minds/{mindId}/skills` | List / equip / unequip. Body `{ ids: [...] }` |
| GET/PUT/DELETE | `/v1/minds/{mindId}/apps` | Idem |
| GET | `/v1/minds/{mindId}/cognition/usage` | `interval`: `1m\|5m\|15m\|1h\|1d\|1w\|1M` |
| GET | `/v1/minds/{mindId}/cognition/usage-by-tool` | `interval`: `hour\|day\|week\|month` (**beda enum!**) |
| GET | `/v1/minds/{mindId}/credits` | → `{ mindId, swarm: 219.65 }` |
| GET/POST/DELETE | `/v1/circles/{mindId}` | GET → `CircleMember[]` langsung |
| GET | `/v1/bazaar/skills`, `/skills/{id}` | **Publik**, `search`/`page`/`pageSize` |
| GET | `/v1/bazaar/apps`, `/apps/{id}` | **Publik**, + `tier=wild\|verified` |
| POST | `/v1/messaging/conversation` | `alias` pattern `^[a-z0-9_-]+$`, max 64 |
| GET | `/v1/messaging/conversations`, `/{alias}` | |
| GET | `/v1/messaging/histories/{alias}` | **Kanonik.** `limit` 1–200 (def 50), `before` cursor **eksklusif**, **newest-first** |
| GET | `/v1/messaging/history/{alias}` | **DEPRECATED** — oldest-first, `after` inklusif |
| POST | `/v1/messaging/message` | `{ alias, messageText, attachments? }`. **Jangan kirim `conversationId`** |
| GET | `/v1/messaging/events?alias=` | **SSE stream** — lihat §6.5 |

**Konvensi data penting:**
- `senderType` / `partyType`: **`0` = Mind, `1` = manusia**
- Email Mind selalu berakhiran **`@hellominds.ai`**
- Saldo di kabel bernama **`swarm`**, tapi CLI/SDK menampilkannya sebagai `cognition`
- Cursor pagination = `fingerprint` dari baris terakhir
- Apps memakai `appId` + **`appName`** (bukan `name`); Skills memakai `skillId` + `name`

**Envelope error:**
```json
{ "error": { "type": "ValidationError", "subType": "InvalidAlias",
             "message": "alias must match ^[a-z0-9_-]+$" } }
```
Tipe: `ValidationError`, `Unauthorized`, `Forbidden`, `NotFound`, `BadGateway`.

**Enum 20 arketipe Mind** (`POST /v1/minds/awaken`): `mastermind`, `generalassistant`, `sales`, `bizz`, `superiortrader`, `gamedesigner`, `emailmanager`, `scrummaster`, `fitnesscoach`, `personalchef`, `recruiter`, `football`, `decision`, `content`, `research`, `productbuilder`, `learningcoach`, `followup`, `gtm`, `chiefofstaff`.
(Catat: `mastermind` ada di API tapi **tidak** di katalog publik `minds.json` yang berisi 19 — itulah Concierge/Master Mind.)

### 6.3 Developer tooling

| Artefak | Paket | Versi |
|---|---|---|
| CLI | `@animocabrands/minds-cli` | 0.1.4 |
| Client library | `@animocabrands/minds-client-lib` | 0.1.4 (Node, typed) |

**Perintah CLI yang terdokumentasi:** `minds mind awaken`, `minds mind check-name`, `circle add`, history dengan `--cursor`.

**Fungsi client library:** `checkMindName()`, `awakenMind()`, `getHistory()` (newest-first).

**Auth:** Builder API key dibuat di console (dengan **nama + tanggal kedaluwarsa**), disimpan sebagai env var **`MINDS_BUILDER_API_KEY`**. **Ditampilkan hanya sekali.**

**Prasyarat setup:** minimal 1 Mind + 1 Builder API key sebelum bisa memakai Builder Tools.

**Positioning CLI yang cerdas:** *"drive it from Cursor, Claude Code, or any coding agent, JSON stdout and examples in `--help` so your agent can list Minds, check cognition, and manage your account without you memorizing commands."* — CLI dirancang agar **coding agent** yang memakainya, bukan manusia. Pola bagus untuk 2026.

### 6.4 MCP — ada, tapi tidak terdokumentasi

Status yang akurat: **MCP ada sebagai fitur platform, tetapi tidak ada satu pun dokumentasi builder untuknya.** Bukti:

1. Form aplikasi Investment Programme punya checkbox: **"Connected an MCP server to a Mind"** — jadi user *bisa* menyambungkan MCP server ke sebuah Mind.
2. Halaman marketing Builder Hub memanggil **`navigator.modelContext.provideContext()`** dan mendaftarkan browser tool: `openHome`, `openDocs`, `openInspirations`, `openProgram`, `openProgramApply`, `openFaq`, `openGuide`, `openInspiration`. Ini MCP sisi-browser agar agent bisa menavigasi situs mereka.
3. **Tidak ada** endpoint MCP, konfigurasi server, atau panduan di seluruh docs/API reference.

Integrasi tool produksi berjalan lewat **Composio** dan **`HTTP_Execute`** (lihat §6.5b), bukan MCP.

### 6.5 Event: **SSE, bukan webhook**

Tidak ada webhook sama sekali. Satu-satunya mekanisme push adalah **Server-Sent Events**:

```
GET /v1/messaging/events?alias=<alias>
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

Dari spec (verbatim): *"Each authenticated connection subscribes to a **Redis channel scoped to the user**. A heartbeat comment (`: ping`) is sent every 30 seconds to keep the connection alive."*

- Konfirmasi awal: `: connected`
- Event: `data: <JSON>\n\n`
- Heartbeat: `: ping` tiap 30 detik
- `?alias` memfilter ke satu percakapan; tanpa alias = semua event user
- Payload event: `fingerprint, conversationId, messageId, messageText, partyType, senderName, mindId, mindName, attachments[]`

SDK menyediakan dua bentuk konsumsi: `client.subscribeEvents({ onEvent, onError })` (callback) dan `for await (const e of client.eventsIterator({ alias }))` (async iterator), keduanya menerima `AbortSignal`.

> Field `webhookId` muncul di objek `custom` pada sebagian baris history Mind, tapi **tidak terdokumentasi**.

### 6.5b `HTTP_Execute` — connector universal

Temuan penting untuk strategi integrasi. Dari FAQ builder:

> *"**`HTTP_Execute`** — which lets your Mind call **any public REST endpoint without a pre-built connector**. If a service has a public URL and a standard API, your Mind can reach it today."*

Jadi strategi integrasi mereka berlapis tiga: **(1)** Apps ter-kurasi (Composio, 119), **(2)** `HTTP_Execute` sebagai escape hatch universal, **(3)** MCP (tidak terdokumentasi). Integrasi live yang disebut eksplisit: Telegram, Gmail, Google Calendar, Discord, Slack, GitHub, **Nansen**, **Dune**, Perplexity, Spotify, Strava.

### 6.5c LLM & infrastruktur yang dipakai

- **Brain providers:** OpenAI, Google (Gemini), xAI (Grok) — dan **Qwen** disebut di bagian data handling.
- **Framework:** **LangChain** disebut sebagai infrastructure service.
- Routing otomatis per jenis pekerjaan: *"reasoning, coding, image analysis, fast response."*

### 6.6 Isi docs Builder Hub (deskripsi resmi dari `build.hellominds.ai/llms.txt`)

Seluruh dokumentasi builder hanya terdiri dari 5 halaman. Deskripsi resminya:

| Halaman | Isi (verbatim dari llms.txt) |
|---|---|
| **Account setup** | *"Create a Mind and issue a Builder API key before using Builder Tools."* |
| **Minds CLI** | *"Install the Minds CLI and drive it from Cursor, Claude Code, or any coding agent, JSON stdout and examples in `--help` so your agent can list Minds, check cognition, and manage your account without you memorizing commands."* |
| **Minds Client Library** | *"Embed configured Minds in your application, typed Node client for messaging, events, and Builder API capabilities after you set up with the Minds CLI."* |
| **Skill Building Guide** | *"**Six steps** from describing a Skill in one message to publishing it on the Bazaar, connected to the apps your team already uses. **Linear is the example**, the same flow works for any app."* |
| **Navigate Circles** | *"**Three ways** to introduce a Mind — the Manage Circle dialog, an email CC, or a Telegram group. Plus how the trust gate works and why unknown senders are silently blocked."* |

> 📌 **Alur publish ke Bazaar adalah 6 langkah, dimulai dari "mendeskripsikan Skill dalam satu pesan"** — yaitu authoring lewat bahasa natural, bukan menulis file JSON dengan tangan. Ini penting: skema Skill berupa JSON playbook (§5.3), tapi **jalur authoring-nya percakapan**. Pola yang sangat baik untuk ditiru — builder mendeskripsikan, sistem yang meng-compile.
>
> ⚠️ Ada juga penemuan UI baru di sini: **"Manage Circle dialog"** — jadi Circle bisa dikelola lewat UI, bukan hanya via email CC/Telegram seperti yang disebut di dokumen konsumen.

**Changelog terakhir (2026-08-25)** menunjukkan arah pengembangan:
- `minds mind check-name` / `awaken`
- History `--cursor` **newest-first** (pagination before-cursor)
- **`circle add` kini menerima email manusia, bukan hanya Mind** — Circle berkembang dari mesin-ke-mesin menjadi campuran manusia+agent.

### 6.7 Model keamanan

- **Private key:** terenkripsi di DB. AI tidak pernah melihatnya. Untuk menandatangani transaksi, AI **mengirim execution request**; backend yang mendekripsi dan menandatangani. (Pola yang baik — signing dipisah dari reasoning.)
- **Data training:** *"No user data is sent to or retained by these models for training purposes."*
- **Isolasi antar-agent:** Circle gate memblokir pesan **sebelum** masuk ke konteks model.
- **Kill switch:** soft (natural language) + hard (dashboard).
- **Konfirmasi:** aksi high-impact butuh konfirmasi eksplisit.
- `/.well-known/security.txt` tersedia.

---

## 7. Pola UI/UX — Yang Ditiru vs Yang Dihindari

### 7.1 ✅ Layak ditiru

| # | Pola | Detail |
|---|---|---|
| 1 | **`useCases` past-tense berangka** | "Searched 38 roles", bukan "Can search roles". Bukti hasil, bukan janji fitur. |
| 2 | **Signal-bar untuk `level`** | Kesulitan sebagai 1–2–3 batang visual, bukan teks. Terbaca dalam 200 ms. |
| 3 | **`iconInitials` + `iconTint`** | Fallback avatar berwarna kalau tak ada gambar — tidak pernah ada kartu kosong. |
| 4 | **View mode + sort dipersistensi** | `localStorage` menyimpan preferensi grid/list & sort. |
| 5 | **Empty state yang preskriptif** | *"Try a different search term or clear the filters."* / *"Try clearing a filter or switching the format."* — selalu menyebut **aksi**, bukan hanya "no results". |
| 6 | **Empty state yang mendorong konversi** | *"Create your first Mind, then come back to equip it."* + tombol langsung. Bukan dead end. |
| 7 | **Peringatan biaya sebelum eksekusi** | *"This activates a real cycle and spends Cognition..."* + estimasi waktu ("within a minute") + jaminan anti-duplikat. |
| 8 | **Saldo credit ditampilkan di dialog pilih agent** | User melihat saldo tiap agent **tepat saat** memilih ke mana meng-equip. |
| 9 | **Escape hatch di onboarding** | *"In a rush? …You can calibrate its personality later."* |
| 10 | **Estimasi durasi di wizard** | *"Takes 1–2 min."* |
| 11 | **Pola "You should see:" di docs** | Tiap langkah docs menyebut hasil yang diharapkan → user bisa self-verify. |
| 12 | **Peringatan izin yang eksplisit & jujur** | Copy Circle menyebut terus-terang bahwa anggota bisa "consume Cognition without your prior approval". |
| 13 | **Agent memberi tahu saldonya sendiri** | Notifikasi credit datang dari agent via kanal yang sudah dipakai, dengan link bayar. Bukan banner di dashboard. |
| 14 | **Pause-and-resume, bukan fail** | Habis credit → pause + notifikasi + lanjut dari titik terakhir. |
| 15 | **Kuis kepribadian sebagai discovery** | Mindprint (16 tipe) mengubah "saya tidak tahu mau agent apa" jadi rekomendasi personal. |
| 16 | **State agent yang antropomorfik** | "stress, focus, trust" — real-time. Sangat cocok untuk maskot fugu (fugu mengembang saat stres!). |
| 17 | **Grid 2-kolom di mobile** | `grid-cols-2 lg:grid-cols-3` — bukan 1 kolom; density lebih baik untuk browsing. |
| 18 | **CLI dirancang untuk coding agent** | JSON stdout + contoh di `--help`. |
| 19 | ⭐ **"Markdown twins" untuk setiap halaman docs** | Setiap halaman Builder Hub tersedia juga di `<path>.md` (mis. `/en/docs/get-started/cli.md`). Plus tombol per-halaman: **Copy MD · View Markdown · Ask on Telegram · Builder console**. Ini membuat docs bisa dibaca agent/LLM secara sempurna. Sangat murah, sangat modern. |
| 20 | **Meter "Setup Effort", bukan "difficulty"** | Framing berorientasi-user: yang ditanyakan user bukan "seberapa sulit ini" tapi "berapa banyak kerja yang harus saya lakukan". |
| 21 | **"Example Actions" sebagai label** | Lebih baik daripada "Features" atau "Capabilities". |
| 22 | **Banner risiko kontekstual** | `disclaimer: "Crypto Trading"` memicu banner oranye. Peringatan muncul **hanya di item yang membutuhkannya**, tepat di titik keputusan. |
| 23 | ⭐ **Langkah "Inspect" sebelum publish** | *"Show me what this Skill can do, what it reads, and what it can change. Flag anything it should not touch."* — audit izin dalam bahasa biasa. |
| 24 | ⭐ **Guardrail budget sebagai primitif** | *"Never spend more than 500 Credits in a single session."* |
| 25 | **Brain Pulse: agent menjelaskan kegagalannya sendiri** | Retry dengan parameter berbeda, pivot, atau jelaskan — bukan crash senyap. |
| 26 | **Kanvas Circle dengan legenda visual** | 🧠 biru = Mind online, 🧠 abu = offline, 🛡 oranye = Steward (pemilik), 👤 = manusia, garis putus-putus = koneksi. Kanvas **read-only**; semua perubahan lewat dialog. Memisahkan "melihat" dari "mengubah" dengan bersih. |
| 27 | **Toggle status yang jujur** | *"Online Minds accept new tasks. Switch to Offline to pause without deleting."* — menjelaskan konsekuensi, bukan cuma label. |
| 28 | **"Nudge" dengan proteksi duplikat** | Membangunkan agent manual, dan memberi tahu bila siklus sudah antre: *"Nudge noted — already has a cognition running or queued."* |
| 29 | **Onboarding video+teks berdampingan** | *"watch, read, or both"* — tiap langkah punya video YouTube tersemat DAN instruksi tertulis. |
| 30 | **Angka konkret di studi kasus** | Inspirations memuat metrik nyata: "3.300 views → 106 klik → 46 kunjungan, $0,08/kunjungan". Jauh lebih meyakinkan daripada testimoni. |
| 31 | **Label kejujuran pada konten ilustratif** | Studi kasus genealogi ditandai eksplisit: *"**Illustrative story** — written to describe the thought process behind the pattern, not a single named builder."* Integritas yang murah dan menaikkan kepercayaan. |
| 32 | **Disclaimer risiko pada demo trading** | *"Agentic trading is experimental… Past performance does not guarantee future results… should not be replicated without independent assessment."* Wajib untuk Fugugent di DeFi. |

### 7.2 ❌ Sebaiknya JANGAN ditiru

| # | Anti-pola | Kenapa |
|---|---|---|
| 1 | **Kartu tanpa metrik keputusan** | Tanpa rating, run count, success rate, latency, atau biaya — user tidak punya dasar memilih antar 119 item. |
| 2 | **Filter hanya `All \| Official`** | 48 kategori ada di data tapi **tidak dipakai sebagai filter**. Menjelajahi 119 Apps praktis mustahil. |
| 3 | **Tidak ada estimasi biaya per aksi** | *"complexity drives consumption"* + tanpa angka = kecemasan biaya. User tidak bisa memperkirakan. |
| 4 | **Anonimitas creator total** | Tidak ada field creator → tidak ada reputasi, tidak ada insentif membangun brand, tidak ada akuntabilitas. |
| 5 | **`Wild` label yang tidak terpakai** | Sistem trust dua-tingkat didokumentasikan tapi 100% katalog `Official`. Janji yang belum ditepati. |
| 6 | **Revenue share "coming soon"** | Diiklankan sebagai keunggulan builder tapi tidak ada mekanisme. Merusak kepercayaan builder. |
| 7 | **Leaderboard yang tidak ada** | Disebut di `llms.txt`, tidak ada di sitemap/route. |
| 8 | **Kedalaman kategori sangat timpang** | 11 dari 19 Mind hanya 1 App + 0 Skills. Lebar tanpa dalam. |
| 9 | **Alur equip via copy-paste pesan** | *"copy a generated activation message and paste it to your Mind"* — rapuh, tidak bisa dilacak, gagal diam-diam. |
| 10 | **Tidak ada sandbox / dry-run** | Setiap tes membakar uang sungguhan. |
| 11 | **Email sebagai kanal utama** | Latency tinggi, tidak ada UI kaya, sulit menampilkan data real-time. Buruk untuk use-case DeFi/trading. |
| 12 | **Landing di-render 100% client-side** | Tidak ada konten di HTML awal → buruk untuk SEO dan first paint. Mereka menambalnya dengan `llms.txt`. |
| 13 | **Docs builder cuma 5 halaman** | Sangat tipis untuk platform yang mengklaim program investasi US$10M. |
| 14 | **Tidak ada versioning/last-updated** | Tidak ada cara tahu apakah sebuah Skill masih dirawat. |
| 15 | **Konsep bertumpuk terlalu banyak** | Mind/Soul/Brain/DNA/State/Skill/Tool/App/Artifact/Circle/Cognition/Concierge/Swarm/Steward/Tenet/Prior/Invariant/Guardrail/Episode/Swarm — **20 istilah baru** sebelum user melakukan apa pun. |
| 16 | 🚨 **Penautan akun yang tidak bisa dibatalkan** | *"Once linked, your Telegram account cannot be unlinked from this profile."* Aksi permanen tanpa jalan keluar adalah kegagalan UX serius. |
| 17 | 🚨 **Hapus agent tidak self-serve** | *"Deletion isn't self-serve yet… get in touch with us."* User tidak bisa menghapus asetnya sendiri. Fatal untuk produk yang menjual "sovereign asset". |
| 18 | **Filter tutorial dikompilasi habis** | Filter bar di `/tutorials` di-render kosong (`N2 = false`), tapi param URL `?category=`/`?format=` masih dihormati. Kontrol setengah jadi yang dikirim ke produksi. |
| 19 | **Konten tersembunyi** | `tutorials-manifest.json` memuat 25 slug; halaman hanya menampilkan **6** dari allowlist hardcoded. 19 tutorial tak bisa ditemukan lewat navigasi. |
| 20 | **Tabel kosong di FAQ** | Komponen `faq-launch-options` (tabel "Option \| Best for \| What happens") dipanggil **tanpa data** — tabel kosong/rusak di halaman live. |
| 21 | **Docs basi berbeda dari produk** | `/docs` masih menyebut domain `animocaminds.ai`, dan `/docs/troubleshooting` sama sekali tidak memuat failure mode — hanya 5 FAQ marketing. |
| 22 | **Halaman "Troubleshooting" tanpa troubleshooting** | Judulnya menjanjikan pemecahan masalah; isinya lima pertanyaan pemasaran. Menyesatkan. |

---

### 7.3 ⭐⭐ Jurang antara yang DIPASARKAN dan yang DIKIRIM

Ini temuan paling berharga dari seluruh riset, dan pelajaran paling keras untuk kita. `llms.txt` / `llms-full.txt` / `agents.json` mereka jauh lebih ambisius daripada produk yang benar-benar berjalan. Diverifikasi dengan mencari string di bundle produksi:

| Diklaim di `llms-full.txt` / marketing | Kenyataan di produk yang dikirim |
|---|---|
| Trust label **"Wild"** (community, unreviewed) | ❌ **Nol kemunculan** di bundle. Badge nyata: Official / Featured / Verified / Composio / Third-Party |
| *"A **Leaderboard** surfaces the most-equipped items"* | ❌ **Nol kemunculan.** Tidak ada route, tidak ada UI |
| Equip = **salin "activation message"** lalu paste ke Mind | ⚠️ String-nya ada di `locales/en/common.json` (`"Copy equip message"`, `Equip yourself with the skill "{{name}}" (ID: {{id}})`) tapi **tidak ada di bundle produksi**. Ini kunci i18n basi; UI live memakai tombol Equip langsung |
| *"Your Mind asks for confirmation on **high-impact actions**… **undo actions**… review its **activity log**"* | ❌ String `high-impact`, `undo`, dan activity log **nol kemunculan**. Tidak ada satu pun dari ketiganya |
| Soft kill *"Quit emailing me"* + *"**hard kill switch** in the dashboard"* | ⚠️ Tidak ada di UI. Yang ada: toggle **Online/Offline** (*"pause without deleting"*) |
| *"**No user data is sent to or retained** by these models for training"* | ⚠️ `/docs/security` justru bilang provider *"may retain data in accordance with their own privacy policies"* |
| *"over **1,000 skills** live and growing"* (halaman `/about`) | ⚠️ Katalog publik `bazaar.json` berisi **29 Skills** dan 119 Apps |
| Bazaar sebagai marketplace komunitas | ⚠️ Badge bertanda **"EARLY BETA"**; 100% katalog Official/Featured |
| **State** = *"focus, trust, attention"* | ⚠️ `/docs/core-concepts` bilang *"**stress**, focus, trust"* |
| Domain | ⚠️ `/docs` masih menyebut **animocaminds.ai** dan **profile.animocaminds.ai**; sisa situs memakai **hellominds.ai** — docs sudah basi |
| Email Mind | ⚠️ Docs bilang **`@amind.ai`**; API spec bilang **`@hellominds.ai`** |
| CLI *"targeting a **June 2026** release"* (programme FAQ) | ⚠️ Changelog menunjukkan CLI sudah rilis **2026-06-09** dan sudah di 0.1.4 pada Agustus. FAQ basi |
| Provider LLM | ⚠️ Tiga daftar berbeda di tiga halaman: docs (OpenAI/Google/xAI), FAQ (+ **Qwen**), llms.txt (generik) |

**Pelajaran untuk Fugugent (dan ini menyangkut langsung penilaian juri):**

1. **Jangan pernah mendokumentasikan fitur yang belum dikirim.** Juri hackathon akan mengklik. Sebuah leaderboard yang dijanjikan tapi tidak ada adalah dead end — persis yang dinilai kriteria Functionality.
2. **Satu sumber kebenaran.** Mereka punya empat surface (docs, FAQ, llms.txt, app) yang saling bertentangan tentang fakta-fakta dasar. Untuk demo, pastikan landing, docs, dan app menyatakan angka yang **sama**.
3. **Jangan tampilkan angka yang tidak bisa dibuktikan.** *"Over 1,000 skills"* padahal katalog berisi 29 adalah risiko kredibilitas. Kita tampilkan hitungan nyata, diambil langsung dari data.
4. **Hapus kunci i18n yang mati.** String equip basi mereka membocorkan alur produk lama.

## 8. Pelajaran untuk Fugugent

Dipetakan ke tiga kriteria juri: **[F]** Functionality (journey land→find→understand→activate tanpa dead end), **[D]** Data Quality (data real-time akurat untuk memutuskan agent mana yang di-hire), **[A]** Agent Diversity (4 kategori sama dalamnya).

### Wajib adopsi (tiru langsung)

1. **[F] Grid marketplace 2/3-kolom dengan search + sort + view-toggle yang dipersistensi.**
   Tiru `grid-cols-2 lg:grid-cols-3` dan simpan `viewMode`/`sort` di `localStorage`. Murah, langsung terasa matang.

2. **[F][D] `useCases` past-tense berangka pada setiap kartu fugu.**
   Bukan "Bisa memantau harga token" tapi **"Memantau 12 pair di PancakeSwap, memicu 3 alert minggu ini."** Ini satu perubahan copywriting dengan dampak demo terbesar.

3. **[F] Empty state yang selalu preskriptif dan tidak pernah dead end.**
   Setiap state kosong harus menyebut aksi + menyediakan tombolnya: *"Belum punya agent — buat satu, lalu kembali untuk hire."* Juri secara eksplisit menguji "tanpa dead end".

4. **[F] Peringatan biaya + estimasi waktu sebelum eksekusi.**
   Tiru: *"Ini menjalankan siklus nyata dan menghabiskan X FUGU. Agent biasanya mulai dalam ~1 menit. Jika siklus sedang berjalan, permintaan ini tidak menambah antrean."*

5. **[F] Saldo agent ditampilkan di dialog pemilihan agent.**
   Saat user memilih agent mana yang akan meng-equip skill, tampilkan saldo tiap agent di baris yang sama.

6. **[F] Escape hatch + estimasi durasi di onboarding.**
   *"Buru-buru? Lewati — kamu bisa atur kepribadian nanti."* + *"Butuh 1–2 menit."*

7. **[F] Idempotensi visual: tandai item yang sudah di-hire dengan badge `Hired`.**
   Cegah user membayar dua kali untuk hal yang sama, dan tunjukkan status dengan jelas.

8. **[F][D] Pause-and-resume saat saldo habis, bukan gagal senyap.**
   Agent harus memberi tahu *dirinya sendiri* lewat kanal user, dengan link top-up, dan melanjutkan dari titik terakhir.

9. **[A] `level` sebagai signal-bar visual (1–2–3 batang).**
   Kesulitan/kompleksitas terbaca instan tanpa membaca teks.

10. **[F] Avatar fallback berwarna (`iconInitials` + `iconTint`).**
    Untuk Fugugent ini menjadi **varian fugu**: setiap agent mendapat fugu dengan warna/ekspresi berbeda, dihasilkan deterministik dari ID. Tidak pernah ada kartu kosong, dan identitas visual gratis.

### Wajib lampaui (di sinilah kita menang)

11. **[D] ⭐ Kartu agent harus punya metrik keputusan real-time yang HelloMinds tidak punya.**
    Minimal per kartu: **success rate (7 hari)**, **jumlah run**, **median latency**, **biaya rata-rata per run**, **terakhir aktif**, **jumlah hirer aktif**. Semua on-chain-verifiable. Ini menyerang langsung celah terbesar mereka dan kriteria juri Data Quality.

12. **[D] ⭐ Estimasi biaya *sebelum* hire, bukan hanya peringatan.**
    Tampilkan "≈0.4 BNB per 100 run, berdasarkan 1.284 run terakhir". HelloMinds hanya bilang *"complexity drives consumption"* — tidak bisa ditindaklanjuti.

13. **[D] ⭐ Reputasi creator yang nyata dengan identitas on-chain.**
    Field `creator` dengan alamat wallet, jumlah agent yang dipublikasikan, total run yang dilayani, dan rating agregat. HelloMinds 100% anonim.

14. **[D] Revenue share on-chain yang benar-benar berfungsi, bukan "coming soon".**
    Split otomatis lewat smart contract di BNB Chain, payout terlihat di explorer. Ini adalah janji yang HelloMinds gagal tepati — dan alasan paling kuat untuk memakai blockchain.

15. **[D] Rating + review terverifikasi, gated oleh bukti penggunaan.**
    Hanya wallet yang benar-benar pernah men-hire agent (terbukti on-chain) yang bisa memberi review. Ini adalah rating anti-sybil yang hanya mungkin di Web3.

16. **[F][D] Sandbox / dry-run gratis sebelum hire.**
    "Coba agent ini sekali, gratis" atau simulasi dengan data sampel. HelloMinds tidak punya sama sekali; setiap tes membakar uang.

17. **[A] ⭐ Filter kategori yang benar-benar berfungsi — kelemahan terbesar navigasi mereka.**
    HelloMinds punya 48 kategori di data tapi hanya menampilkan filter `All | Official`. Kita harus punya filter kategori first-class + multi-select + chip "clear all".

18. **[A] ⭐ Empat kategori dengan kedalaman yang benar-benar SAMA.**
    HelloMinds gagal di sini: 11 dari 19 template hanya punya 1 App dan 0 Skill. Aturan untuk kita: **setiap kategori minimal N agent, dan setiap agent minimal punya X tool + Y use-case terverifikasi.** Buat checklist paritas dan patuhi. Juri akan mengecek ini.

19. **[D] Leaderboard yang benar-benar ada.**
    Mereka menjanjikannya di `llms.txt` tapi tidak ada route-nya. Kita kirimkan: leaderboard by run, by revenue, by rating, dengan rentang waktu.

20. **[F] Detail agent sebagai halaman ber-URL, bukan hanya modal.**
    Modal HelloMinds tidak bisa di-share atau di-bookmark. Agent adalah aset — harus punya URL kanonik, OG image (fugu-nya!), dan bisa dibagikan.

21. **[D] Versioning + "last updated" + changelog per agent.**
    Tidak ada di HelloMinds. Ini sinyal kepercayaan yang murah dan kuat.

22. **[F] Aktivasi satu-transaksi, bukan copy-paste pesan.**
    Alur "salin pesan aktivasi lalu paste ke agent" milik mereka rapuh. Kita: connect wallet → klik Hire → satu tanda tangan → agent aktif. Terlacak, atomik, tidak bisa gagal diam-diam.

23. **[F] Panel monitoring real-time dengan log eksekusi live.**
    HelloMinds hanya punya "activity log" statis di balik login. Kita tampilkan run yang sedang berjalan, langkah demi langkah, plus tx hash. Ini secara langsung memberi bukti kriteria Data Quality kepada juri.

24. **[A] Guardrail sebagai item yang bisa dipilih (tiru "Passive Autonomous Soul").**
    Tawarkan preset batas: hanya-baca, batas belanja, whitelist kontrak. Untuk marketplace DeFi ini kebutuhan, bukan tambahan.

25. **[F] Pakai Composio (atau setara) untuk lapisan integrasi.**
    Katalog 119-App HelloMinds bukan buatan sendiri. Kita bisa mendapat kedalaman kategori instan dengan cara yang sama, lalu fokuskan tenaga engineering pada lapisan on-chain yang menjadi pembeda kita.

26. **[F] Landing page ber-SSR dengan konten nyata.**
    Marketplace mereka 100% client-rendered dan kartu tidak ada di HTML. Kita SSR halaman discovery — lebih cepat, bisa di-index, dan lebih baik saat didemokan lewat koneksi jelek.

29. **[F] Satu kalimat positioning yang setajam milik mereka.**
    Benchmark: *"You're not asking a Mind for an answer, you're giving it a job."* Fugugent butuh satu kalimat setara yang menjelaskan "kenapa marketplace agent" dalam sekali baca, dipasang di atas fold.

30. **[F] Loop retensi: daily quest + daily refill.**
    HelloMinds memasangkan *"clear a daily quest"* dengan auto top-up harian untuk agent bersaldo < 100. Murah dibangun, sangat cocok untuk audiens crypto, dan memberi juri sesuatu yang hidup untuk dilihat saat demo.

31. **[F] Samai *tingkat friksi* mereka, jangan salin anti-Web3-nya.**
    Mereka menang dengan *"No wallets, no code, no barriers — you're live in seconds."* Kita di BNB Chain, jadi jawabannya adalah embedded/smart wallet + aksi pertama tanpa gas, sehingga user bisa mencapai "agent pertama aktif" tanpa pernah melihat seed phrase.

32. **[F] Sediakan "markdown twin" untuk setiap halaman docs + tombol Copy MD.**
    Pola terbaik mereka yang paling murah ditiru. Juri (dan agent) bisa membaca docs kita sempurna.

33. **[D] Guardrail budget yang ditegakkan smart contract, bukan sekadar instruksi.**
    HelloMinds menjanjikan *"Never spend more than 500 Credits in a single session"* sebagai instruksi yang dipatuhi model. Di BNB Chain kita bisa **menjaminnya** dengan allowance on-chain. Ini adalah argumen "kenapa blockchain" yang paling meyakinkan untuk agent yang memegang uang.

34. **[F] Audit izin yang ditampilkan ke PEMBELI, bukan hanya publisher.**
    Langkah "Inspect" mereka hanya dilihat pembuat Skill. Kita tampilkan "agent ini bisa membaca X, bisa mengubah Y, bisa membelanjakan maksimal Z" di **halaman detail agent**, sebelum di-hire.

35. **[F] Semua aksi harus reversibel.**
    Penautan Telegram permanen dan penghapusan agent non-self-serve adalah dua kegagalan paling jelas di produk mereka. Setiap aksi di Fugugent harus bisa dibatalkan user sendiri.

36. **[F] Jangan pernah mengirim kontrol setengah jadi.**
    Filter tutorial yang dikompilasi kosong, tabel FAQ tanpa data, leaderboard yang dijanjikan tanpa route. Lebih baik hilangkan elemennya daripada menampilkannya rusak — juri menguji dead end.

37. **[D] Sertakan angka nyata pada setiap studi kasus/demo.**
    "3.300 views → 106 klik → 46 kunjungan, $0,08 per kunjungan" jauh lebih meyakinkan daripada klaim kualitatif. Untuk kita: run nyata, tx hash nyata, biaya nyata.

38. **[F] Label kejujuran + disclaimer risiko.**
    Tandai konten ilustratif sebagai ilustratif, dan beri disclaimer eksplisit pada apa pun yang menyentuh trading. Ini membangun kepercayaan, bukan mengurangi.

### Catatan identitas produk (fugu)

27. Konsep **State ("stress, focus, trust")** milik HelloMinds adalah hadiah untuk maskot fugu: **fugu mengembang saat stres.** Visualisasikan beban kerja/risiko agent sebagai tingkat mengembangnya fugu. Ini mengubah metrik abstrak menjadi umpan balik emosional yang instan — sesuatu yang HelloMinds, dengan bahasa visualnya yang datar dan korporat, tidak bisa lakukan.

28. Hindari menumpuk 13 istilah baru seperti mereka. Fugugent maksimal **4–5 istilah inti**. Sisanya pakai bahasa biasa.

---

## 9. Ringkasan Perbandingan

| Dimensi | HelloMinds | Target Fugugent |
|---|---|---|
| Unit yang dijual | Cognition Credits (bahan bakar) | Hire per agent + revenue share |
| Harga agent | Gratis di-equip | Transparan, on-chain, per-run |
| Metrik kartu | `equippedCount`, `level`, `tag` | + success rate, latency, biaya, run, creator, rating |
| Trust | Biner Official/Wild (Wild tak terpakai) | Reputasi on-chain + review tergated bukti |
| Creator | Anonim | Identitas wallet + earnings publik |
| Revenue share | ❌ "coming soon" | ✅ Smart contract, terverifikasi |
| Filter | `All \| Official` | Kategori multi-select + rentang harga + performa |
| Kanal | Email + Telegram | Web app real-time + wallet |
| Sandbox | ❌ | ✅ Dry-run gratis |
| Detail agent | Modal (tanpa URL) | Halaman kanonik + OG share |
| Kedalaman kategori | Timpang (11/19 dangkal) | Paritas 4 kategori dipaksakan |
| Integrasi | Composio (119 apps) | Composio + adaptor BNB Chain |
| Docs builder | 5 halaman | Lebih dalam |

---

## 10. Daftar URL Sumber

**Produk:**
- https://www.hellominds.ai/
- https://www.hellominds.ai/sitemap.xml
- https://www.hellominds.ai/robots.txt
- https://www.hellominds.ai/llms.txt
- https://www.hellominds.ai/llms-full.txt
- https://www.hellominds.ai/.well-known/agents.json
- https://www.hellominds.ai/data/bazaar.json
- https://www.hellominds.ai/data/minds.json
- https://www.hellominds.ai/data/toolkits.json
- https://www.hellominds.ai/assets/index-nE9hYUns.js
- https://www.hellominds.ai/bazaar (+ `/minds`, `/apps`, `/skills`)
- https://www.hellominds.ai/pricing
- https://www.hellominds.ai/docs/overview (+ core-concepts, getting-started, guides, security, troubleshooting)
- https://www.hellominds.ai/tutorials
- https://www.hellominds.ai/faq
- https://www.hellominds.ai/quiz/mindprint
- https://www.hellominds.ai/campaign/free-credits, /campaign/moca, /campaign/burn-sp

**Builder Hub:**
- https://build.hellominds.ai/sitemap.xml
- https://build.hellominds.ai/llms.txt
- https://build.hellominds.ai/robots.txt
- https://build.hellominds.ai/en/docs/get-started/account-setup
- https://build.hellominds.ai/en/docs/get-started/cli
- https://build.hellominds.ai/en/docs/get-started/client-library
- https://build.hellominds.ai/en/docs/guides/building-skills
- https://build.hellominds.ai/en/docs/guides/circles
- https://build.hellominds.ai/docs/api
- https://build.hellominds.ai/en/changelog
- https://build.hellominds.ai/en/program (+ /faq, /apply, /build-east)
- https://build.hellominds.ai/en/inspirations (+ etsy-shop-strategist, superior-trade-intern, architect-of-ancestry)

**Gagal / terbatas:**
- `https://build.hellominds.ai/llms-full.txt` → **404**
- `https://app.hellominds.ai/onboarding` → **butuh login**
- `https://www.hellominds.ai/profile` → **butuh login** (di-disallow di robots.txt)
