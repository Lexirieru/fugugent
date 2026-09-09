/**
 * The HTTP contract of `/api/agents`, `/api/agents/:id`, `/api/categories`.
 *
 * What is tested here is not "does Hono work" but the four promises this backend
 * makes to the frontend and to the judges:
 *
 * 1. Money never crosses as a `number`, and a `bigint` never slips through raw
 *    (JSON.stringify over an `AgentRecord` **throws** — that is locked down in
 *    the first test so the premise cannot quietly disappear).
 * 2. Every response carries `source` and `ageSeconds`.
 * 3. A malformed parameter is rejected with a clear reason, not a 500 and not a
 *    silent fallback to a default.
 * 4. A downed upstream never becomes a 5xx.
 */
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../types.js";
import { createApp } from "../app.js";
import { censusOf } from "../agents.js";
import {
  emptyPageFor,
  fakeService,
  makeDetail,
  makePage,
  makeRecord,
  makeHealth,
} from "./fixtures.js";

async function get(app: ReturnType<typeof createApp>, path: string): Promise<Response> {
  return app.request(`http://api.test${path}`);
}

/** `Response.json()` is typed `unknown` in Node's typings; JSON bodies in tests really are dynamic. */
// eslint-disable-next-line -eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe("the serialization premise", () => {
  it("a raw `AgentRecord` really is not JSON-serializable", () => {
    expect(() => JSON.stringify(makeRecord())).toThrow(TypeError);
  });
});

describe("GET /api/agents", () => {
  it("sends money as a base-8 decimal string, never as a number", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    const listing = body.items[0].fuguListing;
    expect(listing.priceUsd8PerPeriod).toBe("12345678");
    expect(typeof listing.priceUsd8PerPeriod).toBe("string");
    expect(listing.listingId).toBe("1");
    expect(listing.erc8004AgentId).toBe("41");
  });

  it("the whole body is safe for JSON.parse, including the new provenance fields", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({
            items: [makeRecord({ source: "onchain" })],
            itemSources: { onchain: 1 },
            firstParty: { count: 1, healthy: true, reason: null, ageSeconds: 3 },
          }),
      }),
    });
    const raw = await (await get(app, "/api/agents?category=GRID")).text();

    // The premise is locked by the first test: a raw `AgentRecord` throws. If a
    // new field smuggled in a `bigint`, this response could never be built.
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toContain("undefined");
  });

  it("carries source and ageSeconds so the UI can state the age of its data", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({ source: "cache", ageSeconds: 942, stale: true, degraded: true }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.source).toBe("cache");
    expect(body.ageSeconds).toBe(942);
    expect(body.stale).toBe(true);
    expect(body.degraded).toBe(true);
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("forwards limit and offset verbatim to the service", async () => {
    const service = fakeService();
    const app = createApp({ service });
    await get(app, "/api/agents?category=YIELD&limit=7&offset=14");

    expect(service.listCalls).toHaveLength(1);
    expect(service.listCalls[0].category).toBe("YIELD");
    expect(service.listCalls[0].opts).toMatchObject({ limit: 7, offset: 14 });
  });

  it("with no category, it merges all four categories", async () => {
    const service = fakeService({
      list: async (category) =>
        makePage({
          items: [makeRecord({ id: `97:${category}`, tokenId: category })],
        }),
    });
    const app = createApp({ service });
    const body = await json(await get(app, "/api/agents"));

    expect(service.listCalls.map((c) => c.category).sort()).toEqual([...CATEGORIES].sort());
    expect(body.items).toHaveLength(4);
    expect(body.category).toBeNull();
  });

  /**
   * Finding I4. Each category is read to at most `MAX_PAGE_LIMIT` items, so the
   * merged window has a hard bound. Reporting the sum of the four `total`s
   * (thousands) would promise pages that never existed: the client builds its
   * pagination from that number and then receives an empty `healthy: true` page.
   * Fails if `total` is turned back into a sum.
   */
  it("the merged total is the reachable unique items, not the sum of the four totals", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) =>
          makePage({
            items: [
              makeRecord({ id: `97:${category}-a`, tokenId: `${category}-a` }),
              makeRecord({ id: `97:${category}-b`, tokenId: `${category}-b` }),
            ],
            total: 1000,
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?limit=100"));

    expect(body.items).toHaveLength(8);
    expect(body.total).toBe(8);
  });

  it("an item appearing in two categories is counted only once", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => makePage({ items: [makeRecord({ id: "97:kembar" })], total: 50 }),
      }),
    });
    const body = await json(await get(app, "/api/agents"));

    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("a legitimately empty page is still 200 and still healthy", async () => {
    const app = createApp({ service: fakeService({ list: async () => emptyPageFor("seed") }) });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items).toEqual([]);
    expect(body.healthy).toBe(true);
    expect(body.ageSeconds).toBeNull();
  });
});

/**
 * First-party provenance on the wire.
 *
 * `FuguRegistry` listings are no longer a fallback tier: they are an overlay
 * read on every request and merged on top of discovery, so one page can hold
 * items from more than one source. `source` alone therefore no longer describes
 * a page, and without `itemSources` / `firstParty` a client has no way to tell
 * that a page is mixed — the quiet over-claim this backend exists to avoid.
 * Every test below fails if either field stops being forwarded.
 */
describe("GET /api/agents — mixed provenance", () => {
  const overlay = {
    count: 1,
    healthy: true,
    reason: null,
    ageSeconds: 12,
  };

  it("forwards itemSources and firstParty verbatim", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({
            items: [
              makeRecord({ id: "97:1", tokenId: "1", source: "scan8004" }),
              makeRecord({ id: "97:2", tokenId: "2", source: "onchain" }),
            ],
            source: "scan8004",
            itemSources: { scan8004: 1, onchain: 1 },
            firstParty: overlay,
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.itemSources).toEqual({ scan8004: 1, onchain: 1 });
    expect(body.firstParty).toEqual(overlay);
    // The page label still names the discovery tier, not the origin of every item.
    expect(body.source).toBe("scan8004");
  });

  it("the route's census agrees with the service's census", async () => {
    const items = [
      makeRecord({ id: "97:1", tokenId: "1", source: "scan8004" }),
      makeRecord({ id: "97:2", tokenId: "2", source: "onchain" }),
      makeRecord({ id: "97:3", tokenId: "3", source: "onchain" }),
    ];
    const app = createApp({
      service: fakeService({
        list: async () => makePage({ items, itemSources: censusOf(items) }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.itemSources).toEqual({ scan8004: 1, onchain: 2 });
  });

  it("itemSources is still populated even when the service does not send it", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({
            items: [
              makeRecord({ id: "97:1", tokenId: "1", source: "cache" }),
              makeRecord({ id: "97:2", tokenId: "2", source: "cache" }),
            ],
            // Deliberately `undefined` — a client must never be left guessing.
            itemSources: undefined,
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.itemSources).toEqual({ cache: 2 });
  });

  it("a null firstParty only means the overlay is not installed", async () => {
    const app = createApp({
      service: fakeService({ list: async () => makePage({ firstParty: undefined }) }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.firstParty).toBeNull();
    // Not omitted from the body: a missing key would read as an older backend
    // version rather than as "overlay not installed".
    expect("firstParty" in body).toBe(true);
  });

  it("a broken overlay is forwarded with its reason, not rounded off to null", async () => {
    const broken = {
      count: 0,
      healthy: false,
      reason: "FuguRegistry unreadable: RPC timeout",
      ageSeconds: null,
    };
    const app = createApp({
      service: fakeService({ list: async () => makePage({ firstParty: broken }) }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.firstParty).toEqual(broken);
  });

  it("the merged path censuses the slice actually served", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) =>
          makePage({
            items: [
              makeRecord({ id: `97:${category}-a`, tokenId: `${category}-a`, source: "scan8004" }),
              makeRecord({ id: `97:${category}-b`, tokenId: `${category}-b`, source: "onchain" }),
            ],
            itemSources: { scan8004: 1, onchain: 1 },
            firstParty: { count: 1, healthy: true, reason: null, ageSeconds: 30 },
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?limit=3"));

    // 8 unique items read, 3 served — the census must add up to 3, not 8.
    expect(body.items).toHaveLength(3);
    const counted = Object.values(body.itemSources as Record<string, number>).reduce(
      (sum, n) => sum + n,
      0,
    );
    expect(counted).toBe(3);
  });

  it("the merged path folds the overlay pessimistically", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) =>
          makePage({
            items: [],
            firstParty:
              category === "YIELD"
                ? { count: 0, healthy: false, reason: "RPC timeout", ageSeconds: null }
                : { count: 1, healthy: true, reason: null, ageSeconds: 5 },
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents"));

    expect(body.firstParty.healthy).toBe(false);
    expect(body.firstParty.reason).toContain("RPC timeout");
  });

  /**
   * All four category reads share one held registry read, and each report counts
   * listings with unreadable metadata across the WHOLE of it — not just within
   * its own category. Measured in a live container: one unreadable listing was
   * reported as `1` by each of the four categories, so summing showed 4. Hence
   * the fold is `max`.
   */
  it("the merged path folds unreadableMetadata with max, not by summing", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) =>
          makePage({
            items: [],
            firstParty: {
              count: 1,
              healthy: true,
              reason: "1 listing(s) with unreadable metadata",
              ageSeconds: 5,
              unreadableMetadata: category === "GRID" ? 2 : 1,
            },
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents"));

    // max(2, 1, 1, 1) — not 5. Summing would report five broken listings when
    // only two exist.
    expect(body.firstParty.unreadableMetadata).toBe(2);
  });

  it("the merged path does not invent unreadableMetadata when none was reported", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({
            items: [],
            firstParty: { count: 0, healthy: true, reason: null, ageSeconds: 1 },
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents"));

    expect("unreadableMetadata" in body.firstParty).toBe(false);
  });

  it("the merged path reports null when no category has an overlay", async () => {
    const app = createApp({
      service: fakeService({ list: async () => makePage({ items: [], firstParty: undefined }) }),
    });
    const body = await json(await get(app, "/api/agents"));

    expect(body.firstParty).toBeNull();
  });
});

/**
 * `onchainExecution` — the only field that separates an agent which has actually
 * executed on chain from three that have a decision engine and a backtest.
 *
 * Getting this wrong is not cosmetic. Four cards that look equivalent, $0.05
 * paid, and then an agent that cannot act is exactly the surprise this product
 * argues it does not inflict. So the wire must carry three states and must never
 * let the third one be mistaken for `false`.
 */
describe("onchainExecution — three states, and the third is not false", () => {
  function pageWith(record: ReturnType<typeof makeRecord>) {
    return createApp({
      service: fakeService({ list: async () => makePage({ items: [record] }) }),
    });
  }

  it("forwards true for an agent that has acted on chain", async () => {
    const app = pageWith(makeRecord({ name: "Fugu Guardian", onchainExecution: true }));
    const body = await json(await get(app, "/api/agents?category=HEALTH_FACTOR"));

    expect(body.items[0].onchainExecution).toBe(true);
  });

  it("forwards false — an explicit denial, never dropped", async () => {
    const app = pageWith(makeRecord({ name: "Fugu Grid", onchainExecution: false }));
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.items[0].onchainExecution).toBe(false);
    // Not absent: a missing key is what a client would coerce to false, which
    // would make an unknown look like a declared "does not act on chain".
    expect("onchainExecution" in body.items[0]).toBe(true);
  });

  it("reports unknown as null, not as false, when metadata was unreadable", async () => {
    // The service promotes `onchainExecution` only when the metadata declared it,
    // so an unreadable document leaves the property `undefined` — which vanishes
    // from JSON entirely unless it is normalised here.
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({
            items: [makeRecord({ name: "Agent #8006" })],
            firstParty: {
              count: 1,
              healthy: true,
              reason: "1 listing(s) with unreadable metadata",
              ageSeconds: 4,
              unreadableMetadata: 1,
            },
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.items[0].onchainExecution).toBeNull();
    expect(body.items[0].onchainExecution).not.toBe(false);
    expect("onchainExecution" in body.items[0]).toBe(true);
    // And the count of unreadable documents is right there to explain why.
    expect(body.firstParty.unreadableMetadata).toBe(1);
  });

  /**
   * The merged path builds its own slice, so it needs its own proof — including
   * the unknown state, which is the only one that can silently disappear.
   */
  it("survives the merged path too, unknown included", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) =>
          makePage({
            items: [
              makeRecord({
                id: `97:${category}`,
                tokenId: category,
                // YIELD stands in for a listing whose metadata could not be read.
                ...(category === "YIELD"
                  ? {}
                  : { onchainExecution: category === "HEALTH_FACTOR" }),
              }),
            ],
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents?limit=10"));

    const states = Object.fromEntries(
      body.items.map((i: { tokenId: string; onchainExecution: boolean | null }) => [
        i.tokenId,
        i.onchainExecution,
      ]),
    );
    expect(states).toEqual({
      REBALANCING: false,
      GRID: false,
      YIELD: null,
      HEALTH_FACTOR: true,
    });
    // Every item states it, none leaves it to be inferred.
    for (const item of body.items) expect("onchainExecution" in item).toBe(true);
    for (const item of body.items) expect("listingMetadata" in item).toBe(true);
  });

  it("forwards listingMetadata, and null when there is none", async () => {
    const metadata = {
      name: "Fugu Guardian",
      description: "repays debt before liquidation",
      onchainExecution: true,
      limits: "testnet only",
      verify: "cast call ...",
      declaredAgentWallet: null,
      agentWalletMatchesListing: null,
    };
    const withMeta = pageWith(
      makeRecord({ onchainExecution: true, listingMetadata: metadata }),
    );
    const withoutMeta = pageWith(makeRecord({}));

    expect((await json(await get(withMeta, "/api/agents?category=GRID"))).items[0].listingMetadata)
      .toEqual(metadata);
    expect(
      (await json(await get(withoutMeta, "/api/agents?category=GRID"))).items[0].listingMetadata,
    ).toBeNull();
  });

  it("money is still serialised through the one conversion point", async () => {
    const app = pageWith(makeRecord({ onchainExecution: true }));
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.items[0].fuguListing.priceUsd8PerPeriod).toBe("12345678");
    // It is NOT copied into the on-chain struct: `fuguListing` mirrors what the
    // chain asserts, and this claim comes from the metadata document instead.
    expect("onchainExecution" in body.items[0].fuguListing).toBe(false);
  });
});

describe("GET /api/agents — a malformed parameter", () => {
  const app = createApp({ service: fakeService() });

  it.each([
    ["limit=abc", "limit"],
    ["limit=0", "limit"],
    ["limit=-3", "limit"],
    ["limit=1.5", "limit"],
    ["limit=1e3", "limit"],
    ["limit=101", "limit"],
    ["offset=-1", "offset"],
    ["offset=abc", "offset"],
    ["offset=10001", "offset"],
    ["offset=9007199254740991", "offset"],
    ["category=NOTACATEGORY", "category"],
    ["category=grid", "category"],
  ])("rejects %s with a 400 that names the field", async (query, field) => {
    const res = await get(app, `/api/agents?${query}`);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("invalid_query");
    expect(body.field).toBe(field);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("names the valid categories when a category is rejected", async () => {
    const body = await json(await get(app, "/api/agents?category=NOPE"));
    expect(body.allowed).toEqual([...CATEGORIES]);
  });

  it("an empty parameter means unset, not malformed", async () => {
    const service = fakeService();
    const local = createApp({ service });
    const res = await get(local, "/api/agents?category=&limit=&offset=");
    expect(res.status).toBe(200);
    expect(service.listCalls).toHaveLength(CATEGORIES.length);
  });

  it("does not call the service at all when a parameter is malformed", async () => {
    const service = fakeService();
    const local = createApp({ service });
    await get(local, "/api/agents?limit=abc");
    expect(service.listCalls).toHaveLength(0);
  });
});

describe("GET /api/agents — upstream down", () => {
  it("a throwing service still produces a 200 with an honest envelope", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => {
          throw new Error("Postgres down");
        },
      }),
    });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items).toEqual([]);
    expect(body.healthy).toBe(false);
    expect(body.reason).toContain("Postgres down");
    expect(body.source).toBe("seed");
  });

  it("never leaks the API key into reason", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => {
          throw new Error("GET https://api.8004scan.io/v1/agents?api_key=sk-SECRET-123 failed");
        },
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(JSON.stringify(body)).not.toContain("sk-SECRET-123");
    expect(body.reason).toContain("[redacted]");
  });
});

describe("GET /api/agents/:id", () => {
  it("returns a serialized agent with source and ageSeconds", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent.id).toBe("97:41");
    expect(body.agent.fuguListing.priceUsd8PerPeriod).toBe("12345678");
    expect(body.source).toBe("scan8004");
    expect(body.ageSeconds).toBe(60);
  });

  it.each([
    ["true", true, true],
    ["false", false, false],
    ["unknown", undefined, null],
  ] as const)("the detail path forwards onchainExecution %s", async (_label, promoted, expected) => {
    const app = createApp({
      service: fakeService({
        detail: async () =>
          makeDetail({
            agent: makeRecord(
              promoted === undefined ? {} : { onchainExecution: promoted },
            ),
          }),
      }),
    });
    const body = await json(await get(app, "/api/agents/97:41"));

    expect(body.agent.onchainExecution).toBe(expected);
    expect("onchainExecution" in body.agent).toBe(true);
  });

  it("forwards firstParty on the detail path", async () => {
    const overlay = { count: 1, healthy: true, reason: null, ageSeconds: 8 };
    const app = createApp({
      service: fakeService({ detail: async () => makeDetail({ firstParty: overlay }) }),
    });
    const body = await json(await get(app, "/api/agents/97:41"));

    expect(body.firstParty).toEqual(overlay);
    // Overlay money stays a decimal string: the new fields smuggle in no bigint.
    expect(body.agent.fuguListing.priceUsd8PerPeriod).toBe("12345678");
  });

  it("a null firstParty on the detail path means the overlay is not installed", async () => {
    const app = createApp({
      service: fakeService({ detail: async () => makeDetail({ firstParty: undefined }) }),
    });
    const body = await json(await get(app, "/api/agents/97:41"));

    expect(body.firstParty).toBeNull();
    expect("firstParty" in body).toBe(true);
  });

  it("forwards a percent-encoded id verbatim", async () => {
    const service = fakeService();
    const app = createApp({ service });
    await get(app, "/api/agents/97%3Aseed-fugugrid");
    expect(service.detailCalls).toEqual(["97:seed-fugugrid"]);
  });

  it("404 when EVERY level answered and still did not find it", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () =>
          makeDetail({
            agent: null,
            source: "seed",
            healthy: true,
            reason: "agent 97:99 is not in the curated seed",
            ageSeconds: null,
            degraded: true,
            // All four levels were genuinely asked; all of them answered
            // "not there". Only then may "does not exist" be said.
            trail: [
              { source: "scan8004", outcome: "empty", reason: null, items: 0 },
              { source: "cache", outcome: "empty", reason: null, items: 0 },
              { source: "onchain", outcome: "empty", reason: null, items: 0 },
              { source: "seed", outcome: "empty", reason: null, items: 0 },
            ],
          }),
      }),
    });
    const res = await get(app, "/api/agents/97:99");

    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.source).toBe("seed");
    expect(body.reason).toContain("not in");
  });

  /**
   * The heart of finding C1. Level 4 in `service/agents.ts` hardcodes
   * `healthy: true` and `service/seed.ts` always answers `agent: null` for an id
   * that is not a curated agent — so the envelope below is exactly what the
   * production wiring produces when 8004scan is down, `DATABASE_URL` is empty,
   * and the on-chain read does not hold that agent. Answering 404 there means the
   * marketplace erases a real agent right as its primary source goes down.
   *
   * All three cases below fail if the `!isUncertain(trail)` condition is removed.
   */
  it.each([
    ["threw", "8004scan down"],
    ["unhealthy", "8004scan answered 500 DATABASE_ERROR"],
    ["unavailable", "cache not installed"],
  ] as const)(
    "200 — not 404 — when some level has outcome %s, even with healthy: true",
    async (outcome, reason) => {
      const app = createApp({
        service: fakeService({
          detail: async () =>
            makeDetail({
              agent: null,
              source: "seed",
              // Exactly what the service reports today: the seed is always healthy.
              healthy: true,
              reason: "agent 97:41 is not in the curated seed",
              ageSeconds: null,
              degraded: true,
              trail: [
                { source: "scan8004", outcome, reason, items: 0 },
                { source: "seed", outcome: "empty", reason: null, items: 0 },
              ],
            }),
        }),
      });
      const res = await get(app, "/api/agents/97:41");

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.agent).toBeNull();
      // The trail travels along, so a client can tell the difference itself if it wants.
      expect(body.trail.some((a: { outcome: string }) => a.outcome === outcome)).toBe(true);
    },
  );

  it("200 — not 404 — when the service itself reports unhealthy", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () =>
          makeDetail({
            agent: null,
            healthy: false,
            reason: "all four levels failed",
            trail: [{ source: "seed", outcome: "empty", reason: null, items: 0 }],
          }),
      }),
    });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.healthy).toBe(false);
  });

  it("a throwing service does not become a 5xx", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () => {
          throw new Error("RPC timeout");
        },
      }),
    });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.healthy).toBe(false);
    expect(body.reason).toContain("RPC timeout");
  });

  it("an empty id does not take the service down", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents/%20");
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("id");
  });
});

describe("GET /api/categories", () => {
  it("reports counts for all four categories", async () => {
    const counts: Record<string, number> = {
      REBALANCING: 3,
      GRID: 5,
      YIELD: 0,
      HEALTH_FACTOR: 2,
    };
    const app = createApp({
      service: fakeService({
        list: async (category) => makePage({ items: [], total: counts[category] }),
      }),
    });
    const res = await get(app, "/api/categories");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.categories).toEqual([
      expect.objectContaining({ category: "REBALANCING", count: 3 }),
      expect.objectContaining({ category: "GRID", count: 5 }),
      expect.objectContaining({ category: "YIELD", count: 0 }),
      expect.objectContaining({ category: "HEALTH_FACTOR", count: 2 }),
    ]);
    expect(body.total).toBe(10);
  });

  it("each row carries its own source and ageSeconds", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => makePage({ source: "seed", ageSeconds: 86_400, degraded: true }),
      }),
    });
    const body = await json(await get(app, "/api/categories"));

    expect(body.categories[0].source).toBe("seed");
    expect(body.categories[0].ageSeconds).toBe(86_400);
    expect(body.degraded).toBe(true);
  });

  it("one failing category does not erase the other three", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) => {
          if (category === "YIELD") throw new Error("upstream down");
          return makePage({ items: [], total: 1 });
        },
      }),
    });
    const res = await get(app, "/api/categories");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.categories).toHaveLength(4);
    expect(body.categories.find((c: { category: string }) => c.category === "YIELD")).toMatchObject(
      { count: 0, healthy: false },
    );
    expect(body.healthy).toBe(false);
    expect(body.total).toBe(3);
  });
});

describe("an unknown route", () => {
  it("the 404 is JSON-shaped, not HTML", async () => {
    const app = createApp({ service: fakeService({ health: async () => makeHealth() }) });
    const res = await get(app, "/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await json(res)).error).toBe("not_found");
  });
});
