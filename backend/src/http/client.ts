/**
 * Klien HTTP tahan banting untuk memanggil sumber eksternal (8004scan, dGrid).
 *
 * Kenapa ini ada: upstream 8004scan terbukti (riset live) membalas HTTP 500
 * tanpa header User-Agent browser (bukan 429), dan membalas `500
 * DATABASE_ERROR` secara intermiten (4 dari 5 percobaan gagal saat riset).
 * dGrid membalas 403 tanpa User-Agent browser. Karena itu:
 *
 * - Header User-Agent browser SELALU dikirim, tidak bisa dimatikan.
 * - Retry dengan backoff pada 5xx, 429, dan kegagalan jaringan/timeout.
 * - TIDAK retry pada 4xx selain 429 (itu kesalahan klien, bukan upstream down).
 * - Circuit breaker: setelah N kegagalan berturut-turut, tolak cepat selama
 *   cooldown, lalu izinkan tepat satu percobaan pengintaian (half-open).
 *
 * `fetchImpl` dan `now` disuntikkan lewat opsi konstruktor supaya test tidak
 * pernah menyentuh jaringan sungguhan maupun jam dinding sungguhan.
 */

/** UA browser sungguhan. Tanpa ini 8004scan membalas 500, dGrid membalas 403. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RetryOptions {
  /** Total percobaan termasuk yang pertama (bukan jumlah retry tambahan). */
  maxAttempts: number;
  /** Delay dasar (ms) sebelum retry; exponential backoff dari nilai ini. */
  baseDelayMs: number;
}

export interface BreakerOptions {
  /** Jumlah kegagalan berturut-turut sebelum breaker membuka. */
  failureThreshold: number;
  /** Lama breaker tetap terbuka sebelum mengizinkan satu percobaan pengintaian. */
  cooldownMs: number;
}

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 300 };
const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 5, cooldownMs: 30_000 };

export interface HttpClientOptions {
  /** `fetch` disuntikkan — wajib, supaya test tidak menyentuh jaringan sungguhan. */
  fetchImpl: typeof fetch;
  /** Jam disuntikkan — wajib, supaya test breaker/cooldown deterministik. */
  now: () => number;
  userAgent?: string;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  breaker?: Partial<BreakerOptions>;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
  /** Dikirim lewat header `X-API-Key`, tidak pernah lewat query string/URL. */
  apiKey?: string;
  timeoutMs?: number;
}

export interface HttpResult<T> {
  data: T;
  status: number;
  attempts: number;
}

/** Error upstream/jaringan. Selalu membawa `status` dan jumlah `attempts` yang ditempuh. */
export class UpstreamError extends Error {
  readonly status: number;
  readonly attempts: number;

  constructor(message: string, status: number, attempts: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.attempts = attempts;
  }
}

/** Status HTTP synthetic untuk kegagalan yang tidak punya status HTTP asli (network/timeout). */
const NETWORK_ERROR_STATUS = 0;
/** Status yang dipakai saat breaker menolak cepat tanpa memanggil upstream sama sekali. */
const BREAKER_OPEN_STATUS = 503;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function backoffDelayMs(baseDelayMs: number, attemptIndexZeroBased: number): number {
  return baseDelayMs * 2 ** attemptIndexZeroBased;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HttpClient {
  get<T = unknown>(url: string, opts?: HttpGetOptions): Promise<HttpResult<T>>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { fetchImpl, now } = options;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions: RetryOptions = { ...DEFAULT_RETRY, ...options.retry };
  const breakerOptions: BreakerOptions = { ...DEFAULT_BREAKER, ...options.breaker };

  // State breaker per instance klien (bukan per-request).
  let consecutiveFailures = 0;
  let openUntil: number | null = null;

  function buildHeaders(opts?: HttpGetOptions): Headers {
    const headers = new Headers();
    headers.set("User-Agent", userAgent);
    headers.set("Accept", "application/json");
    if (opts?.headers) {
      for (const [key, value] of Object.entries(opts.headers)) {
        headers.set(key, value);
      }
    }
    if (opts?.apiKey) {
      headers.set("X-API-Key", opts.apiKey);
    }
    return headers;
  }

  async function doFetch(url: string, opts?: HttpGetOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: "GET",
        headers: buildHeaders(opts),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function openBreakerIfThresholdReached(): void {
    if (consecutiveFailures >= breakerOptions.failureThreshold) {
      openUntil = now() + breakerOptions.cooldownMs;
    }
  }

  function onSuccess(): void {
    consecutiveFailures = 0;
    openUntil = null;
  }

  async function runAttempts<T>(
    url: string,
    opts: HttpGetOptions | undefined,
    maxAttempts: number,
  ): Promise<HttpResult<T>> {
    let lastError: UpstreamError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await doFetch(url, opts);

        if (response.status < 400) {
          const data = (await response.json()) as T;
          onSuccess();
          return { data, status: response.status, attempts: attempt };
        }

        if (!isRetryableStatus(response.status)) {
          // 4xx selain 429: kesalahan klien, bukan indikasi upstream tumbang.
          // Tidak menghitung ke breaker, tidak retry.
          throw new UpstreamError(
            `upstream membalas status ${response.status}`,
            response.status,
            attempt,
          );
        }

        consecutiveFailures++;
        lastError = new UpstreamError(
          `upstream membalas status ${response.status}`,
          response.status,
          attempt,
        );

        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(retryOptions.baseDelayMs, attempt - 1));
          continue;
        }

        openBreakerIfThresholdReached();
        throw lastError;
      } catch (err) {
        if (err instanceof UpstreamError) {
          throw err;
        }

        // Kegagalan jaringan / timeout / abort.
        consecutiveFailures++;
        const message = err instanceof Error ? err.message : "kegagalan jaringan";
        lastError = new UpstreamError(message, NETWORK_ERROR_STATUS, attempt);

        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(retryOptions.baseDelayMs, attempt - 1));
          continue;
        }

        openBreakerIfThresholdReached();
        throw lastError;
      }
    }

    // Tidak tercapai — loop di atas selalu return atau throw.
    throw lastError ?? new UpstreamError("kegagalan tak dikenal", NETWORK_ERROR_STATUS, maxAttempts);
  }

  return {
    async get<T = unknown>(url: string, opts?: HttpGetOptions): Promise<HttpResult<T>> {
      const currentTime = now();

      if (openUntil !== null && currentTime < openUntil) {
        throw new UpstreamError(
          "circuit breaker terbuka — upstream sedang dianggap tumbang",
          BREAKER_OPEN_STATUS,
          0,
        );
      }

      const isReconnaissance = openUntil !== null; // cooldown sudah lewat
      const maxAttempts = isReconnaissance ? 1 : retryOptions.maxAttempts;

      return runAttempts<T>(url, opts, maxAttempts);
    },
  };
}
