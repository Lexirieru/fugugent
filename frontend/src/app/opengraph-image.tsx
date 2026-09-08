import { ImageResponse } from "next/og";
import { fuguDataUri, type FuguKind } from "@/lib/fugu";
import type { BloatLevel } from "@/lib/risk";

/**
 * OG image marketplace. Empat karakter pada empat tingkat kembung berbeda —
 * satu gambar yang menjelaskan mekanik inti produk tanpa satu kalimat pun.
 */

export const alt = "Fugugent — a marketplace of DeFi agents that swell as their risk grows";
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
          backgroundColor: "#05080f",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#f0b90b", letterSpacing: 3 }}>
          FUGUGENT
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 700,
            color: "#e9eef7",
            marginTop: 16,
            lineHeight: 1.05,
          }}
        >
          Hire a DeFi agent you can check
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#96a7bf", marginTop: 18 }}>
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
