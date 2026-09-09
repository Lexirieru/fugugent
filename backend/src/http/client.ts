/**
 * A resilient HTTP client for calling external sources (8004scan, dGrid).
 *
 * Why this exists: the 8004scan upstream is proven (live research) to answer
 * HTTP 500 without a browser User-Agent header (not 429), and to answer
 * `500 DATABASE_ERROR` intermittently (4 out of 5 attempts failed during the
 * research). dGrid answers 403 without a browser User-Agent. Hence:
 *
 * - A browser User-Agent header is ALWAYS sent and cannot be blanked out —
 *   `userAgent` may be replaced with another browser string (e.g. UA
 *   rotation), but an empty/whitespace string is rejected and falls back to
 *   the default.
 * - Retry with backoff on 5xx, 429, and network/timeout failures.
 * - NO retry on 4xx other than 429 (that is a client error, not upstream down).
 * - A 2xx body that fails to parse as JSON is treated as a data failure
 *   (upstream did in fact answer), NOT a network failure — no retry, not
 *   counted toward the breaker.
 * - The circuit breaker counts failures per **logical `get()` call**, not per
 *   internal retry attempt. With the defaults (`maxAttempts=3`,
 *   `failureThreshold=5`) that means it takes 5 calls that each fail
 *   completely (not 5 raw attempts / ~1.7 calls) before the breaker opens.
 *   This was chosen because the breaker protects against "upstream is
 *   currently down", and the retries inside a single call already absorb
 *   transient failures — counting raw retries would make the breaker far more
 *   sensitive than the `failureThreshold` number implies.
 * - Once the breaker cooldown has elapsed, EXACTLY ONE probe attempt
 *   (half-open) may actually reach upstream at a time. The `probeInFlight`
 *   flag is set synchronously before any `await`, so other concurrent `get()`
 *   calls arriving in the same synchronous turn (e.g. via `Promise.all` right
 *   as the cooldown elapses) see this flag and are rejected fast instead of
 *   all firing at upstream together. Callers that are not the prober do NOT
 *   wait for the probe's result — they are rejected fast with an
 *   `UpstreamError` (status 503) — because they may be asking for a different
 *   URL/options than the prober, and sharing one URL's `data` with a caller
 *   for another URL would be wrong.
 *
 * `fetchImpl` and `now` are injected through the constructor options so tests
 * never touch a real network nor a real wall clock.
 */

/** A real browser UA. Without it 8004scan answers 500 and dGrid answers 403. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RetryOptions {
  /** Total attempts including the first one (not the number of extra retries). */
  maxAttempts: number;
  /** Base delay (ms) before a retry; exponential backoff from this value. */
  baseDelayMs: number;
}

export interface BreakerOptions {
  /** Number of consecutive failed `get()` calls before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a single probe attempt. */
  cooldownMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 300 };
export const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 5, cooldownMs: 30_000 };

export interface HttpClientOptions {
  /** `fetch` is injected — mandatory, so tests do not touch a real network. */
  fetchImpl: typeof fetch;
  /** The clock is injected — mandatory, so breaker/cooldown tests are deterministic. */
  now: () => number;
  /** An empty/whitespace string is rejected and falls back to `DEFAULT_USER_AGENT`. */
  userAgent?: string;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  breaker?: Partial<BreakerOptions>;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
  /**
   * Sent through the `X-API-Key` header, never through the query string/URL.
   * DO NOT pass it via a `{ apiKey: secret }` literal in code that might log
   * these options before calling `get()` — use `withApiKey()` so the key stays
   * non-enumerable (it does not travel into `JSON.stringify`/`console.log`).
   */
  apiKey?: string;
  timeoutMs?: number;
}

export interface HttpResult<T> {
  data: T;
  status: number;
  attempts: number;
}

/** An upstream/network error. Always carries `status` and the number of `attempts` made. */
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

/** A synthetic HTTP status for failures that have no real HTTP status (network/timeout). */
const NETWORK_ERROR_STATUS = 0;
/** The status used when the breaker rejects fast without calling upstream at all. */
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

/**
 * Builds an `HttpGetOptions` fragment with a non-enumerable `apiKey`,
 * consistent with the pattern `loadConfig()` uses in `config.ts`. Use this
 * instead of an `{ apiKey }` literal every time an API key is passed to
 * `client.get()`, so that `console.log(opts)` / `JSON.stringify(opts)` in the
 * calling layer does not leak the key. `extra` (additional headers/timeoutMs)
 * stays enumerable as usual.
 */
export function withApiKey(
  apiKey: string,
  extra?: Omit<HttpGetOptions, "apiKey">,
): HttpGetOptions {
  const opts: HttpGetOptions = { ...extra };
  Object.defineProperty(opts, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return opts;
}

export interface HttpClient {
  get<T = unknown>(url: string, opts?: HttpGetOptions): Promise<HttpResult<T>>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { fetchImpl, now } = options;
  const userAgent =
    options.userAgent && options.userAgent.trim().length > 0
      ? options.userAgent
      : DEFAULT_USER_AGENT;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions: RetryOptions = { ...DEFAULT_RETRY, ...options.retry };
  const breakerOptions: BreakerOptions = { ...DEFAULT_BREAKER, ...options.breaker };

  // Breaker state per client instance (not per request).
  let consecutiveFailures = 0;
  let openUntil: number | null = null;
  // Single-flight guard for the half-open probe attempt. Set SYNCHRONOUSLY
  // (there is no await before it on the probe path) so other concurrent get()
  // calls see it in the same synchronous turn.
  let probeInFlight = false;

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

  /** Called EXACTLY ONCE per logical `get()` call that ends up failing completely. */
  function registerCallFailure(): void {
    consecutiveFailures++;
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
          let data: T;
          try {
            data = (await response.json()) as T;
          } catch (parseErr) {
            // Upstream really did answer (2xx) — this is a data failure, not a
            // network failure. Do not retry, do not count toward the breaker.
            const reason = parseErr instanceof Error ? parseErr.message : "invalid body";
            throw new UpstreamError(
              `upstream answered ${response.status} with an invalid JSON body: ${reason}`,
              response.status,
              attempt,
            );
          }
          onSuccess();
          return { data, status: response.status, attempts: attempt };
        }

        if (!isRetryableStatus(response.status)) {
          // 4xx other than 429: a client error, not a sign that upstream is
          // down. Not counted toward the breaker, not retried.
          throw new UpstreamError(
            `upstream answered with status ${response.status}`,
            response.status,
            attempt,
          );
        }

        lastError = new UpstreamError(
          `upstream answered with status ${response.status}`,
          response.status,
          attempt,
        );

        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(retryOptions.baseDelayMs, attempt - 1));
          continue;
        }

        registerCallFailure();
        throw lastError;
      } catch (err) {
        if (err instanceof UpstreamError) {
          throw err;
        }

        // Network failure / timeout / abort.
        const message = err instanceof Error ? err.message : "network failure";
        lastError = new UpstreamError(message, NETWORK_ERROR_STATUS, attempt);

        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(retryOptions.baseDelayMs, attempt - 1));
          continue;
        }

        registerCallFailure();
        throw lastError;
      }
    }

    // Unreachable — the loop above always returns or throws.
    throw lastError ?? new UpstreamError("unknown failure", NETWORK_ERROR_STATUS, maxAttempts);
  }

  return {
    async get<T = unknown>(url: string, opts?: HttpGetOptions): Promise<HttpResult<T>> {
      const currentTime = now();

      if (openUntil !== null) {
        if (currentTime < openUntil) {
          throw new UpstreamError(
            "circuit breaker open — upstream is currently considered down",
            BREAKER_OPEN_STATUS,
            0,
          );
        }

        // The cooldown has elapsed: only one probe attempt may actually run.
        // The check + set of this flag is synchronous, with no await in
        // between, so other concurrent callers see the same flag.
        if (probeInFlight) {
          throw new UpstreamError(
            "circuit breaker is running a single probe attempt — try again shortly",
            BREAKER_OPEN_STATUS,
            0,
          );
        }
        probeInFlight = true;
        try {
          return await runAttempts<T>(url, opts, 1);
        } finally {
          probeInFlight = false;
        }
      }

      return runAttempts<T>(url, opts, retryOptions.maxAttempts);
    },
  };
}
