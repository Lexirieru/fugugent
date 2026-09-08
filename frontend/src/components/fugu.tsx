/**
 * The fugu as a React component. Its geometry comes from `lib/fugu.ts`, which is a
 * direct port of the brand generator — so the fish here and the fish in
 * `landingpage/public/brand/` really are the same fish.
 *
 * This component is pure and safe on the server: no state, no effects.
 */

import { fuguInner, type FuguKind } from "@/lib/fugu";
import { BLOAT, type BloatLevel } from "@/lib/risk";

export function Fugu({
  kind,
  level,
  seed,
  label,
  className,
  animated = true,
}: {
  kind: FuguKind;
  /** `null` = no fresh reading; the fugu is drawn hollow. */
  level: BloatLevel | null;
  seed?: string;
  /** A full sentence. Without it the SVG is treated as decoration. */
  label?: string;
  className?: string;
  animated?: boolean;
}) {
  const uid = `${kind}-${level ?? "hollow"}`;
  // Levels 3 and 5 deliberately have no repeating animation: level 5 IS STILL, and the
  // change from moving to stopping is a signal in its own right.
  const motion = animated && level ? BLOAT[level].motionClass : null;

  return (
    <svg
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={[className, motion].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: fuguInner({ kind, level, seed, uid }) }}
    />
  );
}
