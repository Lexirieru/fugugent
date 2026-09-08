/**
 * Plumbing Altana bersama untuk skrip-skrip operasional (grant sesi, penyiapan
 * posisi, uji batas, dan E2E). Tidak ada logika strategi di sini.
 *
 * Kenapa TIDAK memakai `ensureAltanaSessionLoaded()` + `getWallet()` dari
 * `@bnbagent/studio-runtime/wallet`:
 * jalur itu memaksa `permissions.calls` sebuah sesi **sama persis** dengan
 * `defaultAgentPermissions()` milik SDK (ERC-8004 + ERC-8183), dan menolak sesi
 * lain dengan pesan "Altana session does not match the selector-bound
 * @bnbagent/sdk@0.5.4 permission set" — lihat `inspectAltanaSessionPermissions`
 * di `studio-runtime/dist/chunk-ZZZFODYE.js:76`. Sesi Guardian di sini justru
 * HARUS punya allowlist lain (repay + approve, tidak lebih), jadi ia dimuat
 * lewat `deserializeSession` + `AltanaWalletProvider` dari `@bnbagent/sdk`
 * secara langsung. Sesi komersial yang lama tidak disentuh dan tetap dipakai
 * runtime agent apa adanya.
 *
 * Bagian `signer` dari file sesi tidak pernah dibaca, di-parse, atau dicetak di
 * sini: isinya diserahkan utuh ke `deserializeSession`, yang memverifikasi
 * sendiri bahwa kunci di dalamnya menurunkan `publicKey` yang tercatat.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BNB_TESTNET } from "@altananetwork/sdk";
import {
  AltanaWalletProvider,
  deserializeSession,
  setAltanaSdkImporter,
  type AltanaNetworkConfig,
  type AltanaSession,
} from "@bnbagent/sdk/wallets";
import { resolveProjectAltanaSdkEntry } from "@bnbagent/studio-runtime/wallet";
import { encodeFunctionData, type Abi, type PublicClient } from "viem";

/** `.../ai/fuguguardian/app/agent` — akar project yang dipakai `bag`. */
export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `.../ai/fuguguardian` — workspace tempat `.studio/` berada. */
export const WORKSPACE_ROOT = path.resolve(AGENT_ROOT, "../..");

/** Direktori keystore admin Altana (lihat `[wallet].keystore_dir` di studio.toml). */
export const KEYSTORE_DIR = path.join(WORKSPACE_ROOT, ".studio/wallets");

/**
 * File sesi ber-batas milik Guardian. TERPISAH dari `altana-session.json`
 * (sesi komersial ERC-8004/8183 yang dipakai `bag dev`), supaya satu tidak
 * menimpa yang lain.
 */
export const GUARDIAN_SESSION_FILE = path.join(KEYSTORE_DIR, "altana-session-guardian.json");

/**
 * Konfigurasi jaringan Altana untuk BSC testnet, dengan `publicRpcUrl`
 * DI-OVERRIDE. Alamat Keystore/Controller/relay diambil apa adanya dari preset
 * SDK supaya tidak ada salinan alamat yang bisa menyimpang.
 */
export function altanaTestnetNetwork(rpcUrl: string): AltanaNetworkConfig {
  return { ...BNB_TESTNET, publicRpcUrl: rpcUrl } as AltanaNetworkConfig;
}

/**
 * Menyalakan loader ESM untuk `@altananetwork/sdk` yang terpasang di project
 * ini. Tanpa ini, `import("@altananetwork/sdk")` dari dalam paket
 * `@bnbagent/sdk` tidak bisa di-resolve di layout pnpm.
 */
export function armAltanaSdk(): void {
  const entry = resolveProjectAltanaSdkEntry(AGENT_ROOT);
  if (entry === null) {
    throw new Error(
      `@altananetwork/sdk tidak ditemukan dari ${AGENT_ROOT}; jalankan pnpm install di app/agent.`,
    );
  }
  setAltanaSdkImporter(() => import(entry));
}

/** Memuat sesi Guardian dari disk. Isi `signer` tidak pernah disentuh di sini. */
export async function loadGuardianSession(file = GUARDIAN_SESSION_FILE): Promise<AltanaSession> {
  const serialized = readFileSync(file, "utf8");
  return deserializeSession(serialized);
}

/** Provider mode sesi: HANYA bisa mengeksekusi di dalam izin yang di-grant. */
export function sessionProvider(
  session: AltanaSession,
  rpcUrl: string,
): AltanaWalletProvider {
  return new AltanaWalletProvider({ session, network: altanaTestnetNetwork(rpcUrl) });
}

/**
 * Provider mode admin dari keystore terenkripsi. Dipakai HANYA untuk
 * penyiapan (grant sesi, membuat posisi contoh) — tidak pernah untuk repay
 * yang sedang dibuktikan.
 */
export function adminProvider(password: string, address: string, rpcUrl: string): AltanaWalletProvider {
  return AltanaWalletProvider.adminFromKeystore({
    password,
    address,
    walletsDir: KEYSTORE_DIR,
    network: altanaTestnetNetwork(rpcUrl),
  });
}

/** Satu panggilan kontrak yang dikirim lewat relay Altana. */
export interface RelayCall {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/**
 * Hasil satu eksekusi relay. Bentuknya dipersempit dengan sengaja: `TxResult`
 * milik SDK mengacu ke instance viem lain di pohon dependensi (SDK di-hoist ke
 * root workspace), sehingga tipe `TransactionReceipt`-nya tidak assignable
 * bolak-balik. Yang dibutuhkan skrip hanya field-field di bawah ini.
 */
export interface RelayResult {
  readonly transactionHash: `0x${string}`;
  readonly status: number;
  readonly receipt: {
    readonly from: `0x${string}`;
    readonly to: `0x${string}` | null;
    readonly blockNumber: bigint;
    readonly gasUsed: bigint;
    readonly logs: readonly {
      readonly address: `0x${string}`;
      readonly topics: readonly `0x${string}`[];
      readonly data: `0x${string}`;
    }[];
  } | null;
}

/**
 * Mengikat satu provider Altana (mode admin ATAU mode sesi) ke sebuah
 * `PublicClient`, dan mengembalikan fungsi kirim-SATU-BATCH.
 *
 * Kenapa batch, bukan satu panggilan per transaksi seperti
 * `AltanaIntentExecutor`: kunci sesi yang punya spend permission dijalankan
 * lewat guarded executor Porto, dan guard itu **mengembalikan allowance ERC-20
 * ke nol di akhir userOp yang sama** — terbukti di jalan pertama task ini
 * (tx `0xf9570e1e…` memuat dua event `Approval`: 11,67 lalu 0), sehingga
 * `repay` di transaksi berikutnya gagal dengan `ERC20InsufficientAllowance`.
 * Perilaku itu justru benar — allowance dari kunci yang bocor tidak boleh
 * hidup lebih lama daripada transaksinya — dan jawabannya adalah mengirim
 * `approve` + `repay` sebagai SATU userOp atomik.
 *
 * Relay tidak mengembalikan receipt sendiri, jadi `client` yang menunggunya,
 * dan status `FAILED` maupun revert on-chain sama-sama dilempar.
 */
export function relaySender(
  provider: AltanaWalletProvider,
  client: PublicClient,
): (calls: readonly RelayCall[], description: string) => Promise<RelayResult> {
  return async (calls, description) => {
    if (calls.length === 0) throw new Error(`Batch "${description}" kosong.`);

    const encoded = calls.map((call) => ({
      to: call.address,
      value: 0n,
      data: encodeFunctionData({
        abi: call.abi as Abi,
        functionName: call.functionName,
        args: call.args,
      }),
    }));

    const result = await provider._relayExecute(encoded, description);
    if (result.status === "FAILED") {
      throw new Error(`Relay Altana melapor FAILED untuk ${description} (callsId ${result.callsId}).`);
    }
    const hash = result.transactionHash;
    if (!hash) {
      throw new Error(
        `Relay Altana melapor ${result.status} tanpa transactionHash untuk ${description} ` +
          `(callsId ${result.callsId}); inklusi on-chain tidak bisa dipastikan.`,
      );
    }

    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      throw new Error(`Transaksi ${description} revert on-chain (${hash}).`);
    }
    return { transactionHash: hash, status: 1, receipt: receipt as unknown as RelayResult["receipt"] };
  };
}
