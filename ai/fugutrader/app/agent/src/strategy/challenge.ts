/**
 * Reading a seller's price demand.
 *
 * PURE: no network, no clock, no I/O. The body arrives as already-parsed JSON, and this
 * module turns it into the shape the decision engine reasons about.
 *
 * Every field here was written by the seller, which is to say by somebody who benefits
 * from this agent misreading it. So nothing is coerced, nothing is defaulted, and
 * anything unreadable becomes `null` and is refused one layer later with a named reason.
 * A parser that guesses at a missing amount is a parser that invents a price.
 */
import type { PaymentOption, PriceDemand, Rail } from "./types.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^\d+$/;
const CAIP2 = /^eip155:(\d+)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && ADDRESS.test(value) ? (value as `0x${string}`) : null;
}

/**
 * The chain the option is for.
 *
 * Two spellings exist on the wire: the current one, `eip155:97`, and a bare number that
 * older sellers still send. Both are read; anything else is null, because a payment whose
 * chain cannot be established is a payment that could be for any chain, including one
 * where the money is real.
 */
export function readChainId(network: unknown, fallback: unknown): number | null {
  if (typeof network === "string") {
    const match = CAIP2.exec(network);
    if (match) return Number(match[1]);
  }
  for (const candidate of [network, fallback]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === "string" && DIGITS.test(candidate)) return Number(candidate);
  }
  return null;
}

/**
 * Which way of authorising the payment the option asks for.
 *
 * Sellers put the real answer in `extra.assetTransferMethod` and leave `scheme` set to
 * "exact" for both, so reading `scheme` alone tells you nothing about what is being
 * signed. An unknown value is null: signing the wrong kind of authorisation is signing
 * something this agent has not read.
 */
export function readRail(extra: Record<string, unknown> | null): Rail | null {
  const method = extra?.assetTransferMethod;
  if (method === "eip3009") return "eip3009";
  if (method === "permit2-exact") return "permit2-exact";
  return null;
}

/**
 * The amount asked for.
 *
 * Two field names are in use: `amount` in the current wire format and
 * `maxAmountRequired` in the older one. Both are read. A value that is not a string of
 * digits is null rather than zero, because zero would read as free.
 */
export function readAmount(option: Record<string, unknown>): bigint | null {
  for (const key of ["amount", "maxAmountRequired"]) {
    const raw = option[key];
    if (typeof raw === "string" && DIGITS.test(raw)) return BigInt(raw);
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  }
  return null;
}

function readTimeout(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && DIGITS.test(value)) {
    const n = Number(value);
    return n > 0 ? n : null;
  }
  return null;
}

/** What the payment buys, when the seller said. Both spellings are accepted. */
export function readResourceUrl(body: Record<string, unknown>): string | null {
  const resource = body.resource;
  if (typeof resource === "string") return resource;
  const record = asRecord(resource);
  if (record !== null && typeof record.url === "string") return record.url;
  return null;
}

/**
 * Reads a seller's price demand.
 *
 * A body with no readable list of options comes back with no options at all, and the
 * decision engine answers "there is nothing here I am willing to pay". That is the right
 * outcome: an empty list is not an error to be recovered from, it is a seller this agent
 * cannot transact with.
 */
export function parsePriceDemand(body: unknown): PriceDemand {
  const record = asRecord(body);
  if (record === null) return { resourceUrl: null, options: [] };

  const accepts = Array.isArray(record.accepts) ? record.accepts : [];
  const options: PaymentOption[] = accepts.map((raw, index) => {
    const option = asRecord(raw);
    if (option === null) {
      return {
        index,
        scheme: "",
        chainId: null,
        rail: null,
        asset: null,
        payTo: null,
        amount: null,
        maxTimeoutSeconds: null,
        tokenName: null,
        tokenVersion: null,
        spender: null,
        raw,
      };
    }
    const extra = asRecord(option.extra);
    return {
      index,
      scheme: typeof option.scheme === "string" ? option.scheme : "",
      chainId: readChainId(option.network, option.chainId),
      rail: readRail(extra),
      asset: asAddress(option.asset),
      payTo: asAddress(option.payTo),
      amount: readAmount(option),
      maxTimeoutSeconds: readTimeout(option.maxTimeoutSeconds),
      tokenName: typeof extra?.name === "string" ? extra.name : null,
      tokenVersion: typeof extra?.version === "string" ? extra.version : null,
      // Two spellings again: the current wire format and the older one.
      spender: asAddress(extra?.spenderAddress) ?? asAddress(extra?.spender),
      raw,
    };
  });

  return { resourceUrl: readResourceUrl(record), options };
}
