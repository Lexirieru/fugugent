/**
 * Small presentation helpers that are shared by the card, the detail page and the
 * auditor roster, and that all exist to stop the page claiming more than it has.
 */

/**
 * A digest, shortened so it never forces a horizontal scroll, and always in a form
 * somebody can compare by eye: the head is what people actually check.
 */
export function shortDigest(sha256: string | null, head = 12): string | null {
  if (sha256 === null || sha256.trim() === "") return null;
  return sha256.length <= head ? sha256 : `${sha256.slice(0, head)}…`;
}

/**
 * Whether a URI is worth rendering as a link.
 *
 * `.invalid` is reserved by RFC 2606 and never resolves, the curated examples use it
 * on purpose, so that nothing in a demo can be mistaken for a real download. A link
 * that cannot be followed is a promise the page does not keep, so those are rendered as
 * text with the reason stated instead.
 */
export function linkability(
  uri: string | null,
): { linkable: true; href: string } | { linkable: false; reason: string } {
  if (uri === null || uri.trim() === "") {
    return { linkable: false, reason: "no address was recorded" };
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { linkable: false, reason: "not a URL we can open" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { linkable: false, reason: `${url.protocol} is not a web address` };
  }
  if (url.hostname === "invalid" || url.hostname.endsWith(".invalid")) {
    return {
      linkable: false,
      reason:
        "the .invalid domain is reserved by RFC 2606 and never resolves, this is an example, and there is nothing behind it",
    };
  }
  return { linkable: true, href: uri };
}

/** A UTC date, no time. Deterministic between server and client. */
export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export const KIND_LABEL: Record<string, string> = {
  CLAUDE_SKILL: "Claude skill",
  MCP_SERVER: "MCP server",
  PLUGIN: "Plugin",
};

export const KIND_INSTALL_SURFACE: Record<string, string> = {
  CLAUDE_SKILL: "instructions the agent reads and follows",
  MCP_SERVER: "tools the agent can call, described in text the agent trusts",
  PLUGIN: "code that runs inside the agent's process",
};

/** Severity, in the order that matters. `critical` first. */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "none"] as const;

export const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--risk-5)",
  high: "var(--risk-4)",
  medium: "var(--risk-3)",
  low: "var(--risk-2)",
  none: "var(--risk-1)",
};

export function highestSeverity(findings: ReadonlyArray<{ severity: string }>): string | null {
  for (const level of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === level)) return level;
  }
  return null;
}
