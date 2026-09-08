import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { AAVE_V3_POOL_ADDRESS, readAavePosition } from "../chain/aave.js";
import { PositionError } from "../types.js";

const ACCOUNT = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;
const POOL_LAIN = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;

/** The `getUserAccountData` tuple: $7,500 collateral, $3,125 debt, LT 75%, HF 1.8. */
const TUPLE = [
  750_000_000_000n,
  312_500_000_000n,
  0n,
  7_500n,
  6_000n,
  1_800_000_000_000_000_000n,
] as const;

/**
 * A fake client — this test DELIBERATELY does not touch the network (compare with
 * `chain.test.ts`/`testnet.test.ts`, which do call a real RPC). What is tested here is the
 * shape of the call, and that is precisely what the result of a real read cannot show.
 */
function fakeClient(overrides: { blockNumber?: bigint; tuple?: readonly bigint[] } = {}) {
  const readContract = vi.fn(async () => overrides.tuple ?? TUPLE);
  const getBlockNumber = vi.fn(async () => overrides.blockNumber ?? 129_900_000n);
  const client = { chain: { id: 56 }, readContract, getBlockNumber } as unknown as PublicClient;
  return { client, readContract, getBlockNumber };
}

describe("readAavePosition is anchored to a single block", () => {
  it("reads the tuple AT the reported block, not at a separate 'latest'", async () => {
    const { client, readContract, getBlockNumber } = fakeClient({ blockNumber: 129_912_345n });

    const pos = await readAavePosition(client, ACCOUNT);

    expect(getBlockNumber).toHaveBeenCalledOnce();
    // The heart of I4: the block Position reports MUST be the block its numbers were read at.
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 129_912_345n, args: [ACCOUNT] }),
    );
    expect(pos.blockNumber).toBe(129_912_345n);
  });

  it("the block is fetched BEFORE the tuple, so nothing is read from a newer block", async () => {
    const order: string[] = [];
    const client = {
      chain: { id: 56 },
      getBlockNumber: vi.fn(async () => {
        order.push("block");
        return 1n;
      }),
      readContract: vi.fn(async () => {
        order.push("tuple");
        return TUPLE;
      }),
    } as unknown as PublicClient;

    await readAavePosition(client, ACCOUNT);

    expect(order).toEqual(["block", "tuple"]);
  });

  it("uses the default pool address when none is injected, and the injected one when given", async () => {
    const a = fakeClient();
    await readAavePosition(a.client, ACCOUNT);
    expect(a.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: AAVE_V3_POOL_ADDRESS }),
    );

    const b = fakeClient();
    await readAavePosition(b.client, ACCOUNT, POOL_LAIN);
    expect(b.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOL_LAIN }));
  });

  it("the 2^256-1 healthFactor sentinel is normalized to null", async () => {
    const { client } = fakeClient({ tuple: [0n, 0n, 0n, 0n, 0n, 2n ** 256n - 1n] });
    const pos = await readAavePosition(client, ACCOUNT);
    expect(pos.healthFactor).toBeNull();
  });

  it("a client with no chain is refused before a single call is sent", async () => {
    const readContract = vi.fn();
    const client = { readContract, getBlockNumber: vi.fn() } as unknown as PublicClient;
    await expect(readAavePosition(client, ACCOUNT)).rejects.toThrow(PositionError);
    expect(readContract).not.toHaveBeenCalled();
  });
});
