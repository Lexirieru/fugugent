/**
 * The badge that says what we know about a skill, the single most load-bearing
 * component in this part of the app.
 *
 * Somebody who misreads it installs a skill that empties their agent's wallet, so it
 * never leans on colour. Each of the seven statuses differs in **four** ways at once:
 *
 *   1. a unique phrase, only one of the seven contains the word "passed";
 *   2. a unique glyph, tick, cross, ≠, ?, half-disc, hourglass, slashed circle;
 *   3. a border texture, solid, filled, double, dotted, dashed, hairline;
 *   4. a full sentence. `TrustStatement`, which says what installing would mean.
 *
 * Points 1, 2 and 3 all survive `filter: grayscale(1)`. Point 4 survives a screen
 * reader. Colour is fifth, and never alone.
 *
 * `FAILED` is deliberately the loudest thing on the page and deliberately *not* drawn
 * like the five "we do not know" states. Being proved dangerous is knowledge; never
 * having been looked at is not, and they must not rhyme.
 */

import {
  PATTERN_BORDER,
  PATTERN_WIDTH,
  TRUST_PRESENTATION,
  type TrustGlyph,
} from "@/lib/skills/trust";
import type { TrustStatus } from "@/lib/skills/types";

function Glyph({ glyph }: { glyph: TrustGlyph }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "shrink-0",
  };

  switch (glyph) {
    case "tick":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5 8.3 7.2 10.6 11.2 5.6" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.4" />
          <path d="M5.4 5.4 10.6 10.6M10.6 5.4 5.4 10.6" />
        </svg>
      );
    case "not-equal":
      return (
        <svg {...common}>
          <path d="M2.6 6.1h10.8M2.6 10.1h10.8M11.4 2.6 4.6 13.4" />
        </svg>
      );
    case "question":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.2 6.1a1.85 1.85 0 1 1 2.4 1.9c-.55.2-.6.7-.6 1.2" />
          <path d="M8 11.6v.1" />
        </svg>
      );
    case "half":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 1.75A6.25 6.25 0 0 1 8 14.25Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "hourglass":
      return (
        <svg {...common}>
          <path d="M4.2 2.6h7.6M4.2 13.4h7.6M4.6 2.6 8 8l-3.4 5.4M11.4 2.6 8 8l3.4 5.4" />
        </svg>
      );
    case "empty":
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" strokeDasharray="2 2.3" />
          <path d="M12.2 3.8 3.8 12.2" />
        </svg>
      );
  }
}

export function TrustBadge({ status, size = "md" }: { status: TrustStatus; size?: "sm" | "md" }) {
  const spec = TRUST_PRESENTATION[status];
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  if (spec.filled) {
    return (
      <span
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide text-white ${pad}`}
        style={{ backgroundColor: spec.color }}
      >
        <Glyph glyph={spec.glyph} />
        <span className="truncate">{spec.label}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full font-medium ${pad}`}
      style={{
        color: spec.color,
        borderColor: spec.color,
        borderStyle: PATTERN_BORDER[spec.pattern],
        borderWidth: PATTERN_WIDTH[spec.pattern],
      }}
    >
      <Glyph glyph={spec.glyph} />
      <span className="truncate">{spec.label}</span>
    </span>
  );
}

/**
 * The sentence under the badge. It is not decoration and it is not optional: the badge
 * names a state, and this says what that state means for the person about to install.
 */
export function TrustStatement({
  status,
  className = "",
}: {
  status: TrustStatus;
  className?: string;
}) {
  const spec = TRUST_PRESENTATION[status];
  return (
    <p className={`text-sm leading-relaxed ${className}`}>
      <span className="font-medium text-fg">{spec.bandLabel}.</span>{" "}
      <span className="text-muted">{spec.verdictLine}</span>
    </p>
  );
}
