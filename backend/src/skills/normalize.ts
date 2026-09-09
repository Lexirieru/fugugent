/**
 * Turning **untrusted outside input** into a `SkillRecord` — and screening the
 * one field an attacker fully controls.
 *
 * Two jobs, both defensive:
 *
 * 1. {@link normalizeSkillSubmission} — a submission body of unknown shape
 *    becomes either a record or a named rejection. It **never throws**: a body
 *    that is an HTML error page, an array, `null`, or a shape upstream invented
 *    last week must not be able to take an endpoint down. That is the rule
 *    already enforced in `src/sources/normalize.ts` for 8004scan, and it applies
 *    with more force here, because this input arrives straight from the public.
 *
 * 2. {@link scanDeclaredText} — a deterministic pass over the declared
 *    description and capabilities, looking for the tool-poisoning patterns that
 *    have real CVEs behind them.
 *
 * ## What the intake scan is, and what it is emphatically not
 *
 * The description is *the* injection surface (`CVE-2025-54136`,
 * `CVE-2025-54135`): hidden directives inside the text an agent reads before
 * calling a tool. So we look at it on the way in.
 *
 * But this is a **regex pass, not an audit**. It can raise suspicion; it can
 * never clear anything. A skill whose intake scan finds nothing is still
 * `UNAUDITED` — `deriveTrust` does not read these findings at all, and that
 * separation is deliberate and tested. Anything else would let an attacker earn
 * a trust badge by writing a polite description.
 *
 * No language model is involved, here or anywhere on this path: the project rule
 * is that decisions are deterministic code that can be replayed and tested.
 */

import { CHAIN_ID } from "../config.js";
import type { Address } from "../types.js";
import {
  SHA256_PATTERN,
  SKILL_KINDS,
  type RiskLevel,
  type SkillFinding,
  type SkillKind,
  type SkillRecord,
  type SkillVersionRecord,
} from "./types.js";

/** Bound every free-text field. An unbounded description is a storage attack. */
export const MAX_TEXT_LENGTH = 8_000;
/** Bound list fields so one submission cannot carry ten thousand tags. */
export const MAX_LIST_ITEMS = 64;
export const MAX_ID_LENGTH = 120;

/** The id shape: lowercase, digits, and single hyphens. It goes into a URL path. */
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asText(entry);
    if (text !== null && !out.includes(text)) out.push(text);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function asAddress(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim())
    ? (value.trim() as Address)
    : null;
}

function asKind(value: unknown): SkillKind | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (SKILL_KINDS as readonly string[]).includes(upper) ? (upper as SkillKind) : null;
}

function asSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase().replace(/^sha256:/, "");
  return SHA256_PATTERN.test(lower) ? lower : null;
}

/**
 * Money in, as a decimal string or a `bigint` — **never a `number`**.
 *
 * A `number` is refused rather than coerced: by the time a money value has been
 * through a JSON `number`, its precision may already be gone, and continuing
 * means publishing a wrong price. Same rule as `decodeMoney` in
 * `src/db/serialize.ts`.
 */
export function parsePriceUsd8(value: unknown): { value: bigint } | { error: string } {
  if (value === undefined || value === null) return { value: 0n };
  if (typeof value === "bigint") {
    return value < 0n ? { error: "priceUsd8PerVersion must not be negative" } : { value };
  }
  if (typeof value === "number") {
    return {
      error:
        "priceUsd8PerVersion arrived as a JSON number — precision may already be lost; " +
        "send it as a decimal string of USD with 8 decimals (\"1500000000\" = $15.00)",
    };
  }
  // Deliberately NOT trimmed: `decodeMoney` in `src/db/serialize.ts` does not
  // trim either, and a money string with stray whitespace is a sign the value
  // was assembled by hand somewhere it should not have been. Being lenient here
  // and strict there would mean a value this layer accepted could fail on write.
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return {
      error: `priceUsd8PerVersion must be a non-negative decimal string, not ${JSON.stringify(value)}`,
    };
  }
  return { value: BigInt(value) };
}

// ---------------------------------------------------------------------------
// The intake scan
// ---------------------------------------------------------------------------

interface Pattern {
  pattern: RegExp;
  severity: RiskLevel;
  title: string;
  detail: string;
}

/**
 * Patterns taken from the attacks this marketplace exists to stop.
 *
 * Every entry names a real technique rather than a keyword: the point is that a
 * reader of a finding can tell what was matched and judge it, not merely see a
 * score.
 */
const INTAKE_PATTERNS: readonly Pattern[] = [
  {
    pattern: /\b(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|direction)/i,
    severity: "critical",
    title: "instruction-override directive in the declared text",
    detail:
      "The description tells the calling agent to discard its own instructions — the core of " +
      "MCP tool poisoning (CVE-2025-54136 / CVE-2025-54135). A description is documentation " +
      "for a human; it has no legitimate reason to address the agent's control flow.",
  },
  {
    pattern: /<\s*(important|system|secret|admin|instructions?)\s*>/i,
    severity: "high",
    title: "pseudo-system tag hidden in the declared text",
    detail:
      "Tags such as <IMPORTANT> are the documented carrier for smuggled directives in poisoned " +
      "MCP tool descriptions: they read as markup to a human and as an authority marker to a model.",
  },
  {
    pattern: /<!--[\s\S]{0,4000}?-->/,
    severity: "medium",
    title: "HTML comment inside the declared text",
    detail:
      "Comments render invisibly to a human reviewer while still reaching the agent's context " +
      "window — a standard place to hide directives.",
  },
  {
    pattern: /[​-‏‪-‮⁠-⁤﻿]/,
    severity: "high",
    title: "zero-width or bidirectional control characters",
    detail:
      "Invisible codepoints let two different texts render identically — what a reviewer reads " +
      "and what the agent receives can be made to differ.",
  },
  {
    pattern: /(~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|private[_\s-]?key|mnemonic|seed[_\s-]?phrase)/i,
    severity: "critical",
    title: "reference to credential material",
    detail:
      "The declared text names secrets on the host (SSH keys, AWS credentials, .env files, " +
      "private keys or seed phrases). A tool that describes reading these is describing " +
      "exfiltration, whatever else it claims to do.",
  },
  {
    pattern: /\b(setApprovalForAll|approve\s*\(\s*[^)]*max|unlimited\s+approval|transferFrom)\b/i,
    severity: "critical",
    title: "wallet-draining call named in the declared text",
    detail:
      "Blanket-approval and pull-transfer calls are how an agent's wallet is emptied in one " +
      "transaction. A skill that names them in its own description must be audited before install.",
  },
  {
    pattern: /\b(curl|wget)\b[^\n]{0,80}\|\s*(sh|bash|zsh)\b/i,
    severity: "critical",
    title: "pipe-to-shell installation step",
    detail:
      "Fetching a remote script straight into a shell is the supply-chain RCE shape behind " +
      "CVE-2025-6514 (mcp-remote, 558k downloads).",
  },
  {
    pattern: /\b(eval|new\s+Function|child_process|execSync|spawnSync)\s*\(/,
    severity: "high",
    title: "dynamic code execution named in the declared text",
    detail:
      "Dynamic evaluation turns any injected string into code, and it defeats review of the " +
      "artefact as written.",
  },
  {
    pattern: /\b(do\s+not|don't|never)\b[^.]{0,30}\b(tell|mention|reveal|show|inform)\b[^.]{0,30}\b(user|human|owner)\b/i,
    severity: "critical",
    title: "instruction to conceal behaviour from the user",
    detail:
      "The text asks the agent to hide what it is doing from the person responsible for it. " +
      "There is no benign version of this in a tool description.",
  },
];

/**
 * Screen declared text for tool-poisoning patterns.
 *
 * Returns findings, never a verdict. An empty result means "nothing matched
 * these patterns", which is a far weaker statement than "safe" — and the type
 * system keeps them apart, because nothing in `deriveTrust` can read this.
 */
export function scanDeclaredText(...texts: readonly string[]): SkillFinding[] {
  const haystack = texts.filter((t) => typeof t === "string").join("\n");
  if (haystack.trim() === "") return [];
  const findings: SkillFinding[] = [];
  for (const entry of INTAKE_PATTERNS) {
    const match = entry.pattern.exec(haystack);
    if (match === null) continue;
    const excerpt = match[0].replace(/\s+/g, " ").slice(0, 160);
    findings.push({
      severity: entry.severity,
      title: entry.title,
      // The excerpt is what makes the finding checkable rather than a verdict of
      // its own — a reader can look at the text and disagree.
      detail: `${entry.detail} Matched: ${JSON.stringify(excerpt)}`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Submission normalization
// ---------------------------------------------------------------------------

export interface NormalizeSkillContext {
  /** ISO 8601 UTC — injected so tests are deterministic. */
  now: string;
  source: SkillRecord["source"];
  chainId?: number;
}

/** Either a usable record or a rejection that names the offending field. */
export type SkillSubmissionResult =
  | { ok: true; skill: SkillRecord }
  | { ok: false; field: string; message: string };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
}

/**
 * An unknown body → a `SkillRecord`, or a named rejection.
 *
 * The mandatory fields are exactly the ones without which the record could not
 * do its job: an id and a name to address it, a `sourceUri` saying where the
 * artefact comes from, and a `contentSha256` pinning the exact bytes. The hash
 * is not optional and is not computed for the submitter — without it there is
 * nothing an audit could be bound to, and the rug-pull guard in `deriveTrust`
 * would have nothing to compare.
 */
export function normalizeSkillSubmission(
  body: unknown,
  ctx: NormalizeSkillContext,
): SkillSubmissionResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      field: "body",
      message: `expected a JSON object, received ${Array.isArray(body) ? "an array" : typeof body}`,
    };
  }

  const name = asText(body.name);
  if (name === null) return { ok: false, field: "name", message: "name is required" };

  const rawId = asText(body.id);
  const id = rawId === null ? slugify(name) : slugify(rawId);
  if (!SKILL_ID_PATTERN.test(id)) {
    return {
      ok: false,
      field: "id",
      message:
        `id must be 3-120 characters of lowercase letters, digits and hyphens ` +
        `(derived ${JSON.stringify(id)} from ${JSON.stringify(rawId ?? name)})`,
    };
  }

  const kind = asKind(body.kind);
  if (kind === null) {
    return {
      ok: false,
      field: "kind",
      message: `kind must be one of ${SKILL_KINDS.join(", ")}`,
    };
  }

  const sourceUri = asText(body.sourceUri);
  if (sourceUri === null) {
    return {
      ok: false,
      field: "sourceUri",
      message: "sourceUri is required — a skill nobody can fetch cannot be audited",
    };
  }

  const contentSha256 = asSha256(body.contentSha256);
  if (contentSha256 === null) {
    return {
      ok: false,
      field: "contentSha256",
      message:
        "contentSha256 must be 64 hex characters — it pins the exact build an audit " +
        "would apply to, and without it a clean v1 could silently serve a malicious v2",
    };
  }

  const price = parsePriceUsd8(body.priceUsd8PerVersion);
  if ("error" in price) {
    return { ok: false, field: "priceUsd8PerVersion", message: price.error };
  }

  const version = asText(body.version) ?? "0.0.0";
  const declaredDescription = asText(body.declaredDescription) ?? "";
  const declaredCapabilities = asStringList(body.declaredCapabilities);

  const versions: SkillVersionRecord[] = [
    { version, contentSha256, publishedAt: ctx.now, auditId: null },
  ];

  return {
    ok: true,
    skill: {
      id,
      name,
      kind,
      version,
      contentSha256,
      sourceUri,
      declaredDescription,
      declaredCapabilities,
      authorAddress: asAddress(body.authorAddress),
      authorName: asText(body.authorName),
      tags: asStringList(body.tags),
      priceUsd8PerVersion: price.value,
      // Run on the way in, so a poisoned description is flagged from the first
      // moment it is listed — while still being nothing more than a flag.
      intakeFindings: scanDeclaredText(declaredDescription, ...declaredCapabilities, name),
      versions,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      source: ctx.source,
      fetchedAt: ctx.now,
      // A submitted skill is never an example. The flag exists to mark the
      // curated bundle, and a submitter must not be able to set it either way.
      example: false,
    },
  };
}

/** The chain a skill record is scoped to. Only BSC testnet is supported. */
export function skillChainId(ctx: NormalizeSkillContext): number {
  return ctx.chainId ?? CHAIN_ID;
}
