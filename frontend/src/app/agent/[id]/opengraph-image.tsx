import { ImageResponse } from "next/og";
import { CATEGORY_META, categoryOf, fuguKindFor } from "@/lib/agents";
import { source } from "@/lib/data";
import { fuguDataUri } from "@/lib/fugu";
import { BLOAT } from "@/lib/risk";

/**
 * The agent page OG image — its own fugu, not a generic card.
 *
 * This is where the reason the detail page is a URL and not a modal shows itself: an
 * agent is an asset, so it has to be shareable, bookmarkable, and recognisable as itself
 * wherever it is pasted.
 *
 * Satori does not draw a nested `<svg>`, but it does accept a data URI in an `<img>` — so
 * the fugu here is built by exactly the same function the page uses. One geometry, two
 * renderers.
 */

export const alt = "A Fugugent agent — the pufferfish swells as its risk grows";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { agent } = await source().getAgent(decodeURIComponent(id));

  const name = agent?.record.name ?? "Fugugent";
  const kind = agent ? fuguKindFor(agent.record) : "fallback";
  const level = agent?.risk?.level ?? null;
  const category = agent ? categoryOf(agent.record) : null;
  const categoryLabel = category ? CATEGORY_META[category].label : "DeFi agent";
  const status = level
    ? `Level ${level} of 5 · ${BLOAT[level].name}`
    : "No fresh risk reading";

  const fish = fuguDataUri({ kind, level, seed: id, size: 420 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          backgroundColor: "#05080f",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: "48px" }}>
          <div style={{ display: "flex", fontSize: 26, color: "#f0b90b", letterSpacing: 3 }}>
            FUGUGENT
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 700,
              color: "#e9eef7",
              marginTop: 18,
              lineHeight: 1.05,
            }}
          >
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#96a7bf", marginTop: 20 }}>
            {categoryLabel} · BNB Chain testnet
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#6b7e97", marginTop: 14 }}>
            {status}
          </div>
        </div>
        <img src={fish} width={420} height={420} alt="" />
      </div>
    ),
    { ...size },
  );
}
