/**
 * Shared fixtures: price demands shaped exactly like the ones a real seller sends.
 *
 * The shape is not invented. It is what `@altananetwork/x402-server` writes, which is the
 * same library this agent's own seller route uses, so a rule tested here is tested
 * against the wire format it will actually meet.
 */
import { WAD } from "../types.js";

export const U_TESTNET = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;
export const USDT_TESTNET = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
export const SELLER = "0x1B82F72346a8553a968fafD6AC07A21d4A88589f" as const;
export const SETTLER = "0x0000000000000000000000000000000000009999" as const;

/** One cent, in 18 decimals. The price this project's own seller route charges. */
export const ONE_CENT = WAD / 100n;

export interface OptionOverrides {
  scheme?: string;
  network?: unknown;
  asset?: string;
  payTo?: string;
  amount?: string;
  maxTimeoutSeconds?: number;
  assetTransferMethod?: string;
  name?: string;
  version?: string;
  spenderAddress?: string;
}

export function option(over: OptionOverrides = {}): Record<string, unknown> {
  const {
    assetTransferMethod = "eip3009",
    name = "United Stables",
    version = "1",
    spenderAddress,
    ...rest
  } = over;
  return {
    scheme: "exact",
    network: "eip155:97",
    asset: U_TESTNET,
    payTo: SELLER,
    amount: ONE_CENT.toString(),
    maxTimeoutSeconds: 300,
    extra: {
      name,
      version,
      assetTransferMethod,
      ...(spenderAddress === undefined ? {} : { spenderAddress }),
    },
    ...rest,
  };
}

export function demandBody(
  options: Record<string, unknown>[] = [option()],
): Record<string, unknown> {
  return {
    x402Version: 2,
    error: "payment required",
    resource: { url: "https://api.hellofugu.xyz/quote" },
    accepts: options,
  };
}
