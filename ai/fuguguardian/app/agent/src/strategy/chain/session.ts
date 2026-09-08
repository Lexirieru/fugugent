/**
 * The `repay` signer that goes through a **bounded Altana session key**.
 *
 * This is a drop-in replacement for `ExecuteDeps["sendRepay"]`, which used to be signed by
 * the deployer EOA — a key with full power. The difference is not cosmetic: the spending
 * cap, the contract allowlist, and the session expiry are enforced **by the Altana account
 * contract on chain**, not by code in this repo. If the agent process is hijacked, the key
 * it holds still cannot call anything outside the allowlist.
 *
 * This module DELIBERATELY contains no strategy logic and does not touch the network
 * itself. There are only three things here:
 *
 *   1. **Checking the session permissions before anything is sent.** An empty or missing
 *      `calls` means UNLIMITED permission in Altana (see `docs/research/03-altana.md` §2.3)
 *      — so our code refuses it first, before the SDK is even called. The same goes for
 *      "wildcard" entries that bind only a contract with no selector (or vice versa), and
 *      for any entry outside the list actually needed.
 *   2. **Composing the calls** — `approve` + `repay` from the minimal ABIs below. The
 *      signatures used for the allowlist are derived from the same constants used to make
 *      the calls, so the two cannot drift apart.
 *   3. **Sending through the session** — via the caller-injected `sendCall`, so every rule
 *      above can be tested with no network at all.
 *
 * The `signer` part of the session file is never read, printed, or copied anywhere in this
 * module; the session only comes through as an already-bound `sendCall`.
 */
import type { ExecuteDeps } from "../execute.js";

/**
 * One Altana allowlist rule. Its union shape deliberately mirrors the SDK's exactly:
 * `{ to }` alone means "every method on that contract", `{ signature }` alone means "that
 * method on any contract". Both are too loose for this agent, and `assertBoundedAllowlist`
 * refuses them.
 */
export type SessionCallPermission =
  | { readonly to: `0x${string}`; readonly signature: string }
  | { readonly to: `0x${string}` }
  | { readonly signature: string };

/** The spending cap per token for one rolling period. */
export interface SessionSpendPermission {
  readonly limit: bigint;
  readonly period: string;
  /** Omitted means the native token (tBNB) — this is what pays the relay cost. */
  readonly token?: `0x${string}`;
}

/** The shape of an Altana session's `permissions`, as far as this module checks it. */
export interface SessionPermissions {
  readonly calls?: readonly SessionCallPermission[] | null;
  readonly spend?: readonly SessionSpendPermission[] | null;
}

/** One allowlist entry that binds both a contract AND a selector. */
export interface BoundCallPermission {
  readonly to: `0x${string}`;
  readonly signature: string;
}

/** The `MockLendingPool.repay` selector — the only way the agent repays debt. */
export const REPAY_SIGNATURE = "repay(address,uint256)";

/** The `ERC20.approve` selector — needed because `repay` pulls via an allowance. */
export const APPROVE_SIGNATURE = "approve(address,uint256)";

/**
 * A session permission error: it always means "do not send anything".
 *
 * `neverSent` states whether this error happened BEFORE anything touched the network. This
 * module is the only one that knows where that boundary lies — everything up to just before
 * `deps.sendCalls` is provably not yet sent; anything after that cannot be known for
 * certain. `execute.ts` reads it via `wasNeverSent()` to decide whether the budget gets
 * deducted (see the C2 note at the top of `execute.ts`). Its default is `false`: silence
 * means "may already have been sent", the assumption that errs toward not paying twice.
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
 * The minimum allowlist Guardian needs: `repay` on the pool and `approve` on the debt
 * token. Nothing more. Used both when granting the session and when re-checking it before
 * execution, so the two cannot differ.
 *
 * **Altana's permission boundary stops at contract + selector; it does not bind argument
 * values.** This session may therefore technically call `mUSD.approve(<anyone>, <any
 * amount>)` and `pool.repay(<any asset>, ...)`. Three things hold it back, and only two are
 * ours:
 *   1. the per-token spend cap on the session (enforced by the Altana account);
 *   2. `createSessionSendRepay`, which only ever composes `approve` for the pool and
 *      `repay` for the allowlisted asset — but this is our own code, so it is gone the
 *      moment the process is hijacked;
 *   3. Porto's guarded executor, which zeroes ERC-20 allowances at the end of a userOp — a
 *      third-party behavior we found **empirically** during this task, not something our
 *      contracts guarantee, and not something to rely on silently.
 * If argument binding is ever needed, its place is an allowlisted intermediary contract,
 * not this module.
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
 * Refuses permissions looser than `required`, BEFORE the SDK is called.
 *
 * Five refusals, in order:
 *   1. `calls` is missing -> in Altana that is unlimited permission.
 *   2. `calls` is empty -> the same thing, and this is the trap people fall into most.
 *   3. an entry with no `to` or no `signature` -> a one-sided wildcard.
 *   4. an entry not in `required` -> the session is broader than what is needed.
 *   5. an entry in `required` missing from the session -> the session cannot work.
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
 * Refuses a session with no native cap. This is not fussiness: an Altana session pays the
 * relay cost out of the wallet, and that cost is charged against the native cap. A session
 * with only a token cap fails on chain with `NoSpendPermissions` before it manages to do
 * anything (see `docs/research/03-altana.md` §2.4).
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
 * The Altana account contract's custom error for a call outside the session allowlist.
 *
 * This is the ONLY error shape that may count as "the session boundary works". A
 * `try/catch` that accepts any exception would print "denied" for a relay answering HTTP
 * 502, a timed-out receipt, or a nonce race — and thereby report evidence that was never
 * tested. This product's most important piece of evidence must not rest on the coincidence
 * that something, anything, failed.
 *
 * The string appears nowhere in our code nor in `node_modules`: it arrives decoded from the
 * account contract through the relay, complete with the `keyHash`, `target`, and `data` of
 * the refused call.
 */
export const SESSION_DENIAL_PATTERN = /UnauthorizedCall/;

/** The error message as-is, whatever shape the thrown value has. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Is `error` genuinely a session permission denial for `target`?
 *
 * Two conditions, both required:
 *   1. the error is `UnauthorizedCall` — not a network error, a timeout, or a revert from
 *      the target contract;
 *   2. the error names the contract we actually tried to call, so a denial of some other
 *      call cannot be borrowed as evidence.
 *
 * The call's arguments are not checked: Altana's permission model binds contracts and
 * selectors, never argument values (see the note on `requiredSessionCalls`).
 */
export function isSessionDenial(error: unknown, target: `0x${string}`): boolean {
  const message = errorMessage(error);
  return (
    SESSION_DENIAL_PATTERN.test(message) &&
    message.toLowerCase().includes(target.toLowerCase())
  );
}

/**
 * Demands that `error` is a session permission denial for `target`, and returns its message
 * to be printed. Any other error shape is rethrown as a FAILURE, not accepted as evidence.
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

/** One contract call inside a session batch. */
export interface SessionCall {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/** The result of one batch through the session. `status` 1 means a successful receipt. */
export interface SessionSendResult {
  readonly transactionHash: `0x${string}`;
  readonly status: number;
}

export interface SessionRepayDeps {
  /** The position owner's Altana wallet — the actual sender of `repay`. */
  readonly walletAddress: `0x${string}`;
  /** The pool `repay` targets. */
  readonly pool: `0x${string}`;
  /** The debt token this session may repay. */
  readonly repayAsset: `0x${string}`;
  /** The session permissions actually in force, exactly as they came from the session file. */
  readonly permissions: SessionPermissions;
  /**
   * USD on the 8-decimal basis -> token units. Injected because the conversion (token
   * decimals, feed price) is not the signing module's business.
   *
   * **MUST be side-effect free — reads only.** Its failure is treated as "never touched the
   * network" (`neverSent`), so no budget is deducted and no pending record is left behind.
   * An implementation that sends a transaction here would make that assumption a lie, and a
   * lie in the direction that pays twice.
   */
  readonly toTokenUnits: (asset: `0x${string}`, amountUsd8: bigint) => Promise<bigint> | bigint;
  /** The token's current `allowance(owner, spender)`. **MUST read only** — see `toTokenUnits`. */
  readonly readAllowance: (
    asset: `0x${string}`,
    owner: `0x${string}`,
    spender: `0x${string}`,
  ) => Promise<bigint>;
  /**
   * Sends ONE BATCH of calls through the Altana session — atomic, a single userOp — and
   * waits for its receipt.
   *
   * A batch, rather than one call per transaction, because Porto's guarded executor returns
   * ERC-20 allowances to zero at the end of that same userOp. That is the correct behavior
   * (an allowance from a leaked key must not outlive its transaction), and the consequence
   * is that `approve` has to sit in the same userOp as `repay`.
   */
  readonly sendCalls: (
    calls: readonly SessionCall[],
    description: string,
  ) => Promise<SessionSendResult>;
  readonly log?: (message: string) => void;
}

/** Minimal ABIs — the single source for the selectors that are both allowlisted AND called. */
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
 * Runs something that happens BEFORE the batch is sent, and marks its failure as "never
 * touched the network". Only reads and conversions are wrapped here; once `sendCalls` is
 * called, nothing may claim that certainty any more.
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
    // DELIBERATELY without `neverSent`: by this point the batch has been sent and has a
    // hash. A status other than 1 can mean a revert, but it can also mean a receipt read
    // from a stale node — and the second ends with the transaction landing anyway.
    // `execute.ts` has to treat it as "may have happened", not "did not happen".
    throw new SessionPermissionError(
      `Batch ${label} lewat sesi tidak sukses di rantai (status=${result.status}, ` +
        `tx=${result.transactionHash}).`,
    );
  }
}

/**
 * Builds a `sendRepay` that signs via an Altana session key.
 *
 * The session permissions are checked **at construction**, not on the first transaction: a
 * session that is too loose must be visible before Guardian's cycle starts, not after the
 * agent has already decided to pay.
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
