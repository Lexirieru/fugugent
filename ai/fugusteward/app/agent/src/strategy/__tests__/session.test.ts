import { describe, expect, it } from "vitest";
import {
  assertBoundedAllowlist,
  assertNativeSpendCap,
  assertNotExpired,
  assertSessionUsable,
  EXPIRY_SAFETY_MARGIN_SECONDS,
  SessionError,
  type BoundCallPermission,
  type SessionPermissions,
} from "../session.js";

const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const TOKEN = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

const REQUIRED: readonly BoundCallPermission[] = [
  { to: POOL, signature: "repay(address,uint256)" },
  { to: TOKEN, signature: "approve(address,uint256)" },
];

const NOW = 1_800_000_000;

function permissions(overrides: Partial<SessionPermissions> = {}): SessionPermissions {
  return {
    calls: [
      { to: POOL, signature: "repay(address,uint256)" },
      { to: TOKEN, signature: "approve(address,uint256)" },
    ],
    spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
    expiresAt: NOW + 30 * 86_400,
    ...overrides,
  };
}

describe("the permission list on the key", () => {
  it("accepts a list that names exactly what the agent needs", () => {
    expect(() => assertBoundedAllowlist(permissions(), REQUIRED)).not.toThrow();
  });

  it("refuses a key with no permission list at all", () => {
    // MONEY SAFETY RULE P6. In Altana a missing list means unlimited permission, and
    // deleting the `calls === undefined || calls === null` branch lets exactly that through.
    expect(() => assertBoundedAllowlist(permissions({ calls: undefined }), REQUIRED)).toThrow(
      SessionError,
    );
    expect(() => assertBoundedAllowlist(permissions({ calls: undefined }), REQUIRED)).toThrow(
      /unlimited/,
    );
  });

  it("refuses an EMPTY permission list, which is the trap", () => {
    // MONEY SAFETY RULE P6. An empty list reads like "nothing is allowed" and means the
    // opposite. Deleting the `calls.length === 0` branch is the single most expensive line
    // that could be removed from this repo.
    expect(() => assertBoundedAllowlist(permissions({ calls: [] }), REQUIRED)).toThrow(
      /empty list means unlimited/,
    );
  });

  it("refuses a line that names only a contract", () => {
    expect(() =>
      assertBoundedAllowlist(permissions({ calls: [{ to: POOL }] }), REQUIRED),
    ).toThrow(/only one half/);
  });

  it("refuses a line that names only a method, on any contract at all", () => {
    expect(() =>
      assertBoundedAllowlist(
        permissions({ calls: [{ signature: "approve(address,uint256)" }] }),
        REQUIRED,
      ),
    ).toThrow(/only one half/);
  });

  it("refuses a key that can do more than the job needs", () => {
    // A key that can do more is not harmlessly generous. It is the difference between a
    // break in that costs one payment and one that costs everything the key can reach.
    expect(() =>
      assertBoundedAllowlist(
        permissions({
          calls: [
            { to: POOL, signature: "repay(address,uint256)" },
            { to: TOKEN, signature: "approve(address,uint256)" },
            { to: TOKEN, signature: "transfer(address,uint256)" },
          ],
        }),
        REQUIRED,
      ),
    ).toThrow(/more than this agent needs/);
  });

  it("refuses a key missing something the job needs, before it fails halfway through", () => {
    expect(() =>
      assertBoundedAllowlist(
        permissions({ calls: [{ to: POOL, signature: "repay(address,uint256)" }] }),
        REQUIRED,
      ),
    ).toThrow(/missing/);
  });

  it("compares addresses without caring about capitals", () => {
    expect(() =>
      assertBoundedAllowlist(
        permissions({
          calls: [
            { to: POOL.toLowerCase() as `0x${string}`, signature: "repay(address,uint256)" },
            { to: TOKEN.toUpperCase().replace("0X", "0x") as `0x${string}`, signature: "approve(address,uint256)" },
          ],
        }),
        REQUIRED,
      ),
    ).not.toThrow();
  });

  it("refuses to check against an empty list of requirements", () => {
    // Otherwise every key passes, because there is nothing to compare it against.
    expect(() => assertBoundedAllowlist(permissions(), [])).toThrow(/nothing to allow/);
  });
});

describe("the spending limit on the key", () => {
  it("accepts a limit in the network's own coin", () => {
    expect(() => assertNativeSpendCap(permissions())).not.toThrow();
  });

  it("refuses a key with no limits at all", () => {
    expect(() => assertNativeSpendCap(permissions({ spend: [] }))).toThrow(/no spending limits/);
    expect(() => assertNativeSpendCap(permissions({ spend: undefined }))).toThrow(/no spending limits/);
  });

  it("refuses a key limited only in tokens", () => {
    // MONEY SAFETY RULE P7. The cost of sending comes out of the coin limit, so this key
    // would fail on the blockchain before doing anything, and the failure would look like a
    // mystery rather than a missing setting.
    expect(() =>
      assertNativeSpendCap(permissions({ spend: [{ limit: 100n, period: "day", token: TOKEN }] })),
    ).toThrow(/only in tokens/);
  });

  it("refuses a coin limit of nothing", () => {
    expect(() => assertNativeSpendCap(permissions({ spend: [{ limit: 0n, period: "day" }] }))).toThrow(
      /not a positive/,
    );
  });
});

describe("the key's end date", () => {
  it("accepts a key with plenty of time left", () => {
    expect(() => assertNotExpired(permissions(), NOW)).not.toThrow();
  });

  it("refuses a key that has already stopped working", () => {
    expect(() => assertNotExpired(permissions({ expiresAt: NOW - 1 }), NOW)).toThrow(
      /stopped working/,
    );
  });

  it("refuses a key at the exact second it stops working", () => {
    expect(() => assertNotExpired(permissions({ expiresAt: NOW }), NOW)).toThrow(/stopped working/);
  });

  it("refuses a key that stops working inside the safety margin", () => {
    // MONEY SAFETY RULE P5. A send is not instant. A key still valid when the decision is
    // made can be expired by the time the account contract checks it, and the send then
    // fails AFTER the budget was already charged. Deleting the margin check turns a clean
    // refusal into a charged failure.
    expect(() =>
      assertNotExpired(permissions({ expiresAt: NOW + EXPIRY_SAFETY_MARGIN_SECONDS }), NOW),
    ).toThrow(/inside the 60 second margin/);
    expect(() =>
      assertNotExpired(permissions({ expiresAt: NOW + EXPIRY_SAFETY_MARGIN_SECONDS - 1 }), NOW),
    ).toThrow(/margin/);
  });

  it("accepts a key one second outside the margin", () => {
    expect(() =>
      assertNotExpired(permissions({ expiresAt: NOW + EXPIRY_SAFETY_MARGIN_SECONDS + 1 }), NOW),
    ).not.toThrow();
  });

  it("refuses a key that never says when it stops working", () => {
    // Nobody stating an end date is not the same as there being no end date.
    expect(() => assertNotExpired(permissions({ expiresAt: undefined }), NOW)).toThrow(
      /does not say when it stops/,
    );
  });

  it("refuses an end date that is not a real point in time", () => {
    expect(() => assertNotExpired(permissions({ expiresAt: Number.NaN }), NOW)).toThrow(
      /not a real point in time/,
    );
    expect(() => assertNotExpired(permissions({ expiresAt: Number.POSITIVE_INFINITY }), NOW)).toThrow(
      /not a real point in time/,
    );
  });

  it("lets the caller widen the margin", () => {
    expect(() => assertNotExpired(permissions({ expiresAt: NOW + 3_600 }), NOW, 7_200)).toThrow(
      /margin/,
    );
  });
});

describe("all three checks together", () => {
  it("passes a key that is bounded, funded and still in date", () => {
    expect(() => assertSessionUsable(permissions(), REQUIRED, NOW)).not.toThrow();
  });

  it("marks every refusal as never sent, so no budget is ever charged for one", () => {
    const bad: SessionPermissions[] = [
      permissions({ calls: [] }),
      permissions({ spend: [] }),
      permissions({ expiresAt: NOW - 1 }),
    ];
    for (const p of bad) {
      try {
        assertSessionUsable(p, REQUIRED, NOW);
        expect.unreachable("must throw");
      } catch (err) {
        expect(err).toBeInstanceOf(SessionError);
        expect((err as SessionError).neverSent).toBe(true);
      }
    }
  });
});
