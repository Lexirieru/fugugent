/**
 * Grant satu session key Altana ber-batas untuk Fugu Guardian.
 *
 * Allowlist-nya SEMPIT dengan sengaja: hanya `MockLendingPool.repay` dan
 * `mUSD.approve`, keduanya terikat kontrak DAN selector sekaligus. `calls: []`
 * atau `calls` yang hilang berarti izin TANPA BATAS di Altana, jadi daftar itu
 * dibangun dari `requiredSessionCalls()` — fungsi yang sama yang dipakai
 * `createSessionSendRepay` untuk MEMERIKSA sesi sebelum mengeksekusi. Keduanya
 * karena itu tidak bisa menyimpang satu sama lain.
 *
 * Cap belanja:
 *   - native 0,02 tBNB/hari — juga membayar ongkos relay (cap kekecilan
 *     membuat setiap eksekusi gagal sebelum inklusi, `FAILED` code 300);
 *   - mUSD 100/hari (18 desimal, seperti semua token di BSC) — jauh di atas
 *     satu repay demo, tetapi tetap batas yang keras.
 *
 * Sesi disimpan ke file TERPISAH dari sesi komersial `altana-session.json`,
 * mode 0600, di dalam `.studio/` yang sudah di-gitignore. Isi `signer`-nya
 * tidak pernah dibaca, dicetak, atau disalin oleh skrip ini.
 *
 * Jalankan dari `ai/fuguguardian/app/agent`:
 *   npx tsx scripts/grant-session-guardian.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import { serializeSession } from "@bnbagent/sdk/wallets";

import {
  AGENT_ROOT,
  GUARDIAN_SESSION_FILE,
  WORKSPACE_ROOT,
  adminProvider,
  armAltanaSdk,
} from "./altana.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import { requiredSessionCalls } from "../src/strategy/chain/session.js";

const ALTANA_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;

/** 0,02 tBNB/hari. Cap native juga membayar relay — sengaja tidak pas-pasan. */
const NATIVE_CAP_WEI = 20_000_000_000_000_000n;

/** 100 mUSD/hari. mUSD 18 desimal, seperti semua token di BSC (termasuk USDT). */
const MUSD_CAP = 100n * 10n ** 18n;

const EXPIRY_DAYS = 30;

function main(): Promise<void> {
  loadEnv(path.join(WORKSPACE_ROOT, ".studio/.env.local")); // WALLET_PASSWORD
  loadEnv(path.resolve(AGENT_ROOT, "../../../../contracts/.env")); // BSC_TESTNET_RPC_URL

  const password = process.env.WALLET_PASSWORD;
  if (!password) {
    throw new Error("WALLET_PASSWORD kosong; isi lewat .studio/.env.local, bukan baris perintah.");
  }
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;

  const calls = requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS);
  const spend = [
    { limit: NATIVE_CAP_WEI, period: "day" as const },
    { limit: MUSD_CAP, period: "day" as const, token: REPAY_ASSET_ADDRESS },
  ];
  const expiry = Math.floor(Date.now() / 1000) + EXPIRY_DAYS * 24 * 60 * 60;

  console.log("Grant session key Altana ber-batas untuk Fugu Guardian");
  console.log(`  RPC            : ${rpcUrl}`);
  console.log(`  Wallet Altana  : ${ALTANA_WALLET}`);
  console.log(`  File sesi      : ${GUARDIAN_SESSION_FILE}`);
  console.log("  Allowlist (kontrak + selector, semantik AND):");
  for (const call of calls) console.log(`    - ${call.to}  ${call.signature}`);
  console.log("  Spend cap:");
  console.log(`    - native ${NATIVE_CAP_WEI} wei/hari (0,02 tBNB)`);
  console.log(`    - ${REPAY_ASSET_ADDRESS} ${MUSD_CAP} unit/hari (100 mUSD, 18 desimal)`);
  console.log(`  Expiry         : ${expiry} (${new Date(expiry * 1000).toISOString()})`);
  console.log(`  register       : true (terlihat publik di Keystore on-chain)`);

  if (existsSync(GUARDIAN_SESSION_FILE) && process.env.FORCE_REGRANT !== "1") {
    throw new Error(
      `${GUARDIAN_SESSION_FILE} sudah ada. Grant ulang membakar ongkos registrasi Keystore lagi; ` +
        "jalankan dengan FORCE_REGRANT=1 kalau memang itu yang diinginkan.",
    );
  }

  armAltanaSdk();
  const admin = adminProvider(password, ALTANA_WALLET, rpcUrl);
  if (admin.address.toLowerCase() !== ALTANA_WALLET.toLowerCase()) {
    throw new Error(
      `Keystore membuka wallet ${admin.address}, bukan ${ALTANA_WALLET}; menolak melanjutkan.`,
    );
  }

  return admin
    .grantSession({ permissions: { calls, spend }, expiry, register: true })
    .then((session) => {
      mkdirSync(path.dirname(GUARDIAN_SESSION_FILE), { recursive: true });
      writeFileSync(GUARDIAN_SESSION_FILE, serializeSession(session), { mode: 0o600 });

      // Yang dicetak HANYA metadata publik. `session.signer` tidak pernah disentuh.
      console.log("\n✔ Sesi ter-grant dan tersimpan.");
      console.log(`  walletAddress : ${session.walletAddress}`);
      console.log(`  publicKey     : ${session.publicKey}`);
      console.log(`  expiry        : ${session.expiry}`);
      const txHash = (session as { transactionHash?: string }).transactionHash;
      console.log(`  tx grant      : ${txHash ?? "(relay tidak melaporkan hash)"}`);
      if (txHash) console.log(`  ${`https://testnet.bscscan.com/tx/${txHash}`}`);
    });
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\n✖ GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
