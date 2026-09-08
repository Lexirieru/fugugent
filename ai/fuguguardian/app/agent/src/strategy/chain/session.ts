/**
 * Penandatangan `repay` lewat **session key Altana ber-batas**.
 *
 * Ini pengganti drop-in bagi `ExecuteDeps["sendRepay"]` yang sebelumnya
 * ditandatangani EOA deployer — sebuah kunci berkuasa penuh. Bedanya bukan
 * kosmetik: batas belanja, daftar kontrak, dan kedaluwarsa sesi ditegakkan
 * **oleh kontrak akun Altana di rantai**, bukan oleh kode di repo ini. Kalau
 * proses agent dibajak, kunci yang dipegangnya tetap tidak bisa memanggil
 * apa pun di luar allowlist.
 *
 * Modul ini SENGAJA tidak berisi logika strategi apa pun dan tidak menyentuh
 * jaringan sendiri. Yang ada di sini hanya tiga hal:
 *
 *   1. **Memeriksa izin sesi sebelum apa pun dikirim.** `calls` yang kosong
 *      atau hilang berarti izin TANPA BATAS di Altana (lihat
 *      `docs/research/03-altana.md` §2.3) — jadi kode kita menolaknya lebih
 *      dulu, sebelum SDK sempat dipanggil. Begitu pula entri "wildcard" yang
 *      hanya mengikat kontrak tanpa selector (atau sebaliknya), dan entri apa
 *      pun di luar daftar yang memang dibutuhkan.
 *   2. **Menyusun panggilan** `approve` + `repay` dari ABI minimal di bawah.
 *      Signature yang dipakai untuk allowlist diturunkan dari konstanta yang
 *      sama dengan yang dipakai memanggil, jadi keduanya tidak bisa menyimpang.
 *   3. **Mengirim lewat sesi** — lewat `sendCall` yang disuntikkan pemanggil,
 *      sehingga seluruh aturan di atas bisa diuji tanpa jaringan sama sekali.
 *
 * Bagian `signer` dari file sesi tidak pernah dibaca, dicetak, atau disalin
 * di mana pun di modul ini; sesi hanya lewat sebagai `sendCall` yang sudah
 * terikat.
 */
import type { ExecuteDeps } from "../execute.js";

/**
 * Satu aturan allowlist Altana. Bentuk union-nya sengaja ditiru apa adanya
 * dari SDK: `{ to }` saja berarti "semua metode di kontrak itu", `{ signature }`
 * saja berarti "metode itu di kontrak mana pun". Keduanya terlalu longgar
 * untuk agent ini, dan `assertBoundedAllowlist` menolaknya.
 */
export type SessionCallPermission =
  | { readonly to: `0x${string}`; readonly signature: string }
  | { readonly to: `0x${string}` }
  | { readonly signature: string };

/** Batas belanja per token untuk satu periode bergulir. */
export interface SessionSpendPermission {
  readonly limit: bigint;
  readonly period: string;
  /** Dihilangkan berarti token native (tBNB) — inilah yang membayar ongkos relay. */
  readonly token?: `0x${string}`;
}

/** Bentuk `permissions` sebuah sesi Altana, sejauh yang diperiksa modul ini. */
export interface SessionPermissions {
  readonly calls?: readonly SessionCallPermission[] | null;
  readonly spend?: readonly SessionSpendPermission[] | null;
}

/** Satu entri allowlist yang mengikat kontrak DAN selector sekaligus. */
export interface BoundCallPermission {
  readonly to: `0x${string}`;
  readonly signature: string;
}

/** Selector `MockLendingPool.repay` — satu-satunya cara agent melunasi hutang. */
export const REPAY_SIGNATURE = "repay(address,uint256)";

/** Selector `ERC20.approve` — dibutuhkan karena `repay` menarik lewat allowance. */
export const APPROVE_SIGNATURE = "approve(address,uint256)";

/**
 * Kesalahan izin sesi: selalu berarti "jangan kirim apa pun".
 *
 * `neverSent` menyatakan apakah galat ini terjadi SEBELUM apa pun menyentuh
 * jaringan. Modul ini satu-satunya yang tahu di mana batas itu berada — semua
 * yang terjadi sampai tepat sebelum `deps.sendCalls` terbukti belum mengirim
 * apa-apa; apa pun sesudahnya tidak bisa dipastikan. `execute.ts` membacanya
 * lewat `wasNeverSent()` untuk memutuskan apakah anggaran ikut terpotong
 * (lihat catatan C2 di kepala `execute.ts`). Default-nya `false`: diam berarti
 * "mungkin sudah terkirim", asumsi yang aman ke arah tidak membayar dua kali.
 */
export class SessionPermissionError extends Error {
  readonly neverSent: boolean;
  constructor(message: string, options: { neverSent?: boolean } = {}) {
    super(message);
    this.name = "SessionPermissionError";
    this.neverSent = options.neverSent ?? false;
  }
}

/**
 * Allowlist minimum yang dibutuhkan Guardian: `repay` di pool dan `approve`
 * di token hutang. Tidak lebih. Dipakai baik saat grant sesi maupun saat
 * memeriksanya kembali sebelum eksekusi, supaya keduanya tidak bisa berbeda.
 *
 * **Batas izin Altana berhenti di kontrak + selector; ia tidak mengikat nilai
 * argumen.** Sesi ini karena itu secara teknis boleh memanggil
 * `mUSD.approve(<siapa pun>, <berapa pun>)` dan `pool.repay(<aset apa pun>, …)`.
 * Yang menahannya ada tiga, dan hanya dua yang milik kita:
 *   1. spend cap per token pada sesi (ditegakkan akun Altana);
 *   2. `createSessionSendRepay` yang hanya pernah menyusun `approve` untuk pool
 *      dan `repay` untuk aset yang di-allowlist — tetapi ini kode kita sendiri,
 *      jadi ia hilang begitu prosesnya dibajak;
 *   3. guarded executor Porto yang menolkan allowance ERC-20 di akhir userOp —
 *      perilaku pihak ketiga yang kami temukan **secara empiris** di task ini,
 *      bukan yang dijamin kontrak kita, dan bukan yang boleh diandalkan diam-diam.
 * Kalau pengikatan argumen kelak dibutuhkan, tempatnya adalah kontrak perantara
 * yang di-allowlist, bukan modul ini.
 */
export function requiredSessionCalls(
  pool: `0x${string}`,
  repayAsset: `0x${string}`,
): readonly BoundCallPermission[] {
  return [
    { to: pool, signature: REPAY_SIGNATURE },
    { to: repayAsset, signature: APPROVE_SIGNATURE },
  ];
}

function callKey(to: string, signature: string): string {
  return `${to.toLowerCase()}:${signature}`;
}

function describeCall(call: SessionCallPermission): string {
  const to = "to" in call ? call.to : "(kontrak apa pun)";
  const signature = "signature" in call ? call.signature : "(metode apa pun)";
  return `${to} ${signature}`;
}

/**
 * Menolak izin yang lebih longgar daripada `required`, SEBELUM SDK dipanggil.
 *
 * Lima penolakan, berurutan:
 *   1. `calls` hilang → di Altana itu izin tanpa batas.
 *   2. `calls` kosong → sama saja, dan ini jebakan yang paling sering terjadi.
 *   3. entri tanpa `to` atau tanpa `signature` → wildcard satu sisi.
 *   4. entri yang tidak ada di `required` → sesi lebih luas dari yang dibutuhkan.
 *   5. entri di `required` yang tidak ada di sesi → sesi tidak akan bisa bekerja.
 */
export function assertBoundedAllowlist(
  permissions: SessionPermissions,
  required: readonly BoundCallPermission[],
): void {
  if (required.length === 0) {
    throw new SessionPermissionError(
      "Daftar panggilan yang dibutuhkan kosong; tidak ada yang bisa diizinkan secara eksplisit.",
    );
  }

  const calls = permissions.calls;
  if (calls === undefined || calls === null) {
    throw new SessionPermissionError(
      "Sesi tidak memuat `permissions.calls` sama sekali. Di Altana itu berarti izin " +
        "TANPA BATAS: sesi boleh memanggil kontrak apa pun. Grant ulang dengan allowlist eksplisit.",
    );
  }
  if (calls.length === 0) {
    throw new SessionPermissionError(
      "`permissions.calls` kosong. Di Altana `calls: []` berarti izin TANPA BATAS, " +
        "bukan 'tidak boleh apa-apa'. Grant ulang dengan allowlist eksplisit.",
    );
  }

  const requiredKeys = new Set(required.map((c) => callKey(c.to, c.signature)));
  const seen = new Set<string>();

  for (const call of calls) {
    const to = "to" in call ? call.to : undefined;
    const signature = "signature" in call ? call.signature : undefined;
    if (!to || !signature) {
      throw new SessionPermissionError(
        `Entri allowlist "${describeCall(call)}" hanya mengikat satu sisi. ` +
          "Setiap entri wajib menyebut kontrak (`to`) DAN selector (`signature`) sekaligus.",
      );
    }
    const key = callKey(to, signature);
    if (!requiredKeys.has(key)) {
      throw new SessionPermissionError(
        `Entri allowlist ${to} ${signature} berada di luar yang dibutuhkan agent ini. ` +
          `Yang boleh hanya: ${required.map((c) => `${c.to} ${c.signature}`).join(", ")}.`,
      );
    }
    seen.add(key);
  }

  for (const call of required) {
    if (!seen.has(callKey(call.to, call.signature))) {
      throw new SessionPermissionError(
        `Allowlist sesi tidak memuat ${call.to} ${call.signature}; ` +
          "sesi ini tidak akan bisa menjalankan repay. Grant ulang dengan allowlist yang benar.",
      );
    }
  }
}

/**
 * Menolak sesi tanpa cap native. Ini bukan kerewelan: sesi Altana membayar
 * ongkos relay dari wallet, dan ongkos itu dihitung terhadap cap native.
 * Sesi yang hanya punya cap token gagal di rantai dengan `NoSpendPermissions`
 * sebelum sempat melakukan apa pun (lihat `docs/research/03-altana.md` §2.4).
 */
export function assertNativeSpendCap(permissions: SessionPermissions): void {
  const spend = permissions.spend;
  if (spend === undefined || spend === null || spend.length === 0) {
    throw new SessionPermissionError(
      "Sesi tidak punya `permissions.spend` sama sekali; tanpa cap native, ongkos relay " +
        "tidak punya sumber dan setiap eksekusi gagal sebelum inklusi.",
    );
  }
  const native = spend.find((entry) => entry.token === undefined || entry.token === null);
  if (native === undefined) {
    throw new SessionPermissionError(
      "Sesi tidak punya cap token native (entri `spend` tanpa `token`). Cap native juga " +
        "membayar ongkos relay; tanpanya eksekusi gagal sebelum inklusi.",
    );
  }
  if (native.limit <= 0n) {
    throw new SessionPermissionError(
      `Cap native sesi ${native.limit} bukan angka positif; sesi tidak akan bisa membayar relay.`,
    );
  }
}

/**
 * Custom error kontrak akun Altana untuk panggilan di luar allowlist sesi.
 *
 * Ini SATU-SATUNYA bentuk galat yang boleh dihitung sebagai "batas sesi
 * bekerja". Sebuah `try/catch` yang menerima exception apa pun akan mencetak
 * "ditolak" untuk relay yang membalas HTTP 502, receipt yang timeout, atau
 * nonce race — dan dengan begitu melaporkan bukti yang tidak pernah diuji.
 * Bukti terpenting produk ini tidak boleh bergantung pada kebetulan bahwa
 * sesuatu, entah apa, gagal.
 *
 * Stringnya tidak ada di mana pun dalam kode kita maupun di `node_modules`:
 * ia datang ter-decode dari kontrak akun lewat relay, lengkap dengan `keyHash`,
 * `target`, dan `data` panggilan yang ditolak.
 */
export const SESSION_DENIAL_PATTERN = /UnauthorizedCall/;

/** Pesan galat apa adanya, apa pun bentuk nilai yang dilempar. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Apakah `error` benar-benar penolakan izin sesi terhadap `target`?
 *
 * Dua syarat, dan keduanya wajib:
 *   1. galatnya `UnauthorizedCall` — bukan galat jaringan, timeout, atau revert
 *      kontrak tujuan;
 *   2. galat itu menyebut kontrak yang memang kita coba panggil, sehingga
 *      penolakan atas panggilan lain tidak bisa dipinjam sebagai bukti.
 *
 * Argumen panggilan tidak diperiksa: model izin Altana mengikat kontrak dan
 * selector, tidak pernah nilai argumen (lihat catatan di `requiredSessionCalls`).
 */
export function isSessionDenial(error: unknown, target: `0x${string}`): boolean {
  const message = errorMessage(error);
  return (
    SESSION_DENIAL_PATTERN.test(message) &&
    message.toLowerCase().includes(target.toLowerCase())
  );
}

/**
 * Menuntut `error` adalah penolakan izin sesi terhadap `target`, dan
 * mengembalikan pesannya untuk dicetak. Bentuk galat lain dilempar ulang
 * sebagai KEGAGALAN, bukan diterima sebagai bukti.
 */
export function assertSessionDenial(
  error: unknown,
  target: `0x${string}`,
  label: string,
): string {
  const message = errorMessage(error);
  if (!SESSION_DENIAL_PATTERN.test(message)) {
    throw new SessionPermissionError(
      `Panggilan "${label}" memang gagal, tetapi BUKAN karena batas sesi: galatnya tidak ` +
        `memuat UnauthorizedCall. Relay bisa saja balas 502, receipt timeout, atau terjadi ` +
        `nonce race — tidak satu pun membuktikan apa pun soal izin. Galat apa adanya:\n${message}`,
    );
  }
  if (!message.toLowerCase().includes(target.toLowerCase())) {
    throw new SessionPermissionError(
      `Penolakan UnauthorizedCall untuk "${label}" tidak menyebut kontrak ${target} yang ` +
        `kita coba panggil; penolakan atas panggilan lain tidak bisa dipakai sebagai bukti. ` +
        `Galat apa adanya:\n${message}`,
    );
  }
  return message;
}

/** Satu panggilan kontrak di dalam batch sesi. */
export interface SessionCall {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/** Hasil satu batch lewat sesi. `status` 1 berarti receipt sukses. */
export interface SessionSendResult {
  readonly transactionHash: `0x${string}`;
  readonly status: number;
}

export interface SessionRepayDeps {
  /** Wallet Altana pemilik posisi — pengirim sebenarnya dari `repay`. */
  readonly walletAddress: `0x${string}`;
  /** Pool tujuan `repay`. */
  readonly pool: `0x${string}`;
  /** Token hutang yang boleh dibayar sesi ini. */
  readonly repayAsset: `0x${string}`;
  /** Izin sesi yang benar-benar berlaku, apa adanya dari file sesi. */
  readonly permissions: SessionPermissions;
  /**
   * USD basis 8 desimal → unit token. Disuntik karena konversi (desimal token,
   * harga feed, pemeriksaan bolak-balik) bukan urusan modul penandatanganan.
   */
  readonly toTokenUnits: (asset: `0x${string}`, amountUsd8: bigint) => Promise<bigint> | bigint;
  /** `allowance(owner, spender)` token saat ini. */
  readonly readAllowance: (
    asset: `0x${string}`,
    owner: `0x${string}`,
    spender: `0x${string}`,
  ) => Promise<bigint>;
  /**
   * Mengirim SATU BATCH panggilan lewat sesi Altana — atomik, satu userOp —
   * dan menunggu receipt-nya.
   *
   * Batch, bukan satu panggilan per transaksi, karena guarded executor Porto
   * mengembalikan allowance ERC-20 ke nol di akhir userOp yang sama. Itu
   * perilaku yang benar (allowance dari kunci bocor tidak boleh hidup lebih
   * lama daripada transaksinya), dan konsekuensinya `approve` harus berada di
   * userOp yang sama dengan `repay`.
   */
  readonly sendCalls: (
    calls: readonly SessionCall[],
    description: string,
  ) => Promise<SessionSendResult>;
  readonly log?: (message: string) => void;
}

/** ABI minimal — sumber tunggal untuk selector yang di-allowlist DAN dipanggil. */
const POOL_REPAY_ABI = [
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Menjalankan sesuatu yang terjadi SEBELUM batch dikirim, dan menandai
 * kegagalannya sebagai "belum menyentuh jaringan". Yang dibungkus di sini hanya
 * pembacaan dan konversi; begitu `sendCalls` dipanggil, tidak ada lagi yang
 * boleh mengklaim kepastian itu.
 */
async function tandaiBelumTerkirim<T>(jalankan: () => Promise<T> | T, label: string): Promise<T> {
  try {
    return await jalankan();
  } catch (err) {
    if (err instanceof SessionPermissionError && err.neverSent) throw err;
    throw new SessionPermissionError(
      `${label} gagal sebelum satu pun panggilan dikirim: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { neverSent: true },
    );
  }
}

function assertConfirmed(result: SessionSendResult, label: string): void {
  if (result.status !== 1) {
    // SENGAJA tanpa `neverSent`: sampai di sini batch sudah dikirim dan punya
    // hash. Status yang bukan 1 bisa berarti revert, bisa juga berarti receipt
    // yang dibaca dari node basi — dan yang kedua berakhir dengan transaksi
    // yang tetap mendarat. `execute.ts` harus memperlakukannya sebagai
    // "mungkin terjadi", bukan "tidak terjadi".
    throw new SessionPermissionError(
      `Batch ${label} lewat sesi tidak sukses di rantai (status=${result.status}, ` +
        `tx=${result.transactionHash}).`,
    );
  }
}

/**
 * Membangun `sendRepay` yang menandatangani lewat session key Altana.
 *
 * Izin sesi diperiksa **saat konstruksi**, bukan saat transaksi pertama:
 * sesi yang terlalu longgar harus terlihat sebelum siklus Guardian dimulai,
 * bukan setelah agent sudah memutuskan membayar.
 */
export function createSessionSendRepay(deps: SessionRepayDeps): ExecuteDeps["sendRepay"] {
  const required = requiredSessionCalls(deps.pool, deps.repayAsset);
  assertBoundedAllowlist(deps.permissions, required);
  assertNativeSpendCap(deps.permissions);

  const log = deps.log ?? (() => {});

  return async (asset: `0x${string}`, amountUsd8: bigint): Promise<`0x${string}`> => {
    if (asset.toLowerCase() !== deps.repayAsset.toLowerCase()) {
      throw new SessionPermissionError(
        `Aset repay ${asset} bukan aset yang di-allowlist sesi ini (${deps.repayAsset}); ` +
          "menolak mengirim apa pun.",
        { neverSent: true },
      );
    }
    if (amountUsd8 <= 0n) {
      throw new SessionPermissionError(
        `Jumlah repay ${amountUsd8} bukan angka positif; menolak mengirim apa pun.`,
        { neverSent: true },
      );
    }

    const amountUnits = await tandaiBelumTerkirim(
      () => deps.toTokenUnits(asset, amountUsd8),
      "konversi USD basis 8 desimal ke unit token",
    );
    if (amountUnits <= 0n) {
      throw new SessionPermissionError(
        `Konversi ${amountUsd8} (USD basis 8 desimal) menghasilkan ${amountUnits} unit token; ` +
          "tidak ada yang bisa dibayar.",
        { neverSent: true },
      );
    }

    const allowance = await tandaiBelumTerkirim(
      () => deps.readAllowance(asset, deps.walletAddress, deps.pool),
      "pembacaan allowance",
    );
    const calls: SessionCall[] = [];
    if (allowance < amountUnits) {
      log(
        `sesi: allowance ${allowance} < ${amountUnits}, approve ikut dalam batch yang sama ` +
          `(guarded executor mengembalikannya ke nol di akhir userOp)`,
      );
      calls.push({
        address: asset,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [deps.pool, amountUnits],
      });
    }
    calls.push({
      address: deps.pool,
      abi: POOL_REPAY_ABI,
      functionName: "repay",
      args: [asset, amountUnits],
    });

    const label =
      calls.length === 2
        ? `approve + repay ${amountUnits} unit token ke ${deps.pool}`
        : `repay ${amountUnits} unit token ke ${deps.pool}`;
    const hasil = await deps.sendCalls(calls, label);
    assertConfirmed(hasil, label);
    log(`sesi: repay terkirim ${hasil.transactionHash}`);

    return hasil.transactionHash;
  };
}
