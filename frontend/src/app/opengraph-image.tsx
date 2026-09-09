import { ImageResponse } from "next/og";
import { fuguDataUri, type FuguKind } from "@/lib/fugu";
import type { BloatLevel } from "@/lib/risk";
import { ACCENT, SURFACES, TEXT } from "@/lib/theme";

/**
 * The marketplace OG image. Four characters at four different puff levels — one picture
 * that explains the core mechanic of the product without a single sentence.
 *
 * Satori renders this on the server, with no document and no cascade, so a CSS custom
 * property resolves to nothing here. The colours therefore come from `lib/theme.ts`,
 * the literal projection of `theme/tokens.css` — never from hexes typed into this file.
 */

export const alt = "HelloFugu — a marketplace of DeFi agents that swell as their risk grows";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ROW: Array<[FuguKind, BloatLevel]> = [
  ["guardian", 1],
  ["rebalancer", 2],
  ["grid", 4],
  ["yield", 5],
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: SURFACES.bg,
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: ACCENT.strong, letterSpacing: 3 }}>
          FUGUGENT
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 700,
            color: TEXT.fg,
            marginTop: 16,
            lineHeight: 1.05,
          }}
        >
          Hire a DeFi agent you can check
        </div>
        <div style={{ display: "flex", fontSize: 28, color: TEXT.muted, marginTop: 18 }}>
          The fish puffs up as the risk does. Every number opens a transaction.
        </div>
        <div style={{ display: "flex", marginTop: 44, gap: 28 }}>
          {ROW.map(([kind, level]) => (
            <img
              key={kind}
              src={fuguDataUri({ kind, level, size: 190 })}
              width={190}
              height={190}
              alt=""
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
