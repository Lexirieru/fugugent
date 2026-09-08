/**
 * Fugu sebagai komponen React. Geometrinya datang dari `lib/fugu.ts`, yang
 * adalah port langsung generator brand — jadi ikan di sini dan ikan di
 * `landingpage/public/brand/` benar-benar ikan yang sama.
 *
 * Komponen ini murni dan aman di server: tidak ada state, tidak ada efek.
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
  /** `null` = tidak ada bacaan segar; fugu digambar berlubang. */
  level: BloatLevel | null;
  seed?: string;
  /** Kalimat penuh. Tanpa ini SVG diperlakukan sebagai dekorasi. */
  label?: string;
  className?: string;
  animated?: boolean;
}) {
  const uid = `${kind}-${level ?? "hollow"}`;
  // Tingkat 3 dan 5 sengaja tidak punya animasi berulang: tingkat 5 DIAM, dan
  // perubahan dari bergerak ke berhenti adalah sinyalnya sendiri.
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
