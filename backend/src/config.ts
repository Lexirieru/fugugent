/**
 * The single source of truth for the Fugugent backend configuration:
 * verified testnet contract addresses, network constants, external data source
 * base URLs, and optional API keys.
 *
 * IMPORTANT: `loadConfig` installs every API key as a non-enumerable property.
 * This is not encryption — only a safety net so that
 * `JSON.stringify(config)` or `console.log(config)` never leaks a key into the
 * logs. Code that needs a key still reads it through
 * `config.scan8004.apiKey` directly.
 */

/** BSC testnet chain ID — the only network this project supports. */
export const CHAIN_ID = 97;

/** The SDK default uses the `binance.org` domain, which is blocked from Indonesia. Must be overridden. */
export const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

export const DEFAULT_SCAN8004_BASE_URL = "https://api.8004scan.io/api/v1";
export const DEFAULT_DGRID_BASE_URL = "https://api.dgrid.ai/v1";

/** Verified testnet contract addresses (see docs/setup/ENVIRONMENT.md). */
export const CONTRACT_ADDRESSES = {
  priceOracle: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
  registry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  subscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  reputation: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
} as const;

/** Requests-per-minute tier without an API key. Rises automatically once a key is set. */
/**
 * Browser origins allowed to read this API cross-site.
 *
 * What this does and does not buy, said plainly: CORS is enforced by browsers,
 * so it stops another website's page from reading this API with a visitor's
 * browser. It stops nothing else. `curl`, a script, or any non-browser client
 * ignores it entirely, and it is not an authentication check. The reason to
 * narrow it from `*` anyway is `POST /api/skills`, the one route that writes:
 * with a wildcard, any page anyone visits could register a skill on their
 * behalf.
 *
 * Localhost is on the list because the marketplace is developed against a
 * backend running here. That is a development convenience with a real cost, so
 * it is written down rather than left implicit: a page served from localhost on
 * a developer's machine can read this API.
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://hellofugu.xyz",
  "https://www.hellofugu.xyz",
  "https://app.hellofugu.xyz",
  "http://localhost:3000",
] as const;

export const ANONYMOUS_RATE_LIMIT_PER_MINUTE = 30;
export const AUTHENTICATED_RATE_LIMIT_PER_MINUTE = 120;

export type ContractAddresses = typeof CONTRACT_ADDRESSES;

export interface UpstreamSourceConfig {
  baseUrl: string;
  /** `undefined` when unset — the anonymous tier. Non-enumerable, see the note above. */
  apiKey?: string;
  rateLimitPerMinute: number;
}

export interface FugugentConfig {
  chainId: number;
  rpcUrl: string;
  /** See `DEFAULT_ALLOWED_ORIGINS`. Never empty: an empty list would allow nothing. */
  allowedOrigins: readonly string[];
  contracts: ContractAddresses;
  scan8004: UpstreamSourceConfig;
  dgrid: UpstreamSourceConfig;
}

type EnvLike = Partial<Record<string, string | undefined>>;

function readEnv(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

/** Builds an upstream source object with a non-enumerable apiKey — never shows up in JSON/logs. */
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
 * Splits `ALLOWED_ORIGINS` on commas.
 *
 * A value that is set but contains no usable entry falls back to the defaults
 * rather than to an empty list. An empty list allows no origin at all, which
 * would take the marketplace down; a typo in a deploy variable should not be
 * able to do that silently.
 */
export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Loads the configuration from the environment (`process.env` by default).
 * Never throws — every value has a safe testnet default.
 */
export function loadConfig(env: EnvLike = process.env): FugugentConfig {
  return {
    chainId: CHAIN_ID,
    rpcUrl: readEnv(env, "RPC_URL") ?? DEFAULT_RPC_URL,
    allowedOrigins: parseAllowedOrigins(readEnv(env, "ALLOWED_ORIGINS")),
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
