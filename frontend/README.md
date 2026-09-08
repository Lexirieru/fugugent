# frontend — Fugugent marketplace

`app.fugugent.xyz`. Next.js 16 + React 19 + Tailwind v4, dijalankan dengan **bun**.

```bash
bun --cwd frontend dev
bun --cwd frontend run build
bun --cwd frontend run lint
```

## Lapisan data — cara menukarnya ke backend sungguhan

Tidak ada satu pun komponen yang memanggil `fetch`. Semua halaman berbicara dengan
satu antarmuka, `MarketplaceSource` (`src/lib/data/types.ts`), dan memilih
implementasinya lewat `source()` di `src/lib/data/index.ts`:

| Implementasi | Berkas | Dipakai kapan |
|---|---|---|
| `seedSource` | `src/lib/data/seed.ts` | default — data contoh yang dibundel |
| `createHttpSource(base)` | `src/lib/data/http.ts` | begitu `NEXT_PUBLIC_API_BASE_URL` diisi |

```bash
# .env.local  (jangan pernah di-commit)
NEXT_PUBLIC_API_BASE_URL=https://api.fugugent.xyz
```

Endpoint yang dipanggil implementasi HTTP:

```
GET /api/agents?category=&limit=&offset=
GET /api/agents/:id
GET /api/categories
GET /api/health
```

Tiga hal yang membuat pertukaran itu tidak menyentuh UI:

1. **Amplopnya sama dengan `AgentListPage` di `backend/src/types.ts`.** Kegagalan
   diwakili `healthy: false` + `reason`, tidak pernah exception, sehingga halaman
   yang gagal tetap punya bentuk dan spanduk kejujurannya muncul sendiri.
2. **`bigint` diterjemahkan di satu tempat.** `src/lib/data/wire.ts` mengubah string
   desimal dari HTTP menjadi `bigint`, dan menolak `number` untuk nilai uang.
   `src/lib/money.ts` adalah satu-satunya tempat USD8 boleh menjadi teks.
3. **Risiko, izin sesi, dan bukti disimpan di `AgentView`, bukan di `AgentRecord`.**
   Bentuk `AgentRecord` sudah final di backend dan belum memuat ketiganya; saat
   backend menyajikannya, yang berubah hanya `toView()` di `http.ts`.

`src/lib/agent-types.ts` adalah **cermin** `backend/src/types.ts`. Kalau backend
berubah, berkas itu yang menyesuaikan — bukan sebaliknya.

## Fugu

`src/lib/fugu.ts` adalah port TypeScript dari `docs/brand/generate-svg.py`, generator
yang sama yang membuat aset di `landingpage/public/brand/`. Aset statis itu hanya
tersedia pada satu tingkat kembung untuk tiga dari empat karakter, sedangkan
marketplace harus bisa menggambar kombinasi karakter x tingkat mana pun. Keluarannya
string SVG supaya bisa dipakai komponen React **dan** `ImageResponse` (OG image).
