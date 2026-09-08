/**
 * Satu sumber kebenaran untuk konfigurasi backend Fugugent:
 * alamat kontrak testnet terverifikasi, konstanta jaringan, base URL sumber
 * data eksternal, dan API key opsional.
 *
 * PENTING: `loadConfig` menaruh setiap API key sebagai properti
 * non-enumerable. Ini bukan enkripsi — hanya jaring pengaman supaya
 * `JSON.stringify(config)` atau `console.log(config)` tidak pernah
 * membocorkan key ke log. Kode yang butuh key tetap mengaksesnya lewat
 * `config.scan8004.apiKey` secara langsung.
 */

/** Chain ID BSC testnet — satu-satunya jaringan yang didukung proyek ini. */
export const CHAIN_ID = 97;

/** Default SDK memakai domain `binance.org` yang diblokir dari Indonesia. Wajib override. */
export const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

export const DEFAULT_SCAN8004_BASE_URL = "https://api.8004scan.io/api/v1";
export const DEFAULT_DGRID_BASE_URL = "https://api.dgrid.ai/v1";

/** Alamat kontrak testnet terverifikasi (lihat docs/setup/ENVIRONMENT.md). */
export const CONTRACT_ADDRESSES = {
  priceOracle: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
  registry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  subscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  reputation: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
} as const;

/** Tier request/menit tanpa API key. Naik otomatis begitu key diisi. */
export const ANONYMOUS_RATE_LIMIT_PER_MINUTE = 30;
export const AUTHENTICATED_RATE_LIMIT_PER_MINUTE = 120;

export type ContractAddresses = typeof CONTRACT_ADDRESSES;

export interface UpstreamSourceConfig {
  baseUrl: string;
  /** `undefined` bila tidak diisi — tier anonim. Non-enumerable, lihat catatan di atas. */
  apiKey?: string;
  rateLimitPerMinute: number;
}

export interface FugugentConfig {
  chainId: number;
  rpcUrl: string;
  contracts: ContractAddresses;
  scan8004: UpstreamSourceConfig;
  dgrid: UpstreamSourceConfig;
}

type EnvLike = Partial<Record<string, string | undefined>>;

function readEnv(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

/** Bikin objek sumber upstream dengan apiKey non-enumerable — tidak pernah muncul di JSON/log. */
function buildUpstreamConfig(baseUrl: string, apiKey: string | undefined): UpstreamSourceConfig {
  const config = {
    baseUrl,
    rateLimitPerMinute: apiKey
      ? AUTHENTICATED_RATE_LIMIT_PER_MINUTE
      : ANONYMOUS_RATE_LIMIT_PER_MINUTE,
  } as UpstreamSourceConfig;

  Object.defineProperty(config, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return config;
}

/**
 * Muat konfigurasi dari environment (default `process.env`). Tidak pernah
 * melempar — setiap nilai punya default aman untuk testnet.
 */
export function loadConfig(env: EnvLike = process.env): FugugentConfig {
  return {
    chainId: CHAIN_ID,
    rpcUrl: readEnv(env, "RPC_URL") ?? DEFAULT_RPC_URL,
    contracts: CONTRACT_ADDRESSES,
    scan8004: buildUpstreamConfig(
      readEnv(env, "SCAN8004_BASE_URL") ?? DEFAULT_SCAN8004_BASE_URL,
      readEnv(env, "SCAN8004_API_KEY"),
    ),
    dgrid: buildUpstreamConfig(
      readEnv(env, "DGRID_BASE_URL") ?? DEFAULT_DGRID_BASE_URL,
      readEnv(env, "DGRID_API_KEY"),
    ),
  };
}
