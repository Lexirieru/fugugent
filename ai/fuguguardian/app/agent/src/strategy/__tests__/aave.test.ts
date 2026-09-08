import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { AAVE_V3_POOL_ADDRESS, readAavePosition } from "../chain/aave.js";
import { PositionError } from "../types.js";

const AKUN = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;
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

describe("readAavePosition ditambatkan ke satu blok", () => {
  it("membaca tuple PADA blok yang dilaporkan, bukan pada 'latest' yang terpisah", async () => {
    const { client, readContract, getBlockNumber } = fakeClient({ blockNumber: 129_912_345n });

    const pos = await readAavePosition(client, AKUN);

    expect(getBlockNumber).toHaveBeenCalledOnce();
    // The heart of I4: the block Position reports MUST be the block its numbers were read at.
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 129_912_345n, args: [AKUN] }),
    );
    expect(pos.blockNumber).toBe(129_912_345n);
  });

  it("blok diambil SEBELUM tuple, sehingga tidak ada bacaan dari blok yang lebih baru", async () => {
    const urutan: string[] = [];
    const client = {
      chain: { id: 56 },
      getBlockNumber: vi.fn(async () => {
        urutan.push("blok");
        return 1n;
      }),
      readContract: vi.fn(async () => {
        urutan.push("tuple");
        return TUPLE;
      }),
    } as unknown as PublicClient;

    await readAavePosition(client, AKUN);

    expect(urutan).toEqual(["blok", "tuple"]);
  });

  it("memakai alamat pool default bila tidak disuntikkan, dan alamat yang disuntikkan bila ada", async () => {
    const a = fakeClient();
    await readAavePosition(a.client, AKUN);
    expect(a.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: AAVE_V3_POOL_ADDRESS }),
    );

    const b = fakeClient();
    await readAavePosition(b.client, AKUN, POOL_LAIN);
    expect(b.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOL_LAIN }));
  });

  it("healthFactor sentinel 2^256-1 dinormalkan menjadi null", async () => {
    const { client } = fakeClient({ tuple: [0n, 0n, 0n, 0n, 0n, 2n ** 256n - 1n] });
    const pos = await readAavePosition(client, AKUN);
    expect(pos.healthFactor).toBeNull();
  });

  it("client tanpa chain ditolak sebelum satu panggilan pun dikirim", async () => {
    const readContract = vi.fn();
    const client = { readContract, getBlockNumber: vi.fn() } as unknown as PublicClient;
    await expect(readAavePosition(client, AKUN)).rejects.toThrow(PositionError);
    expect(readContract).not.toHaveBeenCalled();
  });
});
