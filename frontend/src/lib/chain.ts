/**
 * Konstanta rantai untuk marketplace. Disalin apa adanya dari
 * `contracts/deployments/bsc-testnet.json`, `docs/setup/ENVIRONMENT.md`, dan
 * `docs/e2e/2026-09-08-e2e-testnet.md`.
 *
 * Aturan yang mengikat: **setiap angka yang tampil di UI harus bisa diklik ke
 * bukti**. Kalau sebuah angka tidak punya tx hash atau perintah verifikasi,
 * angka itu ditandai terbuka sebagai tanpa bukti — bukan disembunyikan.
 */

export const CHAIN = {
  id: 97,
  name: "BNB Smart Chain Testnet",
  explorer: "https://testnet.bscscan.com",
  /** `binance.org` diblokir dari Indonesia — selalu override RPC. */
  rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
} as const;

export function txUrl(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${CHAIN.explorer}/address/${address}`;
}

/** Potong hash/alamat panjang supaya tidak memaksa scroll horizontal. */
export function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const CONTRACTS = {
  registry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  subscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  reputation: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
  priceOracle: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
} as const;

export const CONTRACT_LIST = [
  {
    name: "FuguRegistry",
    address: CONTRACTS.registry,
    role: "Agent listings, categories, curation",
  },
  {
    name: "FuguSubscription",
    address: CONTRACTS.subscription,
    role: "Escrowed hire, streamed payout, refund",
  },
  {
    name: "FuguPriceOracle",
    address: CONTRACTS.priceOracle,
    role: "Chainlink pricing, buyer picks the token",
  },
  {
    name: "FuguReputation",
    address: CONTRACTS.reputation,
    role: "Reviews gated by proof of payment",
  },
] as const;

/**
 * Bukti tunggal: satu baris yang bisa diklik ke BscScan, atau satu baris yang
 * menyatakan terbuka kenapa tidak ada tautan. Tidak ada bentuk ketiga.
 */
export type Proof = {
  label: string;
  detail: string;
  /** `null` bila memang tidak ada blok yang bisa dibuka. */
  hash: string | null;
  /** Wajib saat `hash` null. */
  noLinkReason?: string;
};
