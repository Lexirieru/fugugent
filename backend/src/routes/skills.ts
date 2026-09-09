/**
 * The audited-skill marketplace routes.
 *
 * ```
 * POST /api/skills          register a skill
 * GET  /api/skills          list skills with their audit status
 * GET  /api/skills/:id      one skill plus its full audit history
 * GET  /api/auditors        auditors and their reputation
 * ```
 *
 * This layer holds no data logic; the tiered fallback and the trust derivation
 * live in `src/skills/service.ts`. What happens here are the same three promises
 * `src/routes/agents.ts` makes:
 *
 * 1. **Serialization through one door.** Prices, fees and bonds are `bigint`s,
 *    so `JSON.stringify` over a record **throws**. Conversion is always
 *    `src/skills/serialize.ts`; money crosses as a base-8 decimal string
 *    (`"12345678"` = $0.12), never as a `number`.
 * 2. **Provenance travels in every response** — `source`, `ageSeconds`,
 *    `stale`, `degraded`, `itemSources`, `trail`, and for this feature also
 *    `trustCensus` and `notice`.
 * 3. **Never a 5xx because a source is sick.** A read answers with an honest
 *    empty plus a reason. The one non-2xx from our own side is `POST /api/skills`
 *    failing to persist — which is reported as a 503 with a complete envelope,
 *    because a client that is told "created" when nothing was stored is worse
 *    off than one told the truth.
 *
 * ## The distinction this file exists to protect
 *
 * `trust.status` is one of seven values and only one of them — `PASSED` — sets
 * `trust.verified: true`. The other six are surfaced verbatim. A client that
 * renders `verified` as a badge and everything else as "not verified yet" is
 * correct by construction; a client that renders `!FAILED` as safe is wrong, and
 * `trust.unknown` is there so it does not have to guess.
 */

import { Hono, type Context } from "hono";
import {
  serializeAudit,
  serializeAuditor,
  serializeSkillWithTrust,
  type AuditRecordJson,
  type AuditorRecordJson,
  type SkillWithTrustJson,
} from "../skills/serialize.js";
import {
  ALL_AUDIT_STATUSES,
  SKILL_MAX_AGE_SECONDS,
  skillTrailIsUncertain,
  type AuditorServiceList,
  type SkillFallbackAttempt,
  type SkillService,
  type SkillServiceDetail,
  type SkillServicePage,
  type TrustCensus,
} from "../skills/service.js";
import { SKILL_ID_PATTERN } from "../skills/normalize.js";
import { MAX_SKILL_LIMIT, DEFAULT_SKILL_LIMIT } from "../skills/store.js";
import { AUDIT_STATUSES, SKILL_KINDS, type SkillKind, type SkillSource } from "../skills/types.js";
import { redact } from "../service/agents.js";
import { QueryError } from "./query.js";

export interface SkillRoutesDeps {
  service: SkillService;
  /** Injected so failure-envelope timestamps are deterministic in tests. */
  now?: () => Date;
}

/** The largest submission body accepted, in bytes. */
export const MAX_SUBMISSION_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Wire shapes — what the frontend builds against
// ---------------------------------------------------------------------------

export interface SkillListResponse {
  items: SkillWithTrustJson[];
  total: number;
  limit: number;
  offset: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  itemSources: Partial<Record<SkillSource, number>>;
  /** How many items on this page hold each audit status. Derived from `items`. */
  trustCensus: TrustCensus;
  /**
   * The complete status vocabulary, sent on every list response.
   *
   * A client must not hard-code seven strings and then silently mis-render an
   * eighth added later; sending the list makes the enumeration discoverable.
   */
  statuses: readonly string[];
  /** Set when this response contains curated examples. `null` otherwise. */
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

export interface SkillDetailResponse {
  skill: SkillWithTrustJson | null;
  /** Newest first. Every audit ever recorded for this skill, in any state. */
  audits: AuditRecordJson[];
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

export interface AuditorListResponse {
  items: AuditorRecordJson[];
  total: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  reputationSources: Partial<Record<"onchain" | "unavailable" | "unhealthy", number>>;
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

export interface RegisterSkillResponse {
  ok: boolean;
  stored: boolean;
  durable: boolean;
  skill: SkillWithTrustJson | null;
  reason: string | null;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Query parsing — malformed is rejected, never defaulted
// ---------------------------------------------------------------------------

const UNSIGNED_INTEGER = /^\d+$/;

function blank(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === "";
}

export function parseSkillLimit(raw: string | undefined): number {
  if (blank(raw)) return DEFAULT_SKILL_LIMIT;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError(
      "limit",
      `limit must be an integer between 1 and ${MAX_SKILL_LIMIT}, not ${JSON.stringify(value)}`,
    );
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > MAX_SKILL_LIMIT) {
    throw new QueryError("limit", `limit must be between 1 and ${MAX_SKILL_LIMIT}, not ${parsed}`);
  }
  return parsed;
}

export const MAX_SKILL_OFFSET = 10_000;

export function parseSkillOffset(raw: string | undefined): number {
  if (blank(raw)) return 0;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError("offset", `offset must be an integer >= 0, not ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_SKILL_OFFSET) {
    throw new QueryError("offset", `offset must be <= ${MAX_SKILL_OFFSET}, not ${value}`);
  }
  return parsed;
}

/** `kind` — exactly one of the three, with exactly that spelling. */
export function parseSkillKind(raw: string | undefined): SkillKind | undefined {
  if (blank(raw)) return undefined;
  const value = raw as string;
  if (!(SKILL_KINDS as readonly string[]).includes(value)) {
    throw new QueryError("kind", `unknown kind: ${JSON.stringify(value)}`, SKILL_KINDS);
  }
  return value as SkillKind;
}

/**
 * `status` — filter by audit status.
 *
 * Applied **after** derivation, over the items this response actually holds:
 * the status is not a stored column, so it cannot be pushed into the query, and
 * pretending otherwise would silently return a page whose `total` did not match
 * its contents. The response therefore reports `total` for the filtered set it
 * really has.
 */
export function parseAuditStatus(raw: string | undefined): string | undefined {
  if (blank(raw)) return undefined;
  const value = raw as string;
  if (!(AUDIT_STATUSES as readonly string[]).includes(value)) {
    throw new QueryError("status", `unknown status: ${JSON.stringify(value)}`, AUDIT_STATUSES);
  }
  return value;
}

/** `includeExamples` — `0`/`false` hides the curated examples. */
export function parseIncludeExamples(raw: string | undefined): boolean | undefined {
  if (blank(raw)) return undefined;
  const value = (raw as string).trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new QueryError(
    "includeExamples",
    `includeExamples only accepts 1/true/0/false, not ${JSON.stringify(raw)}`,
  );
}

export function parseSkillPathId(raw: string | undefined): string {
  if (blank(raw)) throw new QueryError("id", "skill id must not be empty");
  const value = (raw as string).trim().toLowerCase();
  if (!SKILL_ID_PATTERN.test(value)) {
    throw new QueryError(
      "id",
      `skill id must be lowercase letters, digits and hyphens, not ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

function describe(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return redact(`${err.name}: ${firstLine}`);
  }
  return redact(`unknown failure: ${String(err)}`);
}

function toListResponse(page: SkillServicePage): SkillListResponse {
  return {
    items: page.items.map(serializeSkillWithTrust),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    source: page.source,
    healthy: page.healthy,
    reason: page.reason === null ? null : redact(page.reason),
    fetchedAt: page.fetchedAt,
    ageSeconds: page.ageSeconds,
    stale: page.stale,
    degraded: page.degraded,
    maxAgeSeconds: page.maxAgeSeconds,
    itemSources: page.itemSources,
    trustCensus: page.trustCensus,
    statuses: ALL_AUDIT_STATUSES,
    notice: page.notice,
    trail: page.trail,
  };
}

function toDetailResponse(detail: SkillServiceDetail): SkillDetailResponse {
  return {
    skill: detail.skill === null ? null : serializeSkillWithTrust(detail.skill),
    audits: detail.audits.map(serializeAudit),
    source: detail.source,
    healthy: detail.healthy,
    reason: detail.reason === null ? null : redact(detail.reason),
    fetchedAt: detail.fetchedAt,
    ageSeconds: detail.ageSeconds,
    stale: detail.stale,
    degraded: detail.degraded,
    maxAgeSeconds: detail.maxAgeSeconds,
    notice: detail.notice,
    trail: detail.trail,
  };
}

function toAuditorResponse(
  list: AuditorServiceList,
  window?: { limit: number; offset: number },
): AuditorListResponse {
  const items =
    window === undefined
      ? list.items
      : list.items.slice(window.offset, window.offset + window.limit);
  return {
    items: items.map(serializeAuditor),
    total: list.total,
    source: list.source,
    healthy: list.healthy,
    reason: list.reason === null ? null : redact(list.reason),
    fetchedAt: list.fetchedAt,
    ageSeconds: list.ageSeconds,
    stale: list.stale,
    degraded: list.degraded,
    maxAgeSeconds: list.maxAgeSeconds,
    reputationSources: list.reputationSources,
    notice: list.notice,
    trail: list.trail,
  };
}

/** A 400 that names the field, the message, and (for an enum) the valid values. */
function queryErrorResponse(c: Context, err: unknown) {
  if (err instanceof QueryError) {
    return c.json(
      {
        error: "invalid_query",
        field: err.field,
        message: err.message,
        ...(err.allowed ? { allowed: [...err.allowed] } : {}),
      },
      400,
    );
  }
  return c.json({ error: "invalid_query", field: "unknown", message: describe(err) }, 400);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createSkillRoutes(deps: SkillRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get("/skills", async (c) => {
    let limit: number;
    let offset: number;
    let kind: SkillKind | undefined;
    let status: string | undefined;
    let includeExamples: boolean | undefined;
    try {
      limit = parseSkillLimit(c.req.query("limit"));
      offset = parseSkillOffset(c.req.query("offset"));
      kind = parseSkillKind(c.req.query("kind"));
      status = parseAuditStatus(c.req.query("status"));
      includeExamples = parseIncludeExamples(c.req.query("includeExamples"));
    } catch (err) {
      return queryErrorResponse(c, err);
    }

    const search = c.req.query("q");
    const fetchedAt = now().toISOString();
    try {
      const page = await deps.service.listSkills({
        limit,
        offset,
        kind,
        includeExamples,
        ...(search === undefined || search.trim() === "" ? {} : { search }),
      });

      if (status === undefined) return c.json(toListResponse(page));

      // Filtering by a derived value happens here, and the totals are corrected
      // to describe what is actually returned rather than the unfiltered page.
      const filtered = page.items.filter((item) => item.trust.status === status);
      return c.json(
        toListResponse({
          ...page,
          items: filtered,
          total: filtered.length,
          itemSources: filtered.reduce<Partial<Record<SkillSource, number>>>((acc, item) => {
            acc[item.source] = (acc[item.source] ?? 0) + 1;
            return acc;
          }, {}),
          trustCensus: filtered.length === 0 ? {} : { [status as never]: filtered.length },
          notice: filtered.some((item) => item.example) ? page.notice : null,
        }),
      );
    } catch (err) {
      // The service promises not to throw; this is our own net regardless.
      return c.json({
        items: [],
        total: 0,
        limit,
        offset,
        source: "seed" as SkillSource,
        healthy: false,
        reason: describe(err),
        fetchedAt,
        ageSeconds: null,
        stale: true,
        degraded: true,
        maxAgeSeconds: SKILL_MAX_AGE_SECONDS,
        itemSources: {},
        trustCensus: {},
        statuses: ALL_AUDIT_STATUSES,
        notice: null,
        trail: [],
      } satisfies SkillListResponse);
    }
  });

  app.get("/skills/:id", async (c) => {
    let id: string;
    try {
      id = parseSkillPathId(c.req.param("id"));
    } catch (err) {
      return queryErrorResponse(c, err);
    }

    const fetchedAt = now().toISOString();
    let detail: SkillDetailResponse;
    try {
      detail = toDetailResponse(await deps.service.getSkill(id));
    } catch (err) {
      // We do not know whether this skill exists — a 200 with `healthy: false`,
      // not a 404 claiming it does not.
      return c.json({
        skill: null,
        audits: [],
        source: "seed" as SkillSource,
        healthy: false,
        reason: describe(err),
        fetchedAt,
        ageSeconds: null,
        stale: true,
        degraded: true,
        maxAgeSeconds: SKILL_MAX_AGE_SECONDS,
        notice: null,
        trail: [],
      } satisfies SkillDetailResponse);
    }

    // A 404 only when we genuinely know the answer. `healthy` alone is not
    // enough: the seed reports `healthy: true` for any id that is not one of
    // the curated examples, without knowing what happened at level 1. So the
    // trail decides — a level that threw, was unhealthy, or was not installed
    // means there is a place we never got to ask, and "don't know" is not
    // "doesn't exist". This is the same rule `/api/agents/:id` follows, and it
    // matters more here: a skill that silently 404s while its registry is down
    // is a skill an agent may go and install from an unvetted source instead.
    if (detail.skill === null && detail.healthy && !skillTrailIsUncertain(detail.trail)) {
      return c.json(detail, 404);
    }
    return c.json(detail);
  });

  app.get("/auditors", async (c) => {
    let limit: number;
    let offset: number;
    try {
      limit = parseSkillLimit(c.req.query("limit"));
      offset = parseSkillOffset(c.req.query("offset"));
    } catch (err) {
      return queryErrorResponse(c, err);
    }

    const fetchedAt = now().toISOString();
    try {
      // The window is cut here, not in the store.
      //
      // `listAuditors` returns the whole roster, and it is small: the auditors are
      // whoever holds a bond, which is a handful. Slicing at the route gives a client
      // a real, shareable page without pretending the datastore is doing work it is
      // not. `total` stays the true count rather than the size of this slice, because
      // that is the number a pager needs to know when to stop.
      //
      // If the roster ever grows past a page or two, this becomes the wrong place and
      // the query belongs in the store. It is one function either way.
      const list = await deps.service.listAuditors();
      return c.json(toAuditorResponse(list, { limit, offset }));
    } catch (err) {
      return c.json({
        items: [],
        total: 0,
        source: "seed" as SkillSource,
        healthy: false,
        reason: describe(err),
        fetchedAt,
        ageSeconds: null,
        stale: true,
        degraded: true,
        maxAgeSeconds: SKILL_MAX_AGE_SECONDS,
        reputationSources: {},
        notice: null,
        trail: [],
      } satisfies AuditorListResponse);
    }
  });

  app.post("/skills", async (c) => {
    const fetchedAt = now().toISOString();

    let body: unknown;
    try {
      const raw = await c.req.text();
      if (raw.length > MAX_SUBMISSION_BYTES) {
        return c.json(
          {
            error: "invalid_body",
            field: "body",
            message: `submission exceeds ${MAX_SUBMISSION_BYTES} bytes`,
          },
          413,
        );
      }
      body = raw.trim() === "" ? null : JSON.parse(raw);
    } catch (err) {
      // A body that is not JSON is the client's error, and it is answered as
      // one — it must not reach the last-resort net and be counted as a 5xx.
      return c.json(
        { error: "invalid_body", field: "body", message: `body is not valid JSON: ${describe(err)}` },
        400,
      );
    }

    let result: Awaited<ReturnType<SkillService["registerSkill"]>>;
    try {
      result = await deps.service.registerSkill(body);
    } catch (err) {
      return c.json(
        {
          ok: false,
          stored: false,
          durable: false,
          skill: null,
          reason: describe(err),
          fetchedAt,
        } satisfies RegisterSkillResponse,
        503,
      );
    }

    if (result.invalid !== null) {
      return c.json(
        {
          error: "invalid_body",
          field: result.invalid.field,
          message: result.invalid.message,
        },
        400,
      );
    }

    const envelope: RegisterSkillResponse = {
      ok: result.ok,
      stored: result.stored,
      durable: result.durable,
      skill: result.skill === null ? null : serializeSkillWithTrust(result.skill),
      reason: result.reason === null ? null : redact(result.reason),
      fetchedAt: result.fetchedAt,
    };

    // 201 only when the record really reached storage. A registration reported
    // as created but never stored is the one failure mode a marketplace cannot
    // recover from, because nobody goes looking for a listing they were told
    // exists.
    return c.json(envelope, result.stored ? 201 : 503);
  });

  return app;
}
