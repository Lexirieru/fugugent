# Altana Network — Riset Teknis Mendalam

> Untuk partner track **"Best Built with Altana"** di hackathon BNB Chain *Build the Era / The Smart Money Era*.
> Riset per **8 September 2026**. Semua klaim di bawah punya URL sumber. Kalau sesuatu tidak ada di sumber, ditulis eksplisit **"tidak ditemukan"** — tidak ada yang dikarang.

---

## 0. Ringkasan Eksekutif

**Altana Network** (sebelumnya *Functor Network*, dioperasikan oleh Serendipity Global Inc., Delaware, dba Altana Network) adalah **noncustodial authorization infrastructure untuk agentic workflows** — "the stack for sovereign agentic finance". Sumber: <https://www.altana.network/llms.txt>, <https://docs.altana.network/llms.txt>

Inti produknya bukan wallet-as-a-service, tapi **inversi tempat penyimpanan state otorisasi**: alih-alih menyimpan "kunci mana yang boleh bertindak" di backend vendor, Altana menaruhnya di **Keystore — registry publik on-chain**. Konsekuensinya: siapa pun bisa memverifikasi otoritas sebuah agent dengan satu `eth_call` gratis, tanpa API key, tanpa integrasi dengan Altana. Sumber: <https://docs.altana.network/concepts/keystore>

### Empat layer (versi resmi Altana)

| Layer | Isi |
|---|---|
| **Account** | Smart Agentic Wallet — smart account self-custodial per agent, alamat sama di semua chain |
| **Permissions** | Scoped session keys + **Keystore** (registry publik siapa yang live & sampai kapan) |
| **Execution** | **Intent relay** — mengubah intent agent jadi transaksi tereksekusi, disimulasikan sebelum ditandatangani, gas ditangani |
| **Commerce** | **x402 / B402** (bayar per-HTTP-request) dan **ERC-8183** (hire/dihire antar agent, escrow on-chain). Dua arah: agent bisa *earn*, bukan cuma *spend* |

Sumber: <https://www.altana.network/llms.txt>

### Angka & fakta kunci

| Item | Nilai |
|---|---|
| Paket SDK npm | `@altananetwork/sdk` **v0.9.0** (Apache-2.0, ESM, deps: `viem ^2.21.0`, `porto 0.2.37`, `ox ^0.14.0`) |
| Paket MCP npm | `@altananetwork/mcp` **v0.9.0** (Apache-2.0, ship sebagai TypeScript — **wajib `bunx`, bukan `npx`**) |
| Paket x402 seller | `@altananetwork/x402-server` **v0.2.0** (**GPL-3.0-or-later** ⚠️ lisensi beda) |
| Chain live (mainnet) | BNB Chain (56), Ethereum (1), Base (8453, cache-only) |
| Testnet full-stack | **BNB Smart Chain Testnet (97)** — keystore + account contracts + relay semuanya ada |
| Audit | CertiK, selesai **15 Juli 2026**, scope `KeyStore.sol` + `KeyStoreCacheOPStack.sol` + 6 file lain |
| Skills registry | **10 production skills**, semua fork-tested 2026-07-21 |
| Basis kode | SDK di-fork/extend dari **Porto** (<https://porto.sh>, MIT) untuk kompatibilitas Keystore |

Sumber npm: <https://registry.npmjs.org/@altananetwork/sdk> · <https://registry.npmjs.org/@altananetwork/mcp> · <https://registry.npmjs.org/@altananetwork/x402-server>
Sumber audit: <https://docs.altana.network/security/audits> · <https://skynet.certik.com/projects/altana>
Sumber acknowledgments: <https://docs.altana.network/acknowledgments>

### Peta URL

| Surface | URL |
|---|---|
| Website | <https://altana.network> |
| Arsitektur (teknis, keystore layer) | <https://altana.network/architecture> |
| Docs | <https://docs.altana.network> |
| **Docs mesin-readable (244 KB, semua halaman)** | <https://docs.altana.network/llms-full.txt> |
| Keystore Explorer (mainnet) | <https://explorer.altana.network> |
| Keystore Explorer (testnet) | <https://testnet.altana.network> |
| Skills Registry | <https://skills.altana.network> · index: <https://skills.altana.network/index.json> |
| XP program | <https://xp.altana.network> |
| GitHub org | <https://github.com/altananetwork> |
| Desktop app | <https://altana.network/download> |
| Kontak | founders@altana.network |

> ⚠️ **`https://docs.altana.network/sitemap.xml` → HTTP 404.** Yang ada adalah `https://altana.network/sitemap.xml` (5 URL saja: /, /download, /architecture, /privacy, /terms). Untuk crawling docs, pakai `llms.txt` / `llms-full.txt`.

### Repo GitHub (org @altananetwork — hanya 4 repo publik)

| Repo | Bahasa | Deskripsi |
|---|---|---|
| `altananetwork/altana-sdk` | TypeScript | Monorepo: `packages/wallet` (SDK), `packages/mcp`, `packages/x402-server`, `docs/` |
| `altananetwork/skills` | TypeScript | Skills Registry — 10 `SKILL.md` + `index.json` + harness fork-test |
| `altananetwork/altana-desktop-releases` | — | Artefak rilis desktop app |
| `altananetwork/agentic-ecosystem-board` | TypeScript | Data terbuka agent ERC-8004, wallet & holdings per chain, refresh harian |

Sumber: <https://api.github.com/orgs/altananetwork/repos>

---

## 1. Arsitektur, Konsep Wallet Agent & Sovereign Agent

### 1.1 Apa itu "sovereign agent" menurut Altana

> "An agent is only sovereign when no third party can act for it or stop it, and that comes down to who holds the keys. Handing an agent the seed phrase lets it spend everything. MPC or co-signing puts a key share with a third party that can approve, delay, or refuse. A custodial platform holds the funds outright. **With Altana, the owner holds the admin key, the agent holds a scoped session key, and no one else holds anything.**"

Sumber: <https://www.altana.network/llms.txt>

Pembagian peran (dua kunci yang tidak pernah dishare):

| Role | Key type | Dipegang oleh | Bisa dicabut? |
|---|---|---|---|
| Admin (kamu/user) | Passkey (P-256) **atau** private key (secp256k1) | Device / env / keychain kamu | Tidak — itu milikmu |
| Agent | Session key (secp256k1) | Proses agent | **Ya — 1 transaksi** |

Sumber: <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>

### 1.2 Smart Agentic Wallet

- Smart account **counterfactual**: alamat deterministik, **belum ter-deploy on-chain sampai `execute` pertama**.
- Alamat **sama di semua chain** yang dikonfigurasi.
- Berbasis **EIP-7702**: wallet adalah EOA yang di-delegate ke account contract.
- Admin key di-auto-register ke Keystore lewat `initialRegisterKey`, **di-batch ke dalam userOp pertama**.
- ⚠️ Browser wallet (MetaMask, Trust Wallet, Rabby) **tidak bisa jadi signer** — extension wallet menahan EIP-7702 delegation authorization dan menolak menandatangani raw relay digest. `SignerType` resmi hanya `"privateKey" | "passkey"`.

Sumber: <https://docs.altana.network/sdk/create-wallet> · <https://docs.altana.network/concepts/keystore> · <https://docs.altana.network/changelog>

### 1.3 Keystore — registry otorisasi on-chain

> "**Keystore is a public onchain registry.** For every Altana wallet, it stores which keys are currently authorized to act on it."

Model data (dari Explorer llms.txt): registry **signature-scheme-agnostic** yang memetakan
```
(user, keyId) → publicKey + metadata + lifecycle state
```
di mana `keyId` secara konvensi adalah `keccak256(publicKey)` (public key SEC1-encoded).

Sumber: <https://explorer.altana.network/llms.txt> · <https://docs.altana.network/concepts/keystore>

**Writes vs Reads:**

| Operasi | Jenis | Catatan |
|---|---|---|
| Register key | Write (lewat **Controller**) | Admin: otomatis pada `execute` pertama. Session: pada `grantSession` (default `register: true`) |
| Revoke key | Write (langsung ke **KeyStore**) | Di-gate `onlyKeyOwnerOrValidator` — hanya wallet sendiri atau validator. **Monotonic**: sekali dicabut tidak bisa dihidupkan lagi |
| `isValidKey(user, keyId)` | Read — **gratis, unlimited** | `eth_call` dari RPC mana pun. Menggabungkan 3 pertanyaan: key ada, belum dicabut, belum expired |
| `getKeys(user) → bytes32[]` | Read — gratis | ⚠️ **Revoke menghapus dari list; expiry TIDAK.** Key yang sudah lama expired tetap muncul di `getKeys` |

Sumber: <https://docs.altana.network/concepts/keystore>

**Yang penting untuk privasi:** dari halaman utama Altana —
> "only a hash of it is committed onchain, so the registry proves authority without publishing the details"

Artinya `permissions` di-commit sebagai **permissions hash**, bukan plaintext. Ini yang membuat `Session` harus di-restore *byte-exact* (lihat §2.6). Sumber: <https://www.altana.network/llms.txt>

**Event vocabulary (kontrak v1.1)** — yang di-index Explorer:

| Event | Contract | Arti |
|---|---|---|
| `KeyRegistered` | KeyStore (L1) | Key baru ditambahkan ke akun (root atau session) |
| `KeyRevoked` | KeyStore (L1) | Key dicabut. Monotonic |
| `NonceUpdated` | KeyStore (L1) | Validator counter naik (mis. WebAuthn signCount) |
| `FeeCollected` | Controller (L1) | Biaya registrasi dibayar; dikorelasikan ke `KeyRegistered` lewat tx hash |
| `KeyPopulated` | Cache (L2) | Key L1 dibuktikan masuk cache L2 |
| `KeyRevokedInCache` | Cache (L2) | Revokasi L1 dipropagasi ke cache |

Sumber: <https://explorer.altana.network/llms.txt>

### 1.4 Intent relay

`execute` tidak mengirim transaksi langsung; ia mengirim **intent/bundle** ke relay Altana yang mengeksekusinya. Relay menjawab polling status dengan kode numerik ala EIP-5792. Ini penting untuk error handling (§9).

- Relay BNB mainnet: `https://relay.altana.network`
- Relay BNB testnet: `https://testnet-relay.altana.network`
- **Base tidak punya relay** → `BASE` tidak bisa dipassing ke `createClient`, murni target verifikasi.

Sumber: <https://docs.altana.network/concepts/networks> · <https://docs.altana.network/concepts/networks/testnet>

### 1.5 Cross-chain: bagaimana otorisasi menyeberang tanpa bridge

Sessions di-grant di L1 (Ethereum = source of truth). Cache L2 di Base memverifikasi session yang sama lewat **storage proof (Merkle Patricia) terhadap state L1**, dianchor ke L1 block hash yang di-expose predeploy `L1Block` milik L2 — **tanpa bridge message, tanpa oracle, tanpa committee**.

`ensureKeyCached` menangani prosesnya dalam 4 tahap: `cache-hit` → `waiting-for-anchor` (1–3 menit) → `submitting-proof` → `done`.

Sumber: <https://docs.altana.network/use-cases/5-cross-chain-authorization> · <https://altana.network/architecture>

> ℹ️ Untuk hackathon BNB kita, **cross-chain tidak perlu**: BNB Chain punya Keystore standalone (bukan cache). Jalur `ensureKeyCached` hanya relevan Ethereum→Base.

---

## 2. Sessions — struktur, grant, batasan, revoke, baca dari Keystore

Ini bagian paling penting untuk syarat menang track.

### 2.1 Definisi

> "A **session** is a scoped, time-bounded delegation from a wallet's admin key to another key. The session key can act on the wallet, but only within the granted permissions, and only until the expiry. **Permissions are enforced onchain.** A session that tries to call a contract outside its allowlist, or spend beyond its cap, reverts at validation time. There is no off-chain trust assumption."

Sumber: <https://docs.altana.network/concepts/sessions>

### 2.2 Struktur data (verbatim dari docs)

```ts
type Session = {
  walletAddress: Address;       // the wallet this session can act on
  signer: Signer;               // the session key (agent signs with this)
  publicKey: Hex;               // identifier onchain
  permissions: SessionPermissions;
  expiry: number;               // unix epoch seconds
};

type SessionPermissions = {
  calls?: readonly CallPermission[];   // allowed contracts / signatures
  spend?: readonly SpendPermission[];  // per-token rolling caps
};
```

Sumber: <https://docs.altana.network/concepts/sessions>

### 2.3 Bentuk permission — allowlist kontrak & selector

```ts
calls: [
  { to: "0xUniswapRouter..." },               // any method on this contract
  { signature: "transfer(address,uint256)" }, // any contract, this method
  { signature: "swap(...)", to: "0xPool" },   // both, AND semantics
]
```

**Tiga bentuk allowlist:** per-kontrak (`to`), per-selector (`signature`), atau keduanya dengan **semantik AND**.

> ⚠️ **`permissions.calls` dihilangkan = UNRESTRICTED.** Kalau `calls` tidak dipassing, session bisa memanggil kontrak apa pun dalam batas spend cap. Docs bilang eksplisit: "Set both unless that's truly what you want."

Sumber: <https://docs.altana.network/concepts/sessions>

### 2.4 Spend cap

```ts
spend: [
  { limit: 100_000_000n, period: "day", token: "0xUSDC..." }, // 100 USDC/day on Ethereum (6 decimals)
  { limit: 10n ** 16n, period: "hour" },                       // 0.01 ETH/hour (native)
]
```

- `limit` dalam **smallest unit token**, `period` adalah **rolling period** (`"day"`, `"hour"` terlihat di contoh docs; daftar lengkap enum period **tidak ditemukan** di docs).
- `token` dihilangkan → cap untuk **native token**.

**Dua jebakan yang didokumentasikan sebagai warning:**

1. **Desimal berbeda per chain.** USDT & USDC pakai **18 desimal di BNB Chain**, 6 di Ethereum. Menulis `100_000_000n` untuk "100 USDT" di BNB = cap 0.0000000001 USDT.
2. **Native spend cap juga membayar relay fee.** Cap native menutupi fee, bukan cuma kiriman agent. Cap native mendekati nol (mis. 1 wei) = session yang tidak akan pernah bisa eksekusi satu transaksi pun — relay menolak setiap bundle sebelum inklusi (`FAILED`, `statusCode` **300**).

Sumber: <https://docs.altana.network/sdk/grant-session>

### 2.5 `grantSession` — signature lengkap

```ts
client.grantSession(opts: ClientGrantSessionOptions): Promise<GrantSessionResult>;

type ClientGrantSessionOptions = {
  wallet: Wallet;
  signer: Signer;                  // the wallet's admin signer
  permissions: SessionPermissions;
  /** Unix epoch seconds. Most apps use Date.now()/1000 + N. */
  expiry: number;
  /** Bring your own session signer, or omit to let the SDK generate one. */
  sessionSigner?: Signer;
  /** Register the key in Keystore (default true). */
  register?: boolean;
  /** Fee token (default: native token). */
  feeToken?: Address;
  /** Target chain. Defaults to the client's default chain. */
  chainId?: number;
};

type GrantSessionResult = Session & {
  /** The transaction that carried the grant, when the relay reported one. */
  transactionHash?: Hex;
};
```

**Contoh lengkap (verbatim docs):**

```ts
import { createClient, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const admin = signerFromPrivateKey("0x...");
const wallet = await client.createWallet({ signer: admin });

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: [{ to: "0xUniswapRouter..." }],
    spend: [{
      limit: 50n * 10n ** 18n,    // 50 USDT. Note: 18 decimals on BNB Chain.
      period: "day",
      token: "0xUSDT...",
    }],
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
});
```

**Apa yang mendarat on-chain — dalam SATU userOp, atomik:**
1. Public key session di-register di Keystore (lewat Controller) → **membuat otoritasnya provable ke siapa pun**.
2. Session di-authorize di smart account wallet dengan **permissions hash**-nya.

> "There is no intermediate state where one exists without the other."

⚠️ **Ini call yang membebani user biaya.** Ada one-time Keystore registration fee; pada aksi admin pertama sebuah wallet, fee dibayar **dua kali** karena `initialRegisterKey` untuk admin di-prepend ke userOp yang sama. `register: false` melewati fee (tapi lalu `verify_authorization` / Keystore reader tidak melihat session tersebut → **jangan pakai `register: false` untuk hackathon ini**, syarat menang mensyaratkan session terdaftar di Keystore).

Register belakangan: `await client.registerSessionKey({ wallet, signer: admin, session });`

⚠️ **Gotcha TypeScript:** anotasi eksplisit `const session: Session = await client.grantSession(...)` **menghapus** field `transactionHash`. Biarkan tipe di-infer, atau anotasi dengan `GrantSessionResult`.

Sumber: <https://docs.altana.network/sdk/grant-session>

### 2.6 Persist session — WAJIB pakai `serializeSession` / `deserializeSession`

> "A `Session` embeds the session's private key and bigint spend limits, so **never `JSON.stringify` it**."

Sejak SDK **0.9.0** (2026-09-02) field key internal dibuat **non-enumerable**, jadi `JSON.stringify`/`Object.keys` tidak pernah melihatnya. Siapa pun yang dulu mengandalkan kebocoran itu untuk persistence **harus migrasi**.

```ts
import { generatePrivateKey } from "viem/accounts";
import { signerFromPrivateKey, serializeSession, deserializeSession } from "@altananetwork/sdk";

// Grant: bring your own key, and store it where you keep secrets.
const sessionKey = generatePrivateKey();
await secrets.save("agent-1.key", sessionKey);                 // keychain, KMS, env — yours

const session = await client.grantSession({
  wallet, signer: admin,
  sessionSigner: signerFromPrivateKey(sessionKey),
  permissions, expiry,
});
await db.save("agent-1.session", serializeSession(session));   // JSON-safe, contains NO secret

// Restore — any process, any time:
const restored = deserializeSession(
  await db.load("agent-1.session"),
  signerFromPrivateKey(await secrets.load("agent-1.key")),
);
```

- `serializeSession` menyimpan `walletAddress`, `publicKey`, `permissions` (spend limit sebagai **decimal string**), `expiry`.
- `deserializeSession` merestore bigint dan **menolak key yang tidak cocok** dengan `publicKey` session yang terdaftar → gagal keras saat restore, bukan diam-diam saat execute.
- ⚠️ Kalau `sessionSigner` dihilangkan, SDK generate key yang **hanya ada di memori proses** dan memberi warning di console. Kalau hilang (crash / script selesai), otorisasi on-chain yang di-back key itu **permanen tidak bisa dipakai** — satu-satunya jalan keluar adalah revoke-and-regrant.

**Untuk produk kita: SELALU passing `sessionSigner` sendiri.**

Sumber: <https://docs.altana.network/sdk/grant-session#persisting-a-session> · <https://docs.altana.network/changelog>

### 2.7 `execute` — memakai session key

```ts
client.execute(opts: ClientExecuteOptions): Promise<ExecuteResult>;

// Admin path (first-party operations)
{ wallet: Wallet; signer: Signer; calls: Call | readonly Call[];
  feeToken?: Address; noWait?: boolean; chainId?: number; }

// Session path (agent-driven operations)
{ session: Session; calls: Call | readonly Call[];
  feeToken?: Address; noWait?: boolean; chainId?: number; }

type Call = { to: Address; data?: Hex; value?: bigint };

type ExecuteResult = {
  callsId: Hex;
  status: "CONFIRMED" | "FAILED" | "PENDING";
  transactionHash?: Hex;
  statusCode?: number;   // the relay's raw numeric status, when observed
};
```

```ts
const result = await client.execute({
  session,
  calls: [{ to: "0xYourContract", data: "0x", value: 0n }],
});
console.log(result.status, result.transactionHash);
```

**Dampak Keystore:**

| Skenario | Menyentuh Keystore? |
|---|---|
| `execute` admin pertama di wallet baru | Ya (admin key di-register) |
| `execute` admin berikutnya | Tidak |
| **Semua session `execute`** | **Tidak** (session sudah di-register saat grant) |

⚠️ **`execute` yang gagal TIDAK melempar exception.** Ia mengembalikan `status: "FAILED"`. Kalau kamu cuma `try/catch`, kamu tidak akan menyadarinya.

Sumber: <https://docs.altana.network/sdk/execute> · <https://docs.altana.network/sdk/errors>

### 2.8 `revokeSession`

```ts
client.revokeSession(opts: ClientRevokeSessionOptions): Promise<ExecuteResult>;

type ClientRevokeSessionOptions = {
  wallet: Wallet;
  signer: Signer;                 // the wallet's admin signer
  session: Session | Hex;         // the Session object or its public key
  feeToken?: Address;
  chainId?: number;
};
```

```ts
// Bentuk paling ringkas
await client.revokeSession({ wallet, signer: admin, session });

// Hanya punya public key (kasus umum di UI: user klik "revoke" dari daftar di DB)
const sessionPublicKey = "0x04..." as `0x${string}`;
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```

- Setelah konfirmasi, **`execute` berikutnya dari session itu revert di tahap validasi**.
- Efek **langsung** di chain tempat key terdaftar; tidak perlu koordinasi off-chain.
- **Monotonic** — sekali dicabut, tidak bisa diaktifkan lagi. Untuk memberi akses lagi: grant session baru dengan keypair baru.
- Hanya **admin signer** wallet yang bisa mencabut (`onlyKeyOwnerOrValidator`).
- Revoke yang gagal **mengembalikan** `status: 'FAILED'`, tidak melempar.

**Cross-chain revocation (hanya kalau pakai Ethereum→Base):**

```ts
import { syncKeyToL2, ETHEREUM, BASE } from "@altananetwork/sdk";

await client.revokeSession({ wallet, signer: admin, session });
await syncKeyToL2({
  l1Client, l2Client, l2WalletClient,
  l1KeyStore: ETHEREUM.keyStore,
  l2Cache: BASE.keyStoreCache,
  user: session.walletAddress,
  publicKey: session.publicKey,
});
```

Sumber: <https://docs.altana.network/sdk/revoke-session>

### 2.9 Membaca session dari Keystore on-chain (verifikasi pihak ketiga)

Ini yang akan dilakukan juri. **Gratis, tanpa API key, tanpa admin key, tanpa session, tanpa apa pun dari Altana.**

```ts
import { createPublicClient, http, keccak256 } from "viem";
import { BNB } from "@altananetwork/sdk";

const client = createPublicClient({
  chain: BNB.chain,
  transport: http(BNB.publicRpcUrl),
});

// Keystore identifies a key by its key id: keccak256 of the SEC1-encoded public key.
const keyId = keccak256(sessionPublicKey);

const KEYSTORE_ABI = [{
  name: "isValidKey", type: "function", stateMutability: "view",
  inputs: [
    { name: "user", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ type: "bool" }],
}] as const;

// One eth_call answers: is this key allowed to act on this wallet right now?
const authorized = await client.readContract({
  address: BNB.keyStore,
  abi: KEYSTORE_ABI,
  functionName: "isValidKey",
  args: [walletAddress, keyId],
});
```

- `isValidKey` return `true` **hanya kalau** key ada, belum dicabut, dan belum expired.
- Untuk seluruh set key di wallet: `getKeys(walletAddress)` → `bytes32[]`, lalu cek satu-satu dengan `isValidKey`.
- ⚠️ Ingat: revoke menghapus dari `getKeys` seketika, **expiry tidak**.

**Catatan sub-delegation (verbatim dari docs):**
> "Only the wallet admin grants sessions. Do not read this as one agent minting a sub-key for another. It is the admin authorizing both agents, and the agents verifying each other. If session-to-session sub-delegation lands later, the docs will be updated."

Sumber: <https://docs.altana.network/use-cases/4-verify-agent-authority> · <https://docs.altana.network/concepts/keystore>

### 2.10 Lifecycle ringkas

| Stage | Fungsi | Dampak Keystore |
|---|---|---|
| Grant | `grantSession` | **Write.** Session public key di-register by default |
| Use | `execute({ session, calls })` | Tidak ada |
| Verify | Siapa pun baca `isValidKey` | Tidak ada. Gratis, unlimited |
| Revoke | `revokeSession` | **Write** (gated `onlyKeyOwnerOrValidator`). Monotonic |
| Expire | Otomatis pada `expiry` | Tidak ada. **Tidak ada transaksi** |

Sumber: <https://docs.altana.network/concepts/sessions>

---

## 3. Alamat Kontrak — BNB Mainnet & Testnet

### 3.1 BNB Smart Chain — export SDK `BNB`

| Item | Nilai |
|---|---|
| Chain id | **56** |
| Public RPC | `https://bsc-rpc.publicnode.com` |
| Explorer | <https://bscscan.com> |
| Relay | `https://relay.altana.network` |
| **KeyStore** | `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` |
| **KeyStoreController** | `0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555` |

Verifikasi source code: <https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> (source-verified, exact match)

### 3.2 BNB Smart Chain Testnet — export SDK `BNB_TESTNET`

| Item | Nilai |
|---|---|
| Chain id | **97** |
| Public RPC | `https://bsc-testnet-rpc.publicnode.com` |
| Explorer | <https://testnet.bscscan.com> |
| **Faucet** | <https://testnet.bnbchain.org/faucet-smart> |
| Relay | `https://testnet-relay.altana.network` |
| **KeyStore** | `0x6b8361C29d05D498b1a12B54A37310f94171E94A` |
| **KeyStoreController** | `0xb530D1971f5453F3359518343F05D0AedFfF7e12` |

**Account stack (dipakai relay) — testnet:**

| Contract | Address |
|---|---|
| Orchestrator | `0xcb5CEf3C54aa90e9A7ad602A258D3d360cC862B9` |
| Delegation proxy | `0x4F4ddE38Da9F8AbBb96C48cA520b992D4bADc3D6` |
| Account implementation | `0x33aD2F49ab9f122f5F0FDF579f575724EfF353DE` |
| Simulator | `0x3006de101E96e85272d5B5Ad07A9738fa7678008` |
| Funder | `0xb248602EAadd9c3e2Db4575C4e4d58003b7a2740` |
| Escrow | `0xCd075ceb5Cd463a9233a8085fc915767139F655c` |

**Token testnet:**

| Token | Address | Fungsi |
|---|---|---|
| EXP | `0xa8071DA5e994cB8e3eB56CaD0FBB6ca424dD8dc0` | fee token (bayar relay fee dengan test token, bukan tBNB) |
| EXP2 | `0x61727778216127D0843A99A3e91e99C27e9f3BC7` | fee token |
| **$U token** | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | token ekonomi agent, escrow ERC-8183 |
| **$U faucet** | `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3` | `requestTokens()` → 10 $U per address / 30 menit |

> ⚠️ Alamat account-stack di atas **hanya ada untuk testnet** di halaman docs. Padanan untuk BNB mainnet **tidak ditemukan** di dokumentasi publik (halaman `/concepts/networks` untuk BNB hanya mencantumkan KeyStore + KeyStoreController).

### 3.3 Ethereum & Base (referensi, tidak dipakai untuk track ini)

| Network | Chain id | Kontrak |
|---|---|---|
| Ethereum (`ETHEREUM`) | 1 | KeyStore `0xb70fDa90C1d576Ba8399946a0c10ECD9d9Ea923b` · Controller `0x30a188Eecf14F4142B0d828ce838C9E1134e7FaA` · RPC `https://ethereum-rpc.publicnode.com` · Relay `https://relay.altana.network` |
| Base (`BASE`) | 8453 | KeyStoreCache `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` · RPC `https://base-rpc.publicnode.com` · **tanpa relay, read-only** |

### 3.4 ERC-8183 / ERC-8004 — registry alamat (dari source code SDK)

Diambil verbatim dari `packages/wallet/src/erc8183.ts`, export `ERC8183_ADDRESSES`:

| Kontrak | BSC Mainnet (56) | BSC Testnet (97) |
|---|---|---|
| `commerce` (AgenticCommerce kernel) | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` |
| `router` (EvaluatorRouter) | `0x51895229E12F9876011789B04f8698af06cCD6DA` | `0xD7d36D66d2F1B608A0F943f722D27e3744f66F25` |
| `policy` (OptimisticPolicy) | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` |
| `registry` (ERC-8004 identity, ERC-721) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| `paymentToken` (**$U** / United Stables) | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |

Sumber: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>
Source of truth untuk semua alamat network: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/config.ts>

### 3.5 Alamat protokol BNB mainnet (dari Skills Registry — untuk membangun allowlist)

| Protokol | Kontrak | Address |
|---|---|---|
| PancakeSwap | V2 Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| PancakeSwap | V2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| PancakeSwap | USDT/WBNB pair (LP) | `0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE` |
| — | WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| — | USDT (BSC-USD) | `0x55d398326f99059fF775485246999027B3197955` |
| — | USDC (BNB) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| Four.meme | TokenManager2 (curve V2) | `0x5c952063c7fc8610FFDB798152D69F0B9550762b` |
| Four.meme | TokenManagerHelper3 (reads) | `0xF251F83e40a78868FcfA3FA4599Dad6494E46034` |
| Venus | vUSDT (core pool) | `0xfD5840Cd36d94D7229439859C0112a4185BC0255` |
| Lista | ListaStakeManager | `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` |
| Lista | slisBNB | `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` |
| Aave V3 | Pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` |
| Aave V3 | aBnbUSDT (aToken) | `0xa9251ca9DE909CB71783723713B21E4233fbf1B1` |
| Permit2 | canonical | `PERMIT2_ADDRESS` diekspor dari `@altananetwork/sdk` (docs menyebut prefix `0x0000…78BA3`) |

Sumber: <https://skills.altana.network/llms-full.txt> · <https://docs.altana.network/use-cases/6-agent-pays-api-x402> · <https://docs.altana.network/concepts/off-chain-signatures>

---

## 4. SDK & MCP Server

### 4.1 `@altananetwork/sdk` — v0.9.0

```bash
npm install @altananetwork/sdk viem
```

| Metadata | Nilai |
|---|---|
| Versi latest | `0.9.0` (dirilis 2026-09-02) |
| Riwayat versi | 0.3.2 → 0.3.3 → 0.4.0 → 0.5.0 → 0.5.1 → 0.6.0 → 0.7.0 → 0.7.1 → 0.8.0 → **0.9.0** |
| Lisensi | Apache-2.0 |
| Module type | ESM (`"type": "module"`) |
| Dependencies | `viem ^2.21.0`, `porto 0.2.37`, `ox ^0.14.0` |
| Repo | `github.com/altananetwork/altana-sdk`, directory `packages/wallet` |
| Unpacked size | ~440 KB |

> ⚠️ **Pre-1.0. Minor version bisa berisi breaking changes.** (docs: "These packages are pre-1.0. Minor versions may contain breaking changes.") **Pin versi exact di `package.json`.**

Sumber: <https://registry.npmjs.org/@altananetwork/sdk> · <https://docs.altana.network/changelog>

#### Permukaan API (dari docs + llms.txt)

**Client & chains**
- `createClient({ chains, defaultChainId? })`
- Export chain config: `BNB`, `BNB_TESTNET`, `ETHEREUM`, `BASE`
- Properti chain config yang dipakai di contoh docs: `.chain`, `.publicRpcUrl`, `.keyStore`, `.keyStoreCache`

**Signers**
- `signerFromPrivateKey(pk)` — dari private key hex
- `createPrivateKeySigner()` — generate baru
- `createPasskey()` — passkey (browser, WebAuthn)
- `createHeadlessPasskey()` — passkey P-256 in-memory untuk Node/script test, tanpa prompt biometrik
- `SignerType` = `"privateKey" | "passkey"` (sejak 0.9.0 `"injected"` dihapus dari union)

**Wallets**
- `client.createWallet({ signer? })` → `{ address, signer }`
- `client.createPasskeyWallet({ name, rpId })`
- `client.recoverFromPasskey({ rpId, webAuthn? })`

**Sessions & execution**
- `client.grantSession(opts)` → `GrantSessionResult`
- `client.execute(opts)` → `ExecuteResult`
- `client.revokeSession(opts)` → `ExecuteResult`
- `client.registerSessionKey({ wallet, signer, session })`
- `serializeSession(session)` / `deserializeSession(stored, signer)`

**Reads**
- `client.balances({ wallet, tokens?, chainId? })` → `{ native: bigint, tokens?: TokenBalance[] }`
  - Multicall ter-batch; per-token `{ ok, display, symbol, raw, scaled? }`
  - Auto-handle **BEP-677** scaled UI amounts (ERC-165 id `0xa60bf13d`)

**Cross-chain**
- `ensureKeyCached(...)`, `syncKeyToL2({ l1Client, l2Client, l2WalletClient, l1KeyStore, l2Cache, user, publicKey })`

**Off-chain signatures & payments**
- `signOrder` / `signOrderTypedData` — ERC-1271 nested envelope
- `client.fetchWithX402({ session, url, init?, chainId?, preferRail? })`
- `client.approveTokenForPermit2({ wallet, signer, token })`
- `client.approveSignatureChecker({ wallet, signer, session, checker })`
- `PERMIT2_ADDRESS`
- Low-level: `fetchWithX402`, `selectX402Requirement`, `signX402Payment`, `buildPermit2TypedData`, `buildPermit2WitnessTypedData`, `buildEip3009TypedData`, `encodeXPaymentHeader`, `networkToChainId`, `normalizeResource`

**ERC-8183**
- `hireErc8183Agent`, `buildHireCalls`, `getErc8183Job`, `getErc8183DeliverableUrl`, `verifyErc8183ManifestText`, `submitErc8183Deliverable`, `buildSubmitCall`, `erc8183SubmitPermissions(chainId)`, `settleErc8183Job`, `buildClaimRefundCall`, `encodeErc8183Manifest`, `erc8183ManifestHash`, `ERC8183_ADDRESSES`, `JOB_STATUS`

**ERC-8004**
- `registerErc8004Agent`, `setErc8004AgentUri`, `getErc8004Agent`, `encodeErc8004AgentUri`, `decodeErc8004AgentUri`, `withErc8004Registration`, `erc8004RegisterPermissions(chainId)`

Sumber: <https://docs.altana.network/sdk> dan seluruh halaman `/sdk/*` via <https://docs.altana.network/llms-full.txt>

### 4.2 Contoh kode lengkap — grant → execute → revoke (verbatim docs)

**Step 1: Create your wallet**
```ts
import { createClient, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const signer = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);

const wallet = await client.createWallet({ signer });
console.log(wallet.address);
```
> **Fund `wallet.address` with BNB before step 2.**

**Step 2: Grant the agent a session**
```ts
import { createPrivateKeySigner } from "@altananetwork/sdk";
import { parseEther } from "viem";

const session = await client.grantSession({
  wallet,
  signer,
  sessionSigner: createPrivateKeySigner(),                  // the agent's key — SDK generates it
  permissions: {
    calls: [{ to: "0xYourContract" }],                      // only this contract
    spend: [{ limit: parseEther("0.1"), period: "day" }],   // 0.1 BNB per day
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
});
```

**Step 3: The agent executes**
```ts
const result = await client.execute({
  session,
  calls: [{ to: "0xYourContract", data: "0x", value: 0n }],
});

console.log(result.status, result.transactionHash);
```

**Step 4: Revoke the session**
```ts
await client.revokeSession({ wallet, signer, session });
```

Sumber: <https://docs.altana.network/use-cases/1-agent-wallet-policy>

### 4.3 Contoh: agent trading di DEX dengan cap (PancakeSwap)

```ts
// wallet from the "Give an agent a wallet and a policy" guide
const session = await client.grantSession({
  wallet,
  signer,
  permissions: {
    calls: [{ to: "0xPancakeRouter..." }],                          // only this router
    spend: [{ limit: 100_000_000_000_000_000_000n, period: "day", token: "0xStable..." }],
  },
  expiry: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
});

// The agent builds swap calldata and executes within the cap.
await client.execute({
  session,
  calls: [{ to: "0xPancakeRouter...", data: "0xSwapCalldata...", value: 0n }],
});
```

Sumber: <https://docs.altana.network/use-cases/2-agent-trades-dex>

### 4.4 Contoh: multi-agent di satu wallet (relevan untuk marketplace kita)

```ts
// Agent A: swaps on PancakeSwap, cap X.
const sessionA = await client.grantSession({
  wallet, signer,
  permissions: {
    calls: [{ to: "0xPancakeRouter..." }],
    spend: [{ limit: capX, period: "day", token: "0xStable..." }],
  },
  expiry,
});

// Agent B: lending / rebalance, cap Y.
const sessionB = await client.grantSession({
  wallet, signer,
  permissions: {
    calls: [{ to: "0xLendingPool..." }],
    spend: [{ limit: capY, period: "day", token: "0xStable..." }],
  },
  expiry,
});

// Revoke Agent A without touching Agent B:
await client.revokeSession({ wallet, signer, session: sessionA });
// Agent B keeps working.
```

Sumber: <https://docs.altana.network/use-cases/3-portfolio-multiple-agents>

### 4.5 Passkey path (untuk UI konsumer — user = admin lewat Face ID / Touch ID)

```ts
import { createClient, BNB } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });

const wallet = await client.createPasskeyWallet({
  name: "MyApp",
  rpId: "myapp.example", // your app's domain
});

const session = await client.grantSession({
  wallet,
  signer: wallet.signer,          // your passkey signs this
  permissions: {
    calls: [{ to: "0xSomeContract..." }],
    spend: [{ limit: 50_000_000_000_000_000n, period: "day" }], // 0.05 BNB/day cap
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 1 day
});

// recovery on any device
const recovered = await client.recoverFromPasskey({ rpId: "myapp.example" });

// revoke
await client.revokeSession({ wallet, signer: wallet.signer, session });
```

Untuk testing di Node/script tanpa prompt biometrik:
```ts
import { createClient, BNB, createHeadlessPasskey } from "@altananetwork/sdk";
const client = createClient({ chains: [BNB] });
const wallet = await client.createWallet({ signer: createHeadlessPasskey() });
```

Ada **demo live interaktif** flow ini di halaman docs (komponen `<PasskeyAgentDemo />`) — tombol yang langsung memanggil SDK terhadap BNB. Berguna untuk verifikasi cepat sebelum coding.

Sumber: <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>

⚠️ `recoverFromPasskey` butuh minimal satu active key di Keystore → **wallet harus pernah execute minimal sekali**. Wallet yang dibuat tapi tidak pernah dipakai tidak punya apa-apa untuk di-recover.

### 4.6 `@altananetwork/mcp` — v0.9.0

**WAJIB Bun ≥ 1.1.** Paket ini di-ship sebagai TypeScript dan berjalan di bawah Bun. **`npx` gagal dengan TypeScript syntax error**, bukan pesan yang berguna.

```bash
claude mcp add altana -- bunx @altananetwork/mcp
# hapus:
claude mcp remove altana
```

Pilih chain lewat env `ALTANA_CHAIN` (satu proses server = satu chain):

| `ALTANA_CHAIN` | Chain |
|---|---|
| `bnb` (default) | BNB Smart Chain (56) |
| `ethereum` | Ethereum (1) |
| `bnb-testnet` | BNB Smart Chain Testnet (97) |

```bash
claude mcp add altana -e ALTANA_CHAIN=bnb-testnet -- bunx @altananetwork/mcp
```

Cursor / Continue / host lain:
```json
{
  "mcpServers": {
    "altana": {
      "command": "bunx",
      "args": ["@altananetwork/mcp"]
    }
  }
}
```

> ℹ️ Catatan inkonsistensi sumber: `https://altana.network/llms.txt` menampilkan snippet MCP dengan `"command": "npx"`, sementara halaman docs `/mcp/install` eksplisit bilang **npx gagal** dan semua contohnya `bunx`. **Ikuti docs: pakai `bunx`.**

**Penyimpanan key (namespace terpisah, tidak pernah bentrok):**

| Jenis | Urutan lookup |
|---|---|
| Wallet admin key | 1. OS keychain service `altana-wallet` → 2. `~/.altana/keys.json` → `wallets[]` (mode 0600) → 3. env `ALTANA_WALLET_<NAME>_PRIVATE_KEY` (default: `ALTANA_WALLET_DEFAULT_PRIVATE_KEY`) |
| Session key | 1. OS keychain service `altana-session` → 2. `~/.altana/keys.json` → `sessions[]` → 3. env `ALTANA_SESSION_<NAME>_PRIVATE_KEY` |

> "Altana never sees these keys. They stay on your machine."

Sumber: <https://docs.altana.network/mcp/install> · <https://registry.npmjs.org/@altananetwork/mcp>

### 4.7 MCP tools — 20 tools

> ⚠️ Inkonsistensi di dokumentasi sendiri: halaman `/mcp` bilang "**18 tools** … **12 prompts**", halaman `/mcp/tools` bilang "**20 tools** … **Eleven** of them also have a slash command" lalu mendaftar 12 slash command (11 tool + `demos` yang tidak memetakan ke tool). Daftar aktual di `/mcp/tools` berisi **20 tools**; itu yang dipakai di bawah.

| Kategori | Tools |
|---|---|
| Discovery | `about_altana` |
| Wallet lifecycle | `create_wallet`, `list_wallets`, `wallet_balance`, `wallet_execute` |
| **Verification** | `wallet_verification` (list semua active key di wallet dari Keystore), **`verify_authorization`** (apakah key/session ini authorized di wallet ini sekarang?) |
| **Session lifecycle** | **`grant_session`** (generate key, register di Keystore, authorize dengan permissions; return session details, **keyId**, dan **tx hash grant**), `list_sessions`, **`session_execute`**, **`revoke_session`** |
| Agent commerce | `x402_request`, `erc8183_create_job`, `erc8183_job_status`, `erc8183_settle`, `erc8183_submit` |
| Agent identity | `erc8004_register`, `erc8004_set_agent_uri`, `erc8004_show` |
| Skills | `search_skills`, `get_skill` |

**Slash commands (11 tool + `demos`):**

| Slash command | Memanggil |
|---|---|
| `/altana-agentic-wallet:about` | `about_altana` |
| `/altana-agentic-wallet:create-wallet` | `create_wallet` |
| `/altana-agentic-wallet:list-wallets` | `list_wallets` |
| `/altana-agentic-wallet:wallet-balance` | `wallet_balance` |
| `/altana-agentic-wallet:wallet-info` | `wallet_verification` |
| `/altana-agentic-wallet:verify-session` | `verify_authorization` |
| `/altana-agentic-wallet:grant-session` | `grant_session` |
| `/altana-agentic-wallet:list-sessions` | `list_sessions` |
| `/altana-agentic-wallet:session-execute` | `session_execute` |
| `/altana-agentic-wallet:revoke-session` | `revoke_session` |
| `/altana-agentic-wallet:send-tx` | `wallet_execute` |
| `/altana-agentic-wallet:demos` | (listing demo flows, bukan tool) |

**10 tools TANPA slash command** (host-callable saja, minta host memanggilnya by name): `x402_request`, `erc8183_create_job`, `erc8183_job_status`, `erc8183_settle`, `erc8183_submit`, `erc8004_register`, `erc8004_set_agent_uri`, `erc8004_show`, `search_skills`, `get_skill`. Mengetik `/altana-agentic-wallet:x402-request` **tidak akan resolve**.

Sumber: <https://docs.altana.network/mcp/tools>

### 4.8 Claude Code Skill (untuk menulis kode SDK yang benar)

```bash
mkdir -p .claude/skills/altana-agentic-wallet
curl -fsSL https://docs.altana.network/skill.md \
  -o .claude/skills/altana-agentic-wallet/SKILL.md
```

Untuk Codex: `curl -fsSL https://docs.altana.network/skill.md >> AGENTS.md`
Untuk Cursor: taruh di `.cursor/rules/` · Windsurf: `.windsurfrules` · Gemini CLI: `GEMINI.md`

Sumber lengkap skill: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/SKILL.md>

> ℹ️ **Jangan campur aduk:** Claude Skill ini mengajari coding agent cara **menulis kode** dengan SDK. **Skills Registry** (§7) mengajari *running* agent cara **memakai protokol**. Beda audiens, beda file, format `SKILL.md` sama.

Sumber: <https://docs.altana.network/mcp/skill> · <https://docs.altana.network/getting-started/build-with-claude>

---

## 5. ERC-8183 — Hire & Get Hired

### 5.1 Apa spesifikasinya

**ERC-8183 adalah job escrow** untuk agent commerce:

1. **Buyer** mendanai sebuah **Job** dalam **$U** terhadap alamat **seller**.
2. **Seller** submit **deliverable**.
3. Escrow **release** setelah **optimistic dispute window**.
4. Kalau seller tidak pernah deliver, buyer **reclaim** seluruh escrow setelah expiry.

Status job (order-locked dengan AgenticCommerce kernel):
```ts
export const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
```

Struktur Job (dari source SDK):
```ts
export type Erc8183Job = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  statusName: JobStatusName;
  hook: Address;
  submittedAt: bigint;
  /** 32 zero-bytes until the seller submits. */
  deliverable: Hex;
};
```

Sumber: <https://docs.altana.network/sdk/erc8183> · <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>

**Relasi dengan ERC-8004:** ERC-8004 = **identitas/discoverability** (token ERC-721 di identity registry, `tokenURI` = registration record: nama, deskripsi, endpoint). Buyer menemukan seller lewat ERC-8004, lalu **ERC-8183 job escrow adalah apa yang mereka lakukan berikutnya**. Sumber: <https://docs.altana.network/sdk/erc8004>

### 5.2 Buyer side — `hireErc8183Agent`

```ts
import { hireErc8183Agent, BNB } from "@altananetwork/sdk";

const { jobId } = await hireErc8183Agent(wallet, signer, {
  provider: "0xSellerAgentAddress",
  task: "Audit wallet 0x…'s Venus position and recommend an action.",
  budget: 100_000_000_000_000_000n, // 0.1 $U (18 decimals)
}, { network: BNB });
```

> "One call runs the whole buyer flow — `createJob`, `registerJob` (binds the dispute policy), `setBudget`, `approve $U`, `fund` — as **one atomic relay intent**."

**Jalur session key juga bekerja:** `hireErc8183Agent(session, params, opts)` — "so a scoped key with an on-chain spend limit caps what an autonomous agent can ever escrow." **Ini bagian bonus track yang paling kuat: agent otonom yang hire agent lain, dibatasi spend cap on-chain.**

Low-level builder: `buildHireCalls({ addresses, jobId, provider, description, budget, expiredAt })`.
`jobId` diprediksi dari `jobCounter() + 1` (job id 1-indexed); kalau job lain dibuat di blok yang sama, batch revert tanpa efek samping (`registerJob` client-only) — baca ulang counter dan retry.

`description` ≤ 4096 bytes. `expiredAt` absolute unix seconds, **harus melebihi now + disputeWindow**.

### 5.3 Track job & ambil deliverable

```ts
import { getErc8183Job, getErc8183DeliverableUrl } from "@altananetwork/sdk";

const job = await getErc8183Job(BNB, jobId);       // OPEN → FUNDED → SUBMITTED → COMPLETED
if (job.submittedAt > 0n) {
  const url = await getErc8183DeliverableUrl(BNB, jobId);
  const manifest = await (await fetch(url)).json(); // manifest.response.content
}
```

**Verifikasi integritas (WAJIB):** `job.deliverable` on-chain adalah keccak256 dari canonical manifest.

```ts
import { verifyErc8183ManifestText } from "@altananetwork/sdk";

const text = await (await fetch(url)).text();
if (!verifyErc8183ManifestText(text, job.deliverable)) throw new Error("tampered deliverable");
const manifest = JSON.parse(text); // manifest.response.content
```

### 5.4 Seller side — `submitErc8183Deliverable`

Grant session seller dengan `erc8183SubmitPermissions(chainId)` — capability yang di-scope **persis ke `submit()` di commerce kernel**.

```ts
import { submitErc8183Deliverable, erc8183SubmitPermissions } from "@altananetwork/sdk";

const result = await submitErc8183Deliverable(
  session,                      // or (wallet, signer, …) for the admin path
  {
    jobId,
    manifest: {
      version: 1,
      job_id: Number(jobId),
      chain_id: 56,
      contracts: { commerce: A.commerce, router: A.router, policy: A.policy },
      response: { content: "…the work…", content_type: "text/plain" },
      metadata: {},
    },
    deliverableUrl: "https://your-agent.example/manifests/123.json",
  },
  { network: BNB },
);

// Serve result.manifestText VERBATIM at deliverableUrl — byte-for-byte.
```

**Dua hal yang mudah salah kalau dikerjakan manual:**

1. **Canonical hashing lintas bahasa.** Hash on-chain dihitung atas *canonical JSON*: keys tersortir, compact, dan **setiap karakter non-ASCII di-escape `\uXXXX`** — persis seperti referensi Python (`json.dumps(…, sort_keys=True, separators=(",", ":"))` dengan `ensure_ascii` default). `JSON.stringify` biasa menghasilkan byte berbeda untuk konten apa pun yang mengandung em-dash, aksen, atau emoji, dan hash-nya tidak akan verify lintas ekosistem. Pakai `encodeErc8183Manifest` / `erc8183ManifestHash`.
2. **Sajikan byte hasil hash yang persis.** Buyer memverifikasi *raw* fetched text terhadap hash on-chain — re-serialize saat serve merusak verifikasi. `result.manifestText` adalah string yang harus disajikan.

Pre-flight checks melempar error yang actionable sebelum submit: wrong provider, job belum FUNDED (atau sudah SUBMITTED), atau lewat deadline.
Low-level: `buildSubmitCall({ addresses, jobId, deliverable, optParams })`.

### 5.5 Settle / dispute / reclaim

```ts
import { settleErc8183Job, buildClaimRefundCall } from "@altananetwork/sdk";

await settleErc8183Job(wallet, signer, { jobId }, { network: BNB });          // release escrow (after the window)
await settleErc8183Job(wallet, signer, { jobId, action: "dispute" }, opts);   // contest (inside the window)
await execute(wallet, signer, buildClaimRefundCall(56, jobId), opts);         // full refund after expiry
```

### 5.6 Dapatkan $U testnet

Faucet publik di BSC testnet (97): `requestTokens()` membayar **10 $U** ke caller, sekali per address per **30 menit**. Klaim langsung dari Altana wallet lewat relay — smart account adalah `msg.sender`, jadi payout mendarat di wallet:

```ts
import { encodeFunctionData } from "viem";
import { createClient, BNB_TESTNET } from "@altananetwork/sdk";

const U_FAUCET = "0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3";

const client = createClient({ chains: [BNB_TESTNET] });
await client.execute({
  wallet,
  signer,
  chainId: 97,
  calls: [{
    to: U_FAUCET,
    data: encodeFunctionData({
      abi: [{ name: "requestTokens", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
      functionName: "requestTokens",
    }),
  }],
});
```

Atau dari EOA biasa dengan test BNB untuk gas:
```bash
cast send 0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3 "requestTokens()" \
  --rpc-url https://bsc-testnet-rpc.publicnode.com --private-key $AGENT_KEY
```

Read-only `allowedToWithdraw(address)` melaporkan apakah klaim sedang diizinkan.

### 5.7 ⚠️ Bug testnet yang SUDAH diperbaiki di 0.9.0

Dari changelog 0.9.0:
> "**BSC testnet (chain 97) hire flow no longer reverts.** The bundled `ERC8183_ADDRESSES[97].policy` pointed at an address that is not whitelisted on the testnet EvaluatorRouter, so every `hireErc8183Agent()` / `buildHireCalls()` run on BSC testnet reverted at `registerJob` with `PolicyNotWhitelisted()`."

**Konsekuensi praktis: kalau kita pakai ERC-8183 di BSC testnet, WAJIB `@altananetwork/sdk` ≥ 0.9.0.** Versi 0.8.0 ke bawah akan revert.

Sumber: <https://docs.altana.network/changelog>

### 5.8 ERC-8004 — grant capability yang aman

```ts
import { createClient, erc8004RegisterPermissions, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: erc8004RegisterPermissions(56),
    // A small native cap covers gas; nothing else can leave the wallet.
    spend: [{ limit: 20_000_000_000_000_000n, period: "day" }], // 0.02 BNB
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
});
```

`erc8004RegisterPermissions(chainId)` mengembalikan dua rule `{ to, signature }` dengan **semantik AND**:
```ts
[
  { to: "0x8004A169…", signature: "register(string,(string,bytes)[])" },
  { to: "0x8004A169…", signature: "setAgentURI(uint256,string)" },
]
```

> 🚨 **JANGAN PERNAH grant seluruh registry.** Docs memberi `:::danger`: session dieksekusi **sebagai wallet**, dan wallet adalah owner identity token. Grant `{ to: registry }` tanpa `signature` juga akan mengotorisasi `transferFrom`/`safeTransferFrom` (agent bisa memberikan identitasnya), `approve`/`setApprovalForAll` (**operator approval yang HIDUP LEBIH LAMA daripada revokasi session**), dan `setAgentWallet`/`setMetadata` (identity poisoning).
>
> **Ini contoh sempurna untuk demo/pitch kita: kenapa selector-level allowlist penting, bukan sekadar contract-level.**

Registrasi 2-fase (karena record menyematkan id yang di-assign oleh mint):

```ts
import {
  registerErc8004Agent, setErc8004AgentUri, encodeErc8004AgentUri,
  withErc8004Registration, BNB,
} from "@altananetwork/sdk";

// Phase 1: registrations is empty — the id does not exist yet.
const record = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Vault Sentinel",
  description: "Watches Venus positions and alerts on liquidation risk.",
  image: "",
  services: [{ name: "A2A", endpoint: "https://sentinel.example/.well-known/agent-card.json" }],
  registrations: [],
} as const;

const { agentId } = await registerErc8004Agent(
  session, { agentUri: encodeErc8004AgentUri(record) }, { network: BNB },
);

// Phase 2: bind the assigned id to this registry and publish the finished record.
await setErc8004AgentUri(
  session,
  { agentId, agentUri: encodeErc8004AgentUri(withErc8004Registration(record, agentId, 56)) },
  { network: BNB },
);
```

⚠️ `registerErc8004Agent` **menolak `opts.noWait`** — `agentId` hanya ada di event `Registered` pada receipt yang confirmed. Kalau relay wait timeout, error membawa `callsId` — recover id dari receipt bundle itu, **jangan register ulang** (akan mint identitas KEDUA untuk agent yang sama).

`register` dan `setAgentURI` bersifat `nonpayable`: **tidak ada protocol fee, hanya gas.**

`encodeErc8004AgentUri` menghasilkan `data:application/json;base64,<canonical JSON>` — byte-identical dengan yang dihasilkan SDK TypeScript & Python `@bnbagent` untuk record yang sama.

Sumber: <https://docs.altana.network/sdk/erc8004>

---

## 6. x402 / B402

### 6.1 Perbedaan x402 vs B402 di BNB Chain

| Aspek | x402 (standar) | B402 (Binance/BNB) |
|---|---|---|
| Wire | HTTP 402 + header `X-PAYMENT` (base64) | Sama, tapi beberapa merchant baca `PAYMENT-SIGNATURE` |
| Rail utama | `exact` / **EIP-3009** `TransferWithAuthorization` | **permit2-exact** — `PermitWitnessTransferFrom` dengan recipient di-bind lewat Permit2 **witness** |
| Checker (ERC-1271) | token contract | canonical **Permit2** |
| Token cocok | hanya token yang EIP-3009-nya ERC-1271-aware (Circle FiatTokenV2_2 — USDC Base/Ethereum) | token apa pun yang di-approve ke Permit2 |
| Envelope | `payload.permit` + sibling `payload.from` (dialek Altana) | `payload.permit2Authorization` dengan `from` nested (dialek b402) |
| `resource` | boleh string URL | biasanya object `{ url, description?, mimeType? }` — merchant menolak envelope tanpa ini (CoinMarketCap menjawab `payment header resource is null`) |

**Kesimpulan praktis untuk BNB Chain: pakai rail `permit2-exact`.** Ini "the reliable rail" menurut docs. Rail EIP-3009 di BNB hanya relevan untuk **$U** (dipakai buyer BNB Agent Studio).

Sumber: <https://docs.altana.network/sdk/x402> · <https://docs.altana.network/concepts/off-chain-signatures>

### 6.2 Buyer side — `fetchWithX402`

**Provisioning sekali (admin):**
```ts
import { createClient, BNB, PERMIT2_ADDRESS, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const admin = signerFromPrivateKey("0x...");
const wallet = await client.createWallet({ signer: admin });
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // BNB USDC

const session = await client.grantSession({
  wallet, signer: admin,
  permissions: {
    calls: [{ to: USDC }],
    spend: [{ limit: 1_000_000_000_000_000_000n, period: "day", token: USDC }],
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
});

await client.approveTokenForPermit2({ wallet, signer: admin, token: USDC });
await client.approveSignatureChecker({ wallet, signer: admin, session, checker: PERMIT2_ADDRESS });
```

**Agent bayar & fetch:**
```ts
const res = await client.fetchWithX402({
  session,
  url: "https://api.example.com/paid-endpoint",
});
// 402 → sign payment → retry → 200 + content, transparently.
console.log(res.status, await res.text());
```

Parameter:
```ts
type ClientFetchWithX402Options = {
  session: Session;
  url: string;
  init?: RequestInit;
  /** Only pay options on this chain when any match. Defaults to the client's chain. */
  chainId?: number;
  /** Preferred rail when a chain offers several. Defaults to "permit2". */
  preferRail?: "permit2" | "eip3009";
};
```

⚠️ **Jalankan `fetchWithX402` server-side.** Endpoint x402 pihak ketiga umum tidak memasukkan `X-PAYMENT` ke CORS `Access-Control-Allow-Headers`, jadi browser tidak bisa POST pembayaran.

⚠️ **Signature bukan EOA signature** — ini envelope ERC-1271 98-byte (`innerSig ‖ keyHash ‖ prehash`). Facilitator **harus** verify lewat `isValidSignature`, bukan `ecrecover`. Payment bisa valid & settleable on-chain tapi tetap ditolak facilitator yang mengasumsikan EOA.

Sumber: <https://docs.altana.network/use-cases/6-agent-pays-api-x402> · <https://docs.altana.network/sdk/x402>

### 6.3 Kenapa `approveSignatureChecker` wajib

Altana account tidak memverifikasi signature terhadap raw application digest. Ia membungkus ulang digest itu dalam **nested EIP-712 envelope** yang dikunci ke alamat account:

```
nested = keccak256(0x1901 ‖ domainSeparator ‖ structHash)
  domainSeparator = keccak256(abi.encode(
                      keccak256("EIP712Domain(address verifyingContract)"), wallet))
  structHash      = keccak256(abi.encode(
                      keccak256("ERC1271Sign(bytes32 digest)"), appDigest))
```

Domain EIP-712 account sengaja **dipangkas ke `verifyingContract` saja** (tanpa name/version/chainId).

Dan: `isValidSignature` sebuah session key mengembalikan magic value **hanya kalau `msg.sender` adalah approved checker** untuk key tersebut (super-admin key melewati gate ini). Tanpa `approveSignatureChecker`, verifikasi mengembalikan `0xffffffff` bahkan untuk signature yang sempurna valid.

| Rail | Checker yang harus di-approve |
|---|---|
| Permit2 / permit2-exact | canonical Permit2 (`0x0000…78BA3`) |
| EIP-3009 | contract token-nya (mis. USDC) |

Jalankan **sekali per session, per rail**.

Sumber: <https://docs.altana.network/concepts/off-chain-signatures> · <https://docs.altana.network/sdk/approve-signature-checker>

### 6.4 Seller side — `@altananetwork/x402-server`

```bash
npm install @altananetwork/x402-server viem
```

> "`@altananetwork/x402-server` is the seller side of x402/B402: put one guard in front of any HTTP route and it becomes a paid capability with instant on-chain settlement."

**Payable out of the box oleh:**
- **BNB Agent Studio agents** (`bag x402 trust <your-url>` → `bag x402 buy`) — mereka menandatangani EIP-3009 `TransferWithAuthorization` di **$U (United Stables)**
- **Altana wallets** (`fetchWithX402` / MCP `x402_request`) — session key smart-account menandatangani rail B402 permit2-exact (ERC-1271)
- Apa pun yang berbicara **B402 v2 wire** (CAIP-2 networks, `scheme:"exact"`, `extra.assetTransferMethod`)

**Contoh lengkap (verbatim README repo):**

```ts
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { createX402Merchant, U_TOKEN, USDT_BSC } from "@altananetwork/x402-server";

const merchant = createX402Merchant({
  chainId: 56,
  payTo: "0xYourAltanaSmartAccount",          // where earnings land
  price: 200_000_000_000_000_000n,            // 0.2 per call (18 dec)
  minPrice: 50_000_000_000_000_000n,          // clamp floor
  maxPrice: 2_000_000_000_000_000_000n,       // clamp ceiling
  rails: [
    { rail: "eip3009", token: U_TOKEN[56] },  // Studio buyers
    { rail: "permit2-exact", token: USDT_BSC, spender: facilitator.address }, // Altana/B402 buyers
  ],
  resource: "https://api.example.com/audit",
  facilitator: privateKeyToAccount(process.env.FACILITATOR_KEY),  // settler EOA (gas only)
  rpcUrl: "https://bsc-dataseed.binance.org",
  chain: bsc,
});

Bun.serve({
  port: 8080,
  async fetch(req) {
    const { response, receipt } = await merchant.guard(req);
    if (response) return response;             // 402 (challenge or rejection)
    return Response.json({ data: await doTheWork(), tx: receipt.txHash });
  },
});
```

**Export yang ada:** `createX402Merchant`, `U_TOKEN` (map chainId → alamat $U), `USDT_BSC`.

**Flow pembayaran per-call:**
1. Request tanpa payment → `merchant.guard(req)` mengembalikan `{ response }` berisi **402 challenge** dengan payment requirements (`accepts[]`: scheme, network, asset, amount, receiver).
2. Buyer menandatangani authorization, base64-encode ke header `X-PAYMENT`, retry.
3. `guard()` menjalankan off-chain checks dulu (token, amount dalam `[minPrice, maxPrice]`, recipient, expiry, signature).
4. Settlement on-chain **seketika** lewat facilitator EOA (hanya broadcast + bayar gas).
5. `guard()` mengembalikan `{ response: undefined, receipt }` → route kamu jalan, `receipt.txHash` tersedia.

| Rail | Buyer signs | Settled via | Verified by |
|---|---|---|---|
| `eip3009` | `TransferWithAuthorization` ($U) | `token.transferWithAuthorization(bytes)` | contract token |
| `permit2-exact` | `PermitWitnessTransferFrom` | `Permit2.permitWitnessTransferFrom` | Permit2 |

**Properti keamanan:**
- Dana bergerak **langsung dari payer ke `payTo`**. Recipient **di-bind ke dalam signature buyer** (EIP-3009 `to` / permit2 Witness) → **facilitator key yang kompromi tidak bisa mengalihkan earnings**.
- **Replay mustahil**: EIP-3009 nonce dan Permit2 nonce bitmap terbakar on-chain.
- Smart-account signature yang checker-restricted (session key Altana) diverifikasi oleh **contract settling itu sendiri**; payment invalid revert dan request ditolak.

**Aturan kompatibilitas untuk buyer BNB Agent Studio:**
- Tawarkan `maxTimeoutSeconds ≤ 480` (default 300). Signer Studio menolak authorization window > 600s dan **backdate `validAfter` 120 detik**.
- Buyer Studio membayar **$U lewat eip3009 SAJA** — sertakan rail itu agar bisa dibayar mereka.
- `bag x402 trust` **membutuhkan URL https di production**.

**Dialek envelope buyer** yang diterima decoder tanpa perlu tahu client mana yang membayar: `payload.permit` + `payload.from` (Altana) **atau** `payload.permit2Authorization` dengan `from` nested (b402); header dibaca dari `X-PAYMENT` dengan fallback `PAYMENT-SIGNATURE`; `resource` boleh string URL atau object, selalu di-emit sebagai object.

**Verified end-to-end:** `tests/e2e/fork-x402-server.ts` menjalankan kedua keluarga buyer terhadap fork BNB mainnet asli ($U, USDT, Permit2 bytecode asli): settlement eip3009 envelope Studio, settlement permit2-witness session-key Altana, dan penolakan replay. Jalankan `bun run fork:x402-server` dari `tests/e2e`.

> ⚠️ **Lisensi berbeda:** `@altananetwork/x402-server` adalah **GPL-3.0-or-later**, sementara `@altananetwork/sdk` dan `@altananetwork/mcp` Apache-2.0. Pertimbangkan implikasinya kalau kode server kita mau dijadikan closed-source. (Sumber: registry npm masing-masing paket.)

> ⚠️ **`repository.url` di manifest npm `x402-server` menunjuk `github.com/altananetwork/sdk`, yang tidak ada** (repo aslinya `altana-sdk`). Salah ketik di package.json mereka; README aktual ada di `altana-sdk/packages/x402-server/README.md`.

Sumber: <https://docs.altana.network/sdk/x402-server> · <https://github.com/altananetwork/altana-sdk/blob/main/packages/x402-server/README.md> · <https://registry.npmjs.org/@altananetwork/x402-server>

---

## 7. Skills Registry — 10 Production Skills

<https://skills.altana.network> · index JSON: <https://skills.altana.network/index.json> · katalog penuh: <https://skills.altana.network/llms-full.txt> · raw canonical: <https://raw.githubusercontent.com/altananetwork/skills/main/index.json>

### 7.1 Konsep

> "A session gives your agent authority. A skill gives it competence."

Skill = **satu file `SKILL.md`** yang mengajari agent cara sebuah protokol benar-benar bekerja: kontrak yang tepat, quirk yang merusak integrasi naif, dan urutan call yang persis untuk setiap aksi umum. Altana menguji setiap skill dengan **agent nyata di private fork mainnet** sebelum live. **Gratis dipakai**, dan agent mencarinya sendiri.

**Pemisahan kritikal (ini yang membuat skill aman dishare):**
> "A skill is public, readable text. It cannot grant anything… An agent holding the PancakeSwap skill and no session can do exactly nothing."

Kolom "may not" di setiap katalog **bukan janji dari penulis skill** — itu adalah apa yang **session-mu tegakkan on-chain**, dan yang siapa pun bisa verifikasi dari Keystore.

**Aturan rumah yang tidak boleh dilanggar:** plays **tidak pernah menandatangani**. Setiap write on-chain lewat Altana session executor — `client.execute({ session, calls })` (SDK) atau tool MCP `session_execute`. Reads langsung ke RPC. "That one rule is what keeps a skill from being able to widen its own scope."

Sumber: <https://docs.altana.network/skills> · <https://skills.altana.network/llms.txt>

### 7.2 Anatomi sebuah skill (4 bagian)

1. **Frontmatter** — `name` (= nama direktori, id skill), `description` (satu kalimat mulai dengan verb, menyebut protokol + chain). Ini teks yang di-match agent saat mencari registry.
2. **Reference** — tabel alamat checksummed (hanya kontrak yang benar-benar disentuh plays) + **Quirks**: 3–6 fakta protokol yang merusak integrasi naif, satu baris masing-masing + signature fungsi.
3. **Playbook** — 2–5 **play** per skill, masing-masing menyebut parameter dan **Typical time**, langkah bernomor agar agent bisa menjalankan seluruh play dalam satu skrip.
4. **Guards (do not remove)** — keputusan keamanan: output floor, verifikasi balance on-chain setelah setiap state change, retry limit, dan apa yang dilakukan saat gagal ("stop and report, never improvise outside the session scope"). **Certification memverifikasi guards, jadi submission tidak bisa memangkasnya.**

> **Tabel alamat punya fungsi ganda: suggested session scope diturunkan darinya.**

Sumber: <https://docs.altana.network/skills> · <https://docs.altana.network/skills/submit>

### 7.3 Cara memanggil

**Lewat MCP (jalur yang dimaksudkan):**
```bash
claude mcp add altana -- bunx @altananetwork/mcp
```
- `search_skills({ query })` → skill yang cocok + scope + certification scorecard, di-rank berdasarkan berapa kata query yang match
- `get_skill({ id })` → `SKILL.md` penuh. **Konten di-integrity-check terhadap `sha256` registry sebelum dikembalikan** — playbook yang di-tamper ditolak, bukan diikuti. Juga mengembalikan scope (allowed contracts, suggested spend cap) dan scorecard.

Registry URL default ke main branch repo publik, **override dengan env `ALTANA_SKILLS_INDEX_URL`**.

**Lewat HTTPS biasa (tanpa MCP):**
- `https://skills.altana.network/index.json`
- `https://skills.altana.network/llms-full.txt` (semua 10 SKILL.md dalam satu fetch)
- `https://skills.altana.network/skills/<id>/SKILL.md`

Sumber: <https://skills.altana.network/llms.txt> · <https://docs.altana.network/mcp/tools>

### 7.4 Katalog lengkap — 10 skills

Semua `verified: fork-tested by Altana` pada **2026-07-21**. Semua `publisher: Altana`.
`askAt` menandakan kapan input diminta: **`grant`** = saat membuat session (masuk ke policy), **`run`** = saat menjalankan play.

---

#### 1. PancakeSwap Trading — `pancakeswap-trading` v1.0.0
- **Chain:** bnb · **Kategori:** Trading · **Suggested cap:** 50 USDT
- **sha256:** `8721c5294ac8e3475ab7b14c41f397061e9c4de550f86c5ec17a51da8db1f4d5`
- **Deskripsi:** Buy and sell tokens on PancakeSwap on BNB Chain through an Altana session. In and out of positions fast, with quotes, slippage protection, and full-balance exits.
- **Scope contracts:** PancakeSwap V2 Router `0x10ED43C718714eb63d5aA57B78B54704E256024E` · WBNB `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` · USDT `0x55d398326f99059fF775485246999027B3197955`
- **Inputs:** `token` (address, run) · `amountUsdt` (usd, run) · `slippagePct` (percent, run, default 1) · `takeProfitPct` (percent, run) · `stopLossPct` (percent, run)
- **Plays:** `enter-position`, `exit-position`, `round-trip`, `tp-sl-watch`
- **May:** Trade on PancakeSwap; Spend up to the cap you set
- **May not:** Send funds anywhere else; Touch any other app or token
- **Example ask:** *"ape $20 into $TOKEN, sell at 30% profit"*
- **Quirks penting:** USDT di BNB **18 desimal**, bukan 6 → $20 = `20n * 10n**18n`. Route selection: quote pair langsung **DAN** hop WBNB dengan `getAmountsOut`, pakai yang lebih baik. Approve sebelum setiap arah swap. Fee-on-transfer token butuh `swapExactTokensForTokensSupportingFeeOnTransferTokens`.

#### 2. Four.meme Trading — `four-meme` v1.0.0
- **Chain:** bnb · **Kategori:** Trading · **Suggested cap:** 0.1 BNB
- **sha256:** `c39a51afa14cee0ff6dac9803547641f07f3c58efc8bae9dc6ad5c3353e0070b`
- **Deskripsi:** Snipe and trade memecoin launchpad curves on Four.meme, and hand off to PancakeSwap after graduation.
- **Scope contracts:** TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b` · TokenManagerHelper3 (reads) `0xF251F83e40a78868FcfA3FA4599Dad6494E46034` · PancakeSwap V2 Router (post-graduation) · WBNB
- **Inputs:** `token` (address, run) · `amountBnb` (bnb, run) · `amountToken` (amount, run — juga menerima `"all"`) · `slippagePct` (percent, run, default 3)
- **Plays:** `buy-on-curve`, `sell-on-curve`, `check-curve-status`, `round-trip`, `graduation-handoff`
- **May:** Buy and sell on Four.meme curves; Spend BNB up to the cap you set
- **May not:** Send funds anywhere else; Touch any other app or token
- **Example ask:** *"snipe 0.05 BNB into this four.meme launch, sell at 2x"*

#### 3. PancakeSwap Liquidity — `pancakeswap-liquidity` v1.0.0
- **Chain:** bnb · **Kategori:** Liquidity · **Suggested cap:** 50 USDT
- **sha256:** `80d8bb4435689a2a696b22ebbf295c7f805c43f6287d1cd0c6e97951c3548b0f`
- **Deskripsi:** Provide and withdraw PancakeSwap V2 liquidity to earn trading fees on your token pairs.
- **Scope contracts:** V2 Router · V2 Factory `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` · WBNB · USDT · USDT/WBNB pair (LP) `0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE` — *pair tokens approve ke router saja*
- **Inputs:** `tokenA`, `tokenB` (address, run) · `amount` (amount, run — sisi lain diturunkan dari rasio pool) · `lpAmount` (amount, run — juga `"all"`) · `slippagePct` (default 1)
- **Plays:** `add-liquidity`, `remove-liquidity`, `position-check`
- **May:** Add and remove PancakeSwap liquidity; Spend up to the cap you set
- **Example ask:** *"put $50 into the USDT/WBNB pool and show my share"*

#### 4. Copy Trade — `copy-trade` **v1.1.0** (satu-satunya yang bukan 1.0.0)
- **Chain:** bnb · **Kategori:** Trading · **Suggested cap:** 50 USDT
- **sha256:** `d5458abd494a096f4ba208e7e534259fffdd1b5351a37130ec634514e18d1e37`
- **Deskripsi:** Mirror a wallet you name on PancakeSwap under hard per-trade and total caps.
- **Scope contracts:** PancakeSwap V2 Router · V2 Factory · WBNB · USDT — *traded tokens approve ke router saja*
- **Inputs (semua `askAt: grant` — masuk ke policy!):** `leaderWallet` (address) · `perTradeMaxUsd` (usd, default 10) · `totalBudgetUsd` (usd, default 50) · `screenTokens` (boolean, default true)
- **Plays:** `follow`, `mirror-exit`, `stop`
- **May:** Mirror the PancakeSwap trades of the wallet you name; Spend up to the caps you set
- **May not:** Follow any wallet you did not give it; Exceed per-trade or total caps; Send funds anywhere else; Touch any other app
- **Example ask:** *"copy 0xab...'s trades, $10 max each, stop at $50"*
- 💡 **Skill paling menarik untuk demo UI kita** — semua input diminta pada tahap *grant*, jadi UI "atur izin agent" punya form yang kaya dan langsung memetakan ke session policy.

#### 5. Venus Lending — `venus-lending` v1.0.0
- **Chain:** bnb · **Kategori:** Lending · **Suggested cap:** 100 USDT
- **sha256:** `69bcf2a17ffe4624dcb9d98321299f166e045787a6ffad1219f0f5d331f77bf7`
- **Deskripsi:** Lend stablecoins on Venus Protocol on BNB Chain through an Altana session.
- **Scope contracts:** vUSDT (core pool) `0xfD5840Cd36d94D7229439859C0112a4185BC0255` · USDT
- **Inputs:** `amountUsdt` (usd, run — withdraw juga menerima `"all"`)
- **Plays:** `supply`, `withdraw`, `position-check`, `pay-once`, `auto-refill`
- **May:** Supply and withdraw stablecoins on Venus; Spend up to the cap you set
- **Example ask:** *"lend $100 USDT on venus"*
- 🚨 **PERINGATAN KRITIS (dari halaman Errors docs):** Venus core-pool **vBNB `redeem` REVERT** dari Altana wallet. Alasan: Altana wallet adalah EOA yang di-delegate (EIP-7702); membayar wallet native coin lewat `.transfer()`/`.send()` hanya meneruskan 2300-gas stipend, tidak cukup menjalankan delegated account code. **Payout ERC-20 tidak terpengaruh.** Workaround: pakai jalur wrapped-token (WBNB), gateway yang membayar dengan `call{value:}` full-gas (Venus NativeTokenGateway di mana ter-deploy), atau terima ke plain EOA. **Tidak ada perbaikan sisi SDK** — root cause di contract pembayar. → **Untuk demo, pakai vUSDT (ERC-20), JANGAN vBNB.**

#### 6. x402 API Payments — `x402-payments` v1.0.0
- **Chain:** **multi** · **Kategori:** Payments · **Suggested cap:** 25 USDT
- **sha256:** `8250aae2d2ba2ce1320e5fc1b48e6389e5751b197e787c3e65199143b9fb75b7`
- **Deskripsi:** Pay for APIs and services over HTTP with the x402 protocol from an Altana session. Per-use payments in stablecoins, no accounts or cards, spend-capped and revocable.
- **Scope contracts:** Permit2 · USDT (BSC-USD)
- **Inputs:** `maxPricePerPaymentUsd` (usd, **grant**, default 1) · `totalBudgetUsd` (usd, **grant**, default 25) · `resourceUrl` (url, run)
- **Plays:** `pay-once` (~10s), `auto-refill` (loop sampai budget habis)
- **May:** Pay x402 invoices per request; Spend up to the cap you set
- **Guards:** Selalu tegakkan max price; jangan pernah tanda tangani authorization di atasnya. Track cumulative spend dan berhenti di budget. **Hanya bayar endpoint yang user sebut — jangan ikuti 402 dari redirect ke host berbeda tanpa melapor dulu.**
- **Quirks:** Amount dalam smallest unit (USDT BNB = 18 desimal). **Session menandatangani via ERC-1271 melalui smart account: wallet yang membayar adalah alamat smart account, BUKAN alamat session key.** Rail BNB pakai Permit2 dengan USDT; approval USDT→Permit2 sekali, ditangani SDK pada pembayaran pertama. Pembayaran dihitung terhadap spend cap session seperti outflow lainnya.

#### 7. Lista Liquid Staking — `lista-staking` v1.0.0
- **Chain:** bnb · **Kategori:** Staking · **Suggested cap:** 0.5 BNB
- **sha256:** `67f15a40d3b2cf09a7317ca0a9e3a07dab083001cc17a999c46764cf1406e5ac`
- **Deskripsi:** Stake BNB for slisBNB on Lista and earn staking yield while staying liquid.
- **Scope contracts:** ListaStakeManager `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` · slisBNB `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` (approve ke manager saja)
- **Inputs:** `amountBnb` (bnb, run) · `amountSlisBnb` (amount, run) · `requestIndex` (integer, run, default 0)
- **Plays:** `stake`, `unstake-request`, `claim` (setelah unbonding period), `position-check`
- **May:** Stake BNB on Lista; Request withdrawals back to BNB; Spend BNB up to the cap you set
- **Example ask:** *"stake 0.2 BNB on lista and show me the yield"*

#### 8. Aave V3 Lending — `aave-v3-lending` v1.0.0
- **Chain:** bnb · **Kategori:** Lending · **Suggested cap:** 50 USDT
- **sha256:** `20416c8f288207d32abc6217b5cf7ef239d4fa80e1cbbe8184e5d4c892a82f81`
- **Deskripsi:** Supply USDT to Aave V3 on BNB Chain to earn yield, and withdraw on command.
- **Scope contracts:** Aave V3 Pool `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` · aBnbUSDT `0xa9251ca9DE909CB71783723713B21E4233fbf1B1` · USDT (approve ke Pool saja)
- **Inputs:** `amountUsdt` (usd, run)
- **Plays:** `supply`, `withdraw`, `position-check`
- **May:** Supply USDT to Aave V3; Withdraw your position; Spend up to the cap you set
- **May not:** **Borrow** ← eksplisit out-of-scope on purpose; Send funds anywhere else; Touch any other app or token
- **Example ask:** *"park 30 USDT in aave and tell me the APY"*

#### 9. Token Radar — `dexscreener-token-radar` v1.0.0
- **Chain:** bnb · **Kategori:** **Research** · **Suggested cap:** **none, research only**
- **sha256:** `dc541956a847e00c2793da679b8a4121a5b9f46f08f07d852b88f86681c39a0b`
- **Deskripsi:** Find trending BNB Chain tokens and screen them for liquidity and risk before trading.
- **Scope contracts:** `[]` (kosong)
- **Inputs:** `token` (address, run) · `condition` (text, run) · `count` (integer, run, default 10) · `intervalSeconds` (integer, run, default 30)
- **Plays:** `trending-scan`, `token-screen`, `watch`
- **May:** Read public market data; Screen tokens and report risks
- **May not:** **Submit any transaction; Touch any contract or token**
- **Example ask:** *"what's pumping on BNB right now? screen the top one"*

#### 10. Wallet Tracker — `wallet-tracker` v1.0.0
- **Chain:** bnb · **Kategori:** **Research** · **Suggested cap:** **none, research only**
- **sha256:** `271ce8f1bae98c3c943a2d48c454d762ac85000f9067bcaa25d11c9aed7525f9`
- **Deskripsi:** Watch any BNB Chain wallet's trades live, profile its recent activity, and find a token's early buyers.
- **Scope contracts:** `[]` (kosong)
- **Inputs:** `wallet` (address, run) · `token` (address, run) · `intervalSeconds` (default 30) · `windowBlocks` (default 20000) · `count` (default 10)
- **Plays:** `watch-wallet`, `profile-wallet`, `find-early-buyers`
- **May:** Read public onchain activity; Watch and profile wallets
- **May not:** Submit any transaction; Touch any contract or token
- **Example ask:** *"watch what 0xab... is buying and tell me when they move"*

> 💡 **Poin desain yang layak dipakai di pitch:** dua skill Research punya scope contracts kosong. Docs bilang: *"a read-only skill paired with a zero-scope session is a genuinely safe way to let an agent look around before you give it anything to spend."* Ini alur onboarding yang bagus di marketplace kita: **agent lihat-lihat dulu dengan zero-scope session, baru user naikkan izinnya.**

### 7.5 Komposabilitas

**Ya, skills bisa dikomposisi.** Bukti langsung dari registry:

1. **`four-meme` punya play `graduation-handoff`** yang secara eksplisit menyerahkan ke **PancakeSwap** setelah token lulus dari bonding curve → dua protokol, satu alur.
2. **`copy-trade` punya input `screenTokens`** (default `true`) yang "skip anything that fails the liquidity and honeypot check" → mengonsumsi kapabilitas ala **Token Radar** di dalam alur trading.
3. **`venus-lending` punya plays `pay-once` dan `auto-refill`** — nama yang identik dengan plays di skill **x402 API Payments** → pola play yang dishare lintas skill.

**Mekanisme komposisi:** karena skill hanyalah teks dan semua write mengalir lewat `client.execute({ session, calls })`, mengomposisi dua skill = memberi agent kedua file `SKILL.md` **dan satu session yang `calls` allowlist-nya adalah union dari kedua tabel alamat**, dengan spend cap yang mencakup keduanya. `execute` menerima **array of calls** dalam satu userOp atomik, jadi satu play bisa `approve` + `swap` dalam satu transaksi:

```ts
await client.execute({
  session,
  calls: [
    { to: USDT, data: approveCalldata },
    { to: PANCAKE_ROUTER, data: swapCalldata },
  ],
});
```

**Contoh scope komposit (verbatim dari docs Skills):**
```ts
// Scope taken straight from the PancakeSwap Trading skill's address table.
const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const USDT = "0x55d398326f99059fF775485246999027B3197955";

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: [{ to: PANCAKE_ROUTER }, { to: USDT }],
    spend: [{
      limit: 50n * 10n ** 18n,   // 50 USDT. Note: 18 decimals on BNB Chain.
      period: "day",
      token: USDT,
    }],
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
});
```

> "Anything outside `calls` or over the spend cap reverts onchain, **whatever the skill says**."

Sumber: <https://docs.altana.network/skills> · <https://skills.altana.network/llms-full.txt>

### 7.6 Submit skill sendiri (opsi diferensiasi hackathon)

PR ke <https://github.com/altananetwork/skills>. Tiga langkah: **(1)** tulis satu `SKILL.md` di `skills/<your-skill-id>/` · **(2)** Altana test dengan agent nyata di private copy chain · **(3)** live untuk semua agent.

Prompt resmi yang bisa di-paste ke Claude Code / Cursor (verbatim dari docs):
> "Read the Altana skill template at https://github.com/altananetwork/skills/blob/main/skills/_template/SKILL.md and the example at https://github.com/altananetwork/skills/blob/main/skills/pancakeswap-trading/SKILL.md. Write a SKILL.md for \<protocol\> following the template exactly: one capability, checksummed addresses in a table, plays with parameters and Typical time lines, and explicit guards. Then write the test scenario described in tools/skill-test/scenarios and self-test with the harness."

Harness self-test ada di `tools/skill-test/` (`skill-test.ts`, `harness/altana.ts`, `harness/fork.ts`, `scenarios/*.ts`).

Sumber: <https://docs.altana.network/skills/submit> · <https://github.com/altananetwork/skills>

---

## 8. Altana Explorer — Bagaimana Juri Memverifikasi Kita

| Network | URL |
|---|---|
| **Mainnet** | <https://explorer.altana.network> |
| **Testnet** | <https://testnet.altana.network> |

Keduanya punya link ke satu sama lain di header. **Tidak perlu akun, API key, atau koneksi wallet.**

### 8.1 Halaman & rute

| Rute | Isi |
|---|---|
| `/` | Homepage: global activity feed, totals, chain status |
| `/account/<address>` | Semua yang registry tahu tentang satu wallet: **jumlah active key, total keys, chain yang disentuh**, dan tabel key dengan **type, state, chain, nonce, last update**. Di bawahnya: event history wallet |
| `/key/<keyId>` | Satu key dalam bahasa manusia: **active / revoked / expired**, admin atau session key, akun pemilik, chain, **expiry**, dan kapan di-register |

Search box menerima **wallet address, key id, atau public key hash** — public key hash auto-derive ke key id, jadi kamu bisa paste apa yang ada di kode tanpa hashing manual.

Homepage `WebSite` JSON-LD mendeklarasikan `/account/{search_term}` sebagai canonical `SearchAction`.

**Networks panel:** Mainnet meng-index BNB Smart Chain dan Ethereum sebagai source, dengan Base sebagai L2 cache. **Testnet meng-index BNB Smart Chain Testnet dan Ethereum Sepolia, dengan Base Sepolia sebagai cache.**

### 8.2 Cara pakai untuk verifikasi juri — dari docs sendiri

> **"Share a link as evidence.** Account and key pages are plain URLs, so `explorer.altana.network/account/<your wallet>` is a self-contained, third-party-verifiable record of what your agent was authorized to do and when. **That link is the right thing to hand a counterparty, a reviewer, or a hackathon judge who asks to see your onchain activity.** It reads from the same public registry they could read themselves, so nothing about it depends on trusting you or Altana."

**Ini instruksi eksplisit dari Altana untuk skenario juri hackathon.** Sumber: <https://docs.altana.network/explorer>

**Checklist verifikasi yang bisa dilakukan juri:**
1. **Konfirmasi grant mendarat** → buka account page wallet kita. Session key baru harus muncul di tabel keys **dengan expiry**. Kalau tidak ada, grant tidak sampai ke chain yang mereka lihat.
2. **Konfirmasi revoke berlaku** → key page flip ke **revoked**. Monotonic, jadi tidak pernah kembali. "This is the fastest way to prove to yourself, or to someone else, that authority is actually gone."
3. **Bedakan revoked vs expired** → keduanya gagal sama di kode tapi artinya sangat berbeda. Expired = habis waktu, bisa di-grant lagi. Revoked = ditarik sengaja. Key page menyebut yang mana.
4. **Live activity feed** → filter ke registrations / revocations / L2 cache syncs, dengan transaction fee dan chain per event.

### 8.3 Batasan Explorer (penting untuk kode kita)

> "The explorer is an indexed view built for humans. **It is not the authority, and it is not an API.**"

Untuk apa pun yang kodemu bergantung padanya, **baca contract Keystore langsung**: satu `isValidKey` gratis menjawab apakah key authorized sekarang, dari RPC mana pun, **tanpa indexing lag**. Kalau live node read tidak tersedia, key page akan bilang begitu dan fallback ke indexed history — perlakukan state itu sebagai informational dan konfirmasi dengan contract read.

**Implikasi arsitektur produk kita:** UI "lihat & revoke izin agent" **harus** membaca `isValidKey` / `getKeys` langsung on-chain (bukan scraping Explorer), lalu **tautkan** ke Explorer sebagai bukti pihak ketiga.

Sumber: <https://docs.altana.network/explorer> · <https://explorer.altana.network/llms.txt>

---

## 9. Error Handling — Wajib Baca Sebelum Coding

### 9.1 Dua kelas kegagalan

| Kelas | Perilaku |
|---|---|
| **Sebelum submission** | **Melempar** JavaScript `Error` dengan message string. Bad config, unsupported signer, chain tanpa relay. Tangkap dengan `try/catch`. |
| **Pada / setelah submission** | **TIDAK melempar.** `execute` dan `revokeSession` mengembalikan `ExecuteResult` dengan `status: "FAILED"`. **Kalau kamu cuma `try/catch`, kamu tidak akan menyadarinya.** |

Pengecualian: **`grantSession` MELEMPAR** `Session grant did not confirm: status=<status>` (dengan relay code ditambahkan bila teramati, mis. `status=FAILED (relay code 300)`) — karena tidak ada objek `Session` berguna untuk dikembalikan.

```ts
const result = await client.execute({ wallet, signer, calls });
if (result.status !== "CONFIRMED") {
  // Handle it here. No exception was thrown.
}
```

### 9.2 Relay status codes (band EIP-5792)

| `statusCode` | Band | Arti |
|---|---|---|
| `100`–`199` | still in flight | SDK terus polling |
| `200`–`299` | success | Muncul sebagai `CONFIRMED` |
| **`300`–`499`** | **rejected before inclusion** | Terminal, `FAILED` seketika. **Tidak ada yang sampai ke chain.** Penyebab `300` paling umum: **spend cap session tidak bisa menutupi relay fee** (cap juga membayar fee), atau relay policy menolak bundle |
| `500`–`699` | failed on-chain | Terminal, `FAILED`. `500` = revert; `600` = partial failure |
| lainnya | unknown | SDK terus polling daripada menebak. Timeout → `PENDING` dengan kode aneh di `statusCode` |

`PENDING` tanpa `noWait` berarti 240 detik polling (tiap 2 detik) berakhir tanpa jawaban terminal. `PENDING` + `statusCode: 100` = relay reachable, bundle benar-benar masih in flight. `PENDING` tanpa `statusCode` = relay tidak pernah menjawab. **Perlakukan `PENDING` nyata sebagai UNKNOWN, bukan gagal** — bundle mungkin masih mendarat. Poll `callsId` sebelum retry, atau kamu berisiko submit intent yang sama dua kali.

### 9.3 Kelas kegagalan & cara mengenalinya

| Yang salah | Cara mengenali | Perbaikan |
|---|---|---|
| **Policy revert** — session melebihi spend cap, memanggil kontrak di luar `permissions.calls`, atau lewat `expiry` | Session tadinya jalan lalu berhenti, atau gagal hanya untuk call/amount tertentu. Baca key on-chain dengan `isValidKey`; cek `spend` limits terhadap desimal token | **Grant session baru dengan scope yang benar. Permissions fixed saat grant dan TIDAK BISA diperlebar** |
| **Desimal salah di spend cap** | Pembayaran kecil revert terhadap limit yang terlihat besar. **Sangat umum di BNB Chain** (stablecoin 18 desimal, bukan 6) | Lihat warning desimal di `grantSession` |
| **Counterfactual wallet belum didanai** | Terjadi di `execute` pertama untuk wallet baru. `createWallet` tidak menyentuh chain | Kirim native token ke `wallet.address` dulu |
| **Session tidak cocok dengan grant** | **Setiap** `execute` gagal, termasuk yang tadinya jalan. Biasanya setelah lossy JSON round-trip | Persist dengan `serializeSession`, restore dengan `deserializeSession` |
| **Relay rejection** | `FAILED` dalam hitungan detik dengan `statusCode` 300–499 | Naikkan cap (atau perbaiki input) dan resubmit; tidak ada yang sampai ke chain |
| **Contract membayar wallet native coin via `.transfer()`/`.send()`** | Call jalan dari plain EOA tapi revert dari wallet; trace menunjukkan out-of-gas atau empty revert di dalam native-coin send ke alamat wallet | **Tidak ada fix sisi wallet.** Pakai jalur wrapped-token, gateway full-gas `call{value:}`, atau terima ke plain EOA. Kasus yang diketahui: **Venus core-pool vBNB `redeem`** |

`FAILED` **tidak membawa revert string atau receipt**. Untuk alasan on-chain: cari alamat wallet di BscScan, inspect transaksi terakhir ke account, revert reason ada di trace. Kamu punya `callsId`, alamat wallet, dan chain.

Sumber: <https://docs.altana.network/sdk/errors>

---

## 10. Quickstart: "Build an Agent Marketplace on BNB with Altana"

### 10.1 Konteks hackathon

**Build the Era / The Smart Money Era** — <https://www.bnbchain.org/en/hackathons/smart-money-era>

| Item | Nilai |
|---|---|
| Build period | 5 Agustus – 9 September 2026 |
| Judging | 9 – 23 September 2026 |
| Winner announcement | 5 November 2026 |
| Total prize pool | > $40.000 |
| Breakdown | BNB Chain $30.000 USDT · TermiX $10.000 USDT · PancakeSwap 1.000 CAKE · AltLayer 8004scan Pro + AltLLM credits · **Altana 50.000 XP** |
| Main challenge | "the best AI agent marketplace on BNB Smart Chain: one venue to browse agents, see what they do and how they've performed, and put them to work." Pemenang **diadopsi sebagai marketplace resmi BNB Agent Studio sebagai produk standalone** |
| Kategori agent referensi | Monitoring · Grid trading · Health factor · Yield |

Sumber: <https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace> · <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes>

### 10.2 Track "Best Built with Altana" — teks resmi

**Tantangan:** *"create an agent marketplace on BNB Chain where the agents transact for themselves, inside limits their users set."*

**Winning criteria (4, semua wajib):**
1. **Agents on independent Altana wallets** with **real onchain transactions**
2. **Session keys with genuine constraints**: call allowlists, spend caps, and expiry dates
3. **Sessions registered in Keystore** for verifiable onchain integration
4. **User-facing controls** allowing users to **view and revoke** agent permissions

**Bonus:**
- **ERC-8183 agent hiring** lewat Altana SDK
- **x402/B402 micropayment** lewat x402 server SDK

**Build ideas yang disarankan:** agent-to-agent commerce · autonomous DeFi operations with spending limits · micropayment streaming · treasury management yang mendistribusikan izin berbeda ke beberapa agent.

**Resources resmi track:**
| Resource | URL |
|---|---|
| Docs | <https://docs.altana.network/> |
| SDK dan MCP | <https://github.com/altananetwork/altana-sdk> |
| ERC-8183 SDK | <https://docs.altana.network/sdk/erc8183> |
| x402 Server SDK | <https://docs.altana.network/sdk/x402-server> |
| Sessions guide | <https://docs.altana.network/concepts/sessions> |
| Testnet faucet | <https://testnet.bnbchain.org/faucet-smart> |

**Support:** live workshop dan office hours sepanjang build period.

Sumber: <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes>

### 10.3 Langkah quickstart — rekonstruksi lengkap

> ⚠️ **Catatan kejujuran:** Sebuah dokumen quickstart terpisah berjudul persis *"build an agent marketplace on BNB with Altana"* **tidak ditemukan sebagai halaman standalone** di `docs.altana.network` (tidak ada di `llms.txt`, `llms-full.txt`, atau sitemap). Yang ada adalah **deskripsi track di halaman prizes hackathon BNB Chain** (dikutip lengkap di §10.2). Langkah di bawah adalah **rekonstruksi berbasis sumber** dari: kriteria track + guide `/use-cases/1-agent-wallet-policy` + `/sdk/bnb-testnet` + `/sdk/erc8183` + `/sdk/x402-server`. Setiap langkah punya sumber.

**Step 0 — Setup toolchain** (§11)

**Step 1 — Client & admin signer (per-agent wallet)**
```ts
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB_TESTNET] });
const admin = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = await client.createWallet({ signer: admin });
console.log(wallet.address);
```
→ Memenuhi kriteria #1 (bagian "own Altana wallet"). Sumber: <https://docs.altana.network/sdk/bnb-testnet>

**Step 2 — Danai wallet**
Kirim test BNB dari <https://testnet.bnbchain.org/faucet-smart> ke `wallet.address`. **Wajib sebelum `execute` pertama** — wallet counterfactual, belum ada on-chain.

**Step 3 — Grant session dengan limit NYATA** (kriteria #2 + #3)
```ts
import { signerFromPrivateKey, serializeSession } from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";

const sessionKey = generatePrivateKey();
await secrets.save(`agent-${id}.key`, sessionKey);

const session = await client.grantSession({
  wallet,
  signer: admin,
  sessionSigner: signerFromPrivateKey(sessionKey),
  permissions: {
    calls: [                                  // ← ALLOWLIST NYATA
      { to: PANCAKE_ROUTER },
      { to: USDT, signature: "approve(address,uint256)" },  // selector-scoped
    ],
    spend: [                                  // ← SPEND CAP NYATA
      { limit: 50n * 10n ** 18n, period: "day", token: USDT },
      { limit: 20_000_000_000_000_000n, period: "day" },     // native, HARUS cukup untuk relay fee
    ],
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,  // ← EXPIRY NYATA
  register: true,                             // ← default; JANGAN false, ini yang bikin terdaftar di Keystore
});

await db.save(`agent-${id}.session`, serializeSession(session));
console.log("grant tx:", session.transactionHash);   // ← simpan untuk bukti juri
```

**Step 4 — Agent eksekusi transaksi on-chain nyata** (kriteria #1)
```ts
const result = await client.execute({
  session,
  calls: [{ to: PANCAKE_ROUTER, data: swapCalldata, value: 0n }],
});
if (result.status !== "CONFIRMED") { /* handle — no throw! */ }
console.log(result.transactionHash);          // ← simpan untuk bukti juri
```

**Step 5 — UI: user lihat & revoke** (kriteria #4)
Baca on-chain (bukan dari DB!) untuk menampilkan status sebenarnya:
```ts
const keyIds = await pub.readContract({ address: BNB_TESTNET.keyStore, abi: KEYSTORE_ABI, functionName: "getKeys", args: [wallet.address] });
const live   = await Promise.all(keyIds.map(id =>
  pub.readContract({ address: BNB_TESTNET.keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet.address, id] })));
```
Tombol revoke:
```ts
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```
Tampilkan juga deep-link bukti: `https://testnet.altana.network/account/${wallet.address}`

**Step 6 (bonus) — ERC-8183 hiring** (§5): buyer `hireErc8183Agent(session, …)` + seller `submitErc8183Deliverable(session, …)`. **Butuh SDK ≥ 0.9.0 untuk testnet.** Danai budget dari $U faucet.

**Step 7 (bonus) — x402/B402 selling** (§6.4): `createX402Merchant` + `merchant.guard(req)` di depan route API agent kita.

---

## 11. Instalasi & Setup untuk macOS arm64

**Verifikasi pada mesin ini (2026-09-08):** `uname -m` → `arm64` · `node -v` → **v24.10.0** · `npm -v` → **11.6.1** · `bun --version` → **1.3.9** ✅ Semua prasyarat sudah terpasang.

> ℹ️ `@altananetwork/sdk@0.9.0` **tidak mendeklarasikan field `engines`** di package.json — tidak ada minimum Node version resmi yang dipublikasikan. Yang dideklarasikan eksplisit hanyalah **Bun ≥ 1.1 untuk `@altananetwork/mcp`**.

### 11.1 Prasyarat

```bash
# Node (via Homebrew arm64, atau nvm/fnm)
brew install node          # → node + npm
node -v && npm -v

# Bun — WAJIB untuk MCP server (npx GAGAL: paket di-ship sebagai TypeScript)
curl -fsSL https://bun.sh/install | bash
bun --version              # butuh >= 1.1

# Foundry — opsional, untuk `cast send` ke $U faucet
curl -L https://foundry.paradigm.xyz | bash && foundryup
```
Sumber Bun: <https://bun.sh> (dirujuk dari <https://docs.altana.network/mcp/install>)

### 11.2 Install SDK

```bash
mkdir -p altana-agent && cd altana-agent
npm init -y
npm pkg set type=module          # SDK adalah ESM-only
npm install @altananetwork/sdk@0.9.0 viem
npm install -D typescript tsx @types/node
```
> **Pin versi exact** — paket pre-1.0, minor version bisa breaking.

Untuk seller x402:
```bash
npm install @altananetwork/x402-server@0.2.0 viem   # ⚠️ GPL-3.0-or-later
```

Sumber: <https://docs.altana.network/sdk/bnb-testnet> · <https://docs.altana.network/sdk/x402-server>

### 11.3 MCP server di Claude Code

```bash
# BNB testnet (untuk hackathon)
claude mcp add altana -e ALTANA_CHAIN=bnb-testnet -- bunx @altananetwork/mcp

# atau BNB mainnet (default)
claude mcp add altana -- bunx @altananetwork/mcp

# hapus
claude mcp remove altana
```
Restart Claude Code → tools + slash command tersedia. **Satu proses server = satu chain**; restart dengan `ALTANA_CHAIN` berbeda untuk pindah.

Key disimpan di **macOS Keychain** (service `altana-wallet` / `altana-session`), fallback `~/.altana/keys.json` (mode 0600), fallback env.

Sumber: <https://docs.altana.network/mcp/install>

### 11.4 Claude Code Skill (menulis kode SDK yang benar)

```bash
mkdir -p .claude/skills/altana-agentic-wallet
curl -fsSL https://docs.altana.network/skill.md \
  -o .claude/skills/altana-agentic-wallet/SKILL.md
```

### 11.5 Env & smoke test

`.env`:
```
PRIVATE_KEY=0x...
ALTANA_CHAIN=bnb-testnet
```

`smoke.ts`:
```ts
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = await client.createWallet({ signer });

console.log("wallet:", wallet.address);
const { native } = await client.balances({ wallet });
console.log("tBNB:", native);
```
```bash
npx tsx --env-file=.env smoke.ts
```
Lalu danai `wallet.address` dari <https://testnet.bnbchain.org/faucet-smart> dan cek di <https://testnet.altana.network/account/<address>>.

### 11.6 Desktop app (opsional, untuk demo)

```
https://altana.network/api/download/mac-arm64
```
Redirect 302 ke asset rilis GitHub terbaru. Build macOS **ditandatangani dengan Developer ID Altana dan dinotarisasi Apple**. App auto-update (download di background, install saat restart).

Sumber: <https://www.altana.network/llms.txt>

---

## 12. Checklist: Syarat Menang Track Altana → Cara Kami Memenuhinya

### Syarat WAJIB

#### ☐ 1. Agent punya wallet Altana sendiri, dengan transaksi on-chain nyata

**Implementasi teknis:**
- Satu `client.createWallet({ signer: adminSignerPerAgent })` per agent yang di-list di marketplace. Alamat deterministik & counterfactual sampai `execute` pertama.
- Danai tiap wallet dengan tBNB dari faucet **sebelum** `execute` pertama (kalau tidak: "Unfunded counterfactual wallet" failure).
- Setiap agent menjalankan minimal satu transaksi nyata lewat session key (mis. approve + swap PancakeSwap, atau supply Aave V3).

**Bukti untuk juri:** `result.transactionHash` di BscScan testnet + halaman `testnet.altana.network/account/<wallet>` yang menunjukkan admin key + session key.

**Jebakan:** jangan pakai satu wallet bersama untuk semua agent — kriterianya "agents on **independent** Altana wallets". Kalau mau demo shared-wallet, gunakan pola `/use-cases/3-portfolio-multiple-agents` sebagai fitur **tambahan** (treasury management), bukan pengganti.

**Bukti kesiapan mainnet (nilai lebih):** ulangi flow di `BNB` (56) dengan nominal kecil. Semua kontrak live & CertiK-audited di mainnet.

---

#### ☐ 2. Session dengan limit nyata: call allowlist + spend cap + expiry

**Implementasi teknis:**
```ts
permissions: {
  calls: [
    { to: PANCAKE_ROUTER },                                  // contract-level
    { to: USDT, signature: "approve(address,uint256)" },     // selector-level (AND semantics)
  ],
  spend: [
    { limit: 50n * 10n ** 18n, period: "day", token: USDT }, // ⚠️ 18 desimal di BNB
    { limit: 20_000_000_000_000_000n, period: "day" },       // native — HARUS cukup untuk relay fee
  ],
},
expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
```

**Tiga jebakan yang HARUS dihindari:**
1. **JANGAN hilangkan `calls`** — itu = unrestricted, dan juri akan melihatnya. Selalu set `calls` DAN `spend`.
2. **Desimal:** USDT/USDC = **18 desimal di BNB Chain**. `100_000_000n` bukan 100 USDT, itu 0.0000000001 USDT.
3. **Native cap membayar relay fee.** Cap native terlalu kecil = session yang tidak akan pernah bisa eksekusi, `FAILED` dengan `statusCode` 300.

**Nilai lebih:** pakai **selector-scoped** permission (`{ to, signature }`), bukan cuma `{ to }`. Docs Altana sendiri memberi contoh danger untuk ERC-8004 (§5.8): grant contract-level ke registry juga mengotorisasi `setApprovalForAll` yang **hidup lebih lama daripada revokasi session**. Menunjukkan pemahaman ini di demo = poin kuat.

**Demo yang menjual:** tunjukkan transaksi yang **revert** karena di luar policy (kontrak tidak di-allowlist, atau amount melebihi cap) — "reverts at the onchain validator, not at Altana's backend, at the contract itself."

---

#### ☐ 3. Session terdaftar di Keystore on-chain

**Implementasi teknis:**
- **`register: true` (default) — JANGAN set ke `false`.** Ini yang menulis public key session ke Keystore lewat Controller, di-batch atomik dengan otorisasi di smart account.
- Simpan `session.transactionHash` dari `GrantSessionResult` sebagai bukti.
- ⚠️ **Jangan anotasi `const session: Session = ...`** — itu menghapus field `transactionHash`. Biarkan di-infer atau anotasi `GrantSessionResult`.
- Biaya: one-time Keystore registration fee; pada aksi admin pertama dibayar **dua kali** (`initialRegisterKey` admin di-prepend).

**Bukti untuk juri:**
- Explorer: `https://testnet.altana.network/account/<wallet>` → session key muncul di tabel keys **dengan expiry**.
- Programmatic: `isValidKey(walletAddress, keccak256(sessionPublicKey))` di `0x6b8361C29d05D498b1a12B54A37310f94171E94A` (testnet KeyStore) → `true`.

---

#### ☐ 4. Transaksi on-chain nyata lewat session key (testnet cukup, mainnet lebih kuat)

**Implementasi teknis:**
- `client.execute({ session, calls })` — **bukan** admin path. Session path tidak menyentuh Keystore lagi (sudah ter-register saat grant).
- Cek `result.status !== "CONFIRMED"` secara eksplisit. **`execute` yang gagal TIDAK melempar.**
- Persist session dengan `serializeSession` + key terpisah, restore dengan `deserializeSession` — kalau tidak, setiap execute gagal dengan "session doesn't match the grant".

**Strategi mainnet:** jalankan minimal satu flow lengkap (grant → execute → revoke) di **BNB mainnet (56)** dengan nominal kecil (mis. 1 USDT swap), lalu tautkan `explorer.altana.network/account/<wallet>` di submission. Track menulis "testnet cukup, mainnet lebih kuat" — satu tx mainnet nyata adalah diferensiasi murah dan besar.

---

#### ☐ 5. User bisa lihat & revoke izin agent DI DALAM produk

**Implementasi teknis — panel "Agent Permissions":**

*Read (harus on-chain langsung, BUKAN dari DB, BUKAN scraping Explorer):*
```ts
const keyIds = await pub.readContract({ address: NET.keyStore, abi: KEYSTORE_ABI,
  functionName: "getKeys", args: [walletAddress] });          // bytes32[]
const live = await Promise.all(keyIds.map(id =>
  pub.readContract({ address: NET.keyStore, abi: KEYSTORE_ABI,
    functionName: "isValidKey", args: [walletAddress, id] }))); // bool
```
⚠️ **Wajib pakai `isValidKey`, bukan hanya `getKeys`.** Revoke menghapus dari `getKeys` seketika, **expiry tidak** — key yang sudah lama expired tetap muncul di `getKeys`. UI yang hanya membaca `getKeys` akan menampilkan izin yang sudah mati sebagai aktif.

*Tampilkan per session:* agent name, allowlist kontrak (human-readable: "PancakeSwap Router"), spend cap + period, expiry (countdown), status (**Active / Expired / Revoked** — bedakan!), grant tx hash, dan link `explorer.altana.network/account/<wallet>` sebagai bukti pihak ketiga.

*Revoke (satu tombol):*
```ts
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```
Terima `Session | Hex` — jadi UI cukup menyimpan public key, tidak perlu objek session lengkap.
⚠️ Revoke yang gagal **mengembalikan** `FAILED`, tidak melempar. Cek statusnya.
⚠️ **Monotonic** — beri konfirmasi di UI: "Once revoked, this key can never be reactivated. Granting access again requires a new session key."

**Demo killer:** tampilkan agent sedang jalan → user klik Revoke → refresh panel (dibaca on-chain) menunjukkan **Revoked** → jalankan lagi aksi agent → gagal revert di validasi. Semuanya bisa diverifikasi juri di Explorer.

---

### Syarat BONUS

#### ☐ 6. Hire agent BNB Agent Studio via ERC-8183 (buyer + seller side)

**Buyer side:**
```ts
const { jobId } = await hireErc8183Agent(session, {   // ← session path: spend cap membatasi escrow!
  provider: sellerAgentAddress,
  task: "…",
  budget: 100_000_000_000_000_000n,                   // 0.1 $U (18 dec)
}, { network: BNB_TESTNET });
```
Satu call = `createJob` + `registerJob` + `setBudget` + `approve $U` + `fund` sebagai **satu atomic relay intent**.

**Seller side:**
```ts
const session = await client.grantSession({ wallet, signer: admin,
  permissions: { calls: erc8183SubmitPermissions(97), spend: [{ limit: gasCap, period: "day" }] },
  expiry });

const result = await submitErc8183Deliverable(session, { jobId, manifest, deliverableUrl }, { network: BNB_TESTNET });
// serve result.manifestText VERBATIM at deliverableUrl
```

**Verifikasi & settle:** `getErc8183Job` → `getErc8183DeliverableUrl` → `verifyErc8183ManifestText(text, job.deliverable)` → `settleErc8183Job`.

**🚨 Blocker yang harus dicek:** SDK **≥ 0.9.0 WAJIB** untuk testnet. Di ≤0.8.0, `ERC8183_ADDRESSES[97].policy` menunjuk alamat yang tidak di-whitelist di testnet EvaluatorRouter → setiap `hireErc8183Agent()` revert dengan `PolicyNotWhitelisted()`.

**Dana:** klaim $U dari faucet `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3` (`requestTokens()`, 10 $U / 30 menit / address).

**Nilai lebih maksimal:** demo **kedua sisi** — agent A di marketplace kita hire agent B, B submit deliverable, buyer verify hash, escrow release. Jalur session key di **kedua** sisi membuktikan "agent otonom yang dibatasi on-chain", tepat tesis track ini.

**Plus:** register agent kita dengan **ERC-8004** (`erc8004RegisterPermissions(chainId)`) agar discoverable oleh buyer di ekonomi agent BNB. Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (testnet 97).

---

#### ☐ 7. Jualan lewat x402/B402 pakai x402 server SDK

**Implementasi:**
```ts
const merchant = createX402Merchant({
  chainId: 97,                                 // atau 56
  payTo: agentSmartAccountAddress,             // earnings mendarat di Altana wallet agent
  price: 200_000_000_000_000_000n,
  minPrice, maxPrice,
  rails: [
    { rail: "eip3009", token: U_TOKEN[chainId] },                        // ← WAJIB untuk buyer Studio
    { rail: "permit2-exact", token: USDT_BSC, spender: facilitator.address }, // ← untuk buyer Altana/B402
  ],
  resource: "https://our-marketplace.example/api/agent/<id>/run",
  facilitator: privateKeyToAccount(process.env.FACILITATOR_KEY),
  rpcUrl, chain,
});
// di route handler:
const { response, receipt } = await merchant.guard(req);
if (response) return response;
return Response.json({ data: await runAgentTask(), tx: receipt.txHash });
```

**Checklist kompatibilitas buyer BNB Agent Studio:**
- ☐ Sertakan rail **`eip3009` dengan $U** — buyer Studio **hanya** membayar $U lewat eip3009
- ☐ `maxTimeoutSeconds ≤ 480` (default 300) — signer Studio menolak window > 600s dan backdate `validAfter` 120s
- ☐ URL **https** di production — `bag x402 trust` mensyaratkannya

**Sisi buyer (agent kita membayar API lain):** `approveTokenForPermit2` + `approveSignatureChecker({ checker: PERMIT2_ADDRESS })` sekali, lalu `client.fetchWithX402({ session, url })`. **Jalankan server-side** (CORS memblokir `X-PAYMENT` di browser).

**Narasi dua arah yang kuat:** marketplace kita adalah **seller** (agent kita menjual kapabilitas per-call, earnings ke smart account mereka sendiri) **dan buyer** (agent kita membayar data feed per-call, dibatasi spend cap). Ini persis "Both directions, so an agent can earn as well as spend" dari layer Commerce Altana.

---

### Tambahan yang tidak diminta tapi menaikkan nilai

| Ide | Kenapa |
|---|---|
| **Integrasi Skills Registry** (`search_skills` + `get_skill`, atau fetch `index.json` langsung) | Katalog agent kita jadi ter-populate 10 protokol production dengan scope + suggested cap yang sudah divalidasi. `get_skill` melakukan integrity check sha256. Instant depth tanpa menulis integrasi protokol sendiri. |
| **Turunkan session policy dari tabel alamat skill secara otomatis** | Docs bilang eksplisit "the suggested session scope is derived from it". UI: user pilih skill → allowlist + suggested cap terisi otomatis → user tinggal atur angka. Sangat demo-able. |
| **Onboarding zero-scope** | Skill Research (Token Radar, Wallet Tracker) punya `scope.contracts: []`. Beri agent baru session zero-scope dulu agar user melihat perilakunya sebelum memberi izin belanja. |
| **Submit skill baru ke registry** | PR ke `altananetwork/skills`. Kontribusi nyata ke ekosistem partner. |
| **Tampilkan CertiK audit badge** | Kontrak Keystore diaudit CertiK 15 Juli 2026, source-verified exact match di BscScan. Sinyal trust untuk juri. |
| **Halaman "Verify this agent"** publik | Reads gratis & unlimited. Halaman yang siapa pun (tanpa akun) bisa buka untuk `isValidKey` sebuah agent = mewujudkan tesis Altana secara harfiah. |

---

## 13. Ringkasan Risiko & Gotcha (untuk implementasi)

| # | Risiko | Mitigasi |
|---|---|---|
| 1 | **`permissions.calls` kosong = unrestricted** | Selalu set `calls` DAN `spend`. Lint check di code review. |
| 2 | **Desimal 18 vs 6 di BNB** | Helper `toBnbUnits(amount)` terpusat. Assert di test. |
| 3 | **Native cap membayar relay fee** | Beri headroom di cap native, jangan pas-pasan. `FAILED` 300 = gejala ini. |
| 4 | **`execute`/`revokeSession` gagal TANPA throw** | Wrapper `assertConfirmed(result)` di semua call site. |
| 5 | **`JSON.stringify(session)` rusak** | Hanya `serializeSession`/`deserializeSession`. Key di secret store terpisah. |
| 6 | **`sessionSigner` dihilangkan = key in-memory hilang selamanya** | Selalu passing `sessionSigner` sendiri. |
| 7 | **Anotasi `: Session` menghilangkan `transactionHash`** | Infer, atau anotasi `GrantSessionResult`. |
| 8 | **`getKeys` tidak menghapus key expired** | Selalu cross-check dengan `isValidKey`. |
| 9 | **ERC-8183 revert di testnet pada SDK ≤0.8.0** | Pin `@altananetwork/sdk@0.9.0`. |
| 10 | **Venus vBNB `redeem` revert (EIP-7702 / 2300 gas stipend)** | Pakai vUSDT (ERC-20). Hindari native payout `.transfer()`. |
| 11 | **`npx @altananetwork/mcp` gagal** | Wajib `bunx`, Bun ≥ 1.1. |
| 12 | **`fetchWithX402` diblokir CORS di browser** | Jalankan server-side. |
| 13 | **Facilitator berbasis `ecrecover` menolak pembayaran kita** | Signature adalah ERC-1271 98-byte, bukan EOA. Facilitator harus `isValidSignature`. Pakai `@altananetwork/x402-server` sendiri untuk menghindari masalah. |
| 14 | **`approveSignatureChecker` terlupa → `0xffffffff`** | Sekali per session, per rail. Masukkan ke provisioning script. |
| 15 | **Grant ERC-8004 contract-level → `setApprovalForAll` bocor melewati revoke** | Selalu `erc8004RegisterPermissions(chainId)`, jangan `{ to: registry }`. |
| 16 | **SDK pre-1.0, minor bisa breaking** | Pin exact version. Baca changelog sebelum bump. |
| 17 | **`x402-server` GPL-3.0** | Cek implikasi lisensi bila kode server mau closed-source. |
| 18 | **Browser wallet tidak bisa jadi signer** | Pola onboarding: connect MetaMask seperti biasa → buat account dengan `createPasskeyWallet` → fund satu klik lewat provider wallet yang terhubung. Lihat `/use-cases/7-onboard-from-browser-wallets`. |
| 19 | **Revoke monotonic** | Konfirmasi di UI sebelum revoke. |
| 20 | **Alamat account-stack BNB mainnet tidak terdokumentasi publik** | Kalau butuh, tanya di office hours atau baca `packages/wallet/src/config.ts`. |

---

## 14. Daftar Sumber

**Dokumentasi Altana**
1. <https://docs.altana.network> — root docs
2. <https://docs.altana.network/llms.txt> — indeks mesin-readable
3. <https://docs.altana.network/llms-full.txt> — **seluruh docs, 244 KB** (sumber utama riset ini)
4. <https://docs.altana.network/changelog> — riwayat rilis 0.7.0 → 0.9.0
5. <https://docs.altana.network/acknowledgments> — basis Porto (MIT)
6. <https://docs.altana.network/why-altana>
7. <https://docs.altana.network/concepts/keystore>
8. <https://docs.altana.network/concepts/sessions>
9. <https://docs.altana.network/concepts/networks>
10. <https://docs.altana.network/concepts/networks/testnet>
11. <https://docs.altana.network/concepts/comparison>
12. <https://docs.altana.network/concepts/off-chain-signatures>
13. <https://docs.altana.network/sdk> — SDK reference overview
14. <https://docs.altana.network/sdk/bnb>
15. <https://docs.altana.network/sdk/bnb-testnet>
16. <https://docs.altana.network/sdk/create-wallet>
17. <https://docs.altana.network/sdk/create-passkey-wallet>
18. <https://docs.altana.network/sdk/recover-from-passkey>
19. <https://docs.altana.network/sdk/grant-session>
20. <https://docs.altana.network/sdk/execute>
21. <https://docs.altana.network/sdk/revoke-session>
22. <https://docs.altana.network/sdk/errors>
23. <https://docs.altana.network/sdk/balances>
24. <https://docs.altana.network/sdk/sync-to-l2>
25. <https://docs.altana.network/sdk/x402>
26. <https://docs.altana.network/sdk/x402-server>
27. <https://docs.altana.network/sdk/erc8183>
28. <https://docs.altana.network/sdk/erc8004>
29. <https://docs.altana.network/sdk/sign-order>
30. <https://docs.altana.network/sdk/approve-permit2>
31. <https://docs.altana.network/sdk/approve-signature-checker>
32. <https://docs.altana.network/mcp>
33. <https://docs.altana.network/mcp/install>
34. <https://docs.altana.network/mcp/tools>
35. <https://docs.altana.network/mcp/skill>
36. <https://docs.altana.network/explorer>
37. <https://docs.altana.network/skills>
38. <https://docs.altana.network/skills/submit>
39. <https://docs.altana.network/security/audits>
40. <https://docs.altana.network/use-cases/1-agent-wallet-policy>
41. <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>
42. <https://docs.altana.network/use-cases/2-agent-trades-dex>
43. <https://docs.altana.network/use-cases/3-portfolio-multiple-agents>
44. <https://docs.altana.network/use-cases/4-verify-agent-authority>
45. <https://docs.altana.network/use-cases/5-cross-chain-authorization>
46. <https://docs.altana.network/use-cases/6-agent-pays-api-x402>
47. <https://docs.altana.network/use-cases/7-onboard-from-browser-wallets>
48. <https://docs.altana.network/use-cases/8-mobile-app>
49. <https://docs.altana.network/getting-started/build-with-claude>
50. <https://docs.altana.network/getting-started/create-agentic-wallet>

**Website & surface Altana**
51. <https://altana.network> · <https://www.altana.network/llms.txt>
52. <https://altana.network/architecture>
53. <https://altana.network/sitemap.xml>
54. <https://explorer.altana.network/llms.txt>
55. <https://testnet.altana.network>
56. <https://skills.altana.network/llms.txt>
57. <https://skills.altana.network/llms-full.txt>
58. <https://skills.altana.network/index.json>
59. <https://xp.altana.network>

**GitHub**
60. <https://api.github.com/orgs/altananetwork/repos>
61. <https://github.com/altananetwork/altana-sdk>
62. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>
63. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/config.ts>
64. <https://github.com/altananetwork/altana-sdk/blob/main/packages/x402-server/README.md>
65. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/SKILL.md>
66. <https://github.com/altananetwork/skills> · <https://raw.githubusercontent.com/altananetwork/skills/main/index.json>

**npm**
67. <https://registry.npmjs.org/@altananetwork/sdk>
68. <https://registry.npmjs.org/@altananetwork/mcp>
69. <https://registry.npmjs.org/@altananetwork/x402-server>

**Hackathon & ekosistem**
70. <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes> — **teks track "Best Built with Altana"**
71. <https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace>
72. <https://www.bnbchain.org/en/bnb-agent-studio>
73. <https://chainwire.org/2026/08/18/bnb-chain-launches-bnb-agent-studio-v2-giving-ai-agents-the-ability-to-earn/>
74. <https://cryptobriefing.com/bnb-agent-studio-altana-network-wallet/>
75. <https://skynet.certik.com/projects/altana> — laporan audit CertiK

**Verifikasi kontrak on-chain**
76. <https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> — KeyStore BNB
77. <https://etherscan.io/address/0xb70fDa90C1d576Ba8399946a0c10ECD9d9Ea923b#code> — KeyStore Ethereum
78. <https://basescan.org/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> — KeyStoreCacheOPStack Base

---

## 15. Yang TIDAK Ditemukan

Dicatat agar tidak ada yang mengarang di kemudian hari:

| Item | Status |
|---|---|
| Dokumen quickstart standalone berjudul **"build an agent marketplace on BNB with Altana"** | **Tidak ditemukan** sebagai halaman terpisah di docs.altana.network (bukan di llms.txt, llms-full.txt, atau sitemap). Yang ada: deskripsi track di halaman prizes hackathon BNB Chain (§10.2), dan use-case guides yang menyusunnya (§10.3) |
| `https://docs.altana.network/sitemap.xml` | **HTTP 404** |
| Daftar enum lengkap `period` untuk spend permission | **Tidak ditemukan.** Docs hanya menunjukkan `"day"` dan `"hour"` di contoh |
| Alamat account-stack (Orchestrator/Delegation proxy/Account implementation/Simulator/Funder/Escrow) untuk **BNB mainnet (56)** | **Tidak ditemukan** di docs publik. Hanya versi testnet (97) yang dipublikasikan. Halaman `/concepts/networks` untuk BNB hanya mencantumkan KeyStore + KeyStoreController |
| Alamat Permit2 canonical lengkap | Docs hanya menyebut prefix `0x0000…78BA3`; alamat penuh diakses lewat export `PERMIT2_ADDRESS` dari SDK |
| Spesifikasi EIP resmi untuk **ERC-8183** di eips.ethereum.org | **Tidak diverifikasi dalam riset ini.** Semua detail ERC-8183 di dokumen ini berasal dari docs Altana + source code SDK. ERC-8004 punya URL EIP resmi yang dirujuk docs: <https://eips.ethereum.org/EIPS/eip-8004> |
| Field `engines` (minimum Node version) di `@altananetwork/sdk` | **Tidak dideklarasikan** di package.json |
| `github.com/altananetwork/sdk` (dirujuk `repository.url` npm x402-server) | **Repo tidak ada** — typo di package.json. Repo asli: `altananetwork/altana-sdk` |
| Detail program XP (bagaimana 50.000 XP dihitung/didistribusikan) | **Tidak diriset** — `xp.altana.network` adalah SPA Next.js tanpa llms.txt |
