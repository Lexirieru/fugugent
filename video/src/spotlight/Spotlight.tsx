/**
 * "New on HelloFugu": a 14-second square card for one agent, rendered from data.
 *
 * Everything on it comes from `data.json` (FuguRegistry and the ERC-8004 registration
 * file, read and dated by `scripts/data-spotlight.mjs`) except the one-line job, which is
 * a shortening of the agent's own description kept in `lines.json`. A builder's agent is
 * only shown when its endpoint answered at read time, and the card says when that was.
 *
 *   npx remotion render src/spotlight/index.ts Spotlight out/spotlight-2662.mp4 --props='{"id":"97:2662"}'
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS } from "../launch/Launch";
import data from "./data.json";
import lines from "./lines.json";
import timeline from "./timeline.json";

export const FPS = timeline.fps;
export const SIZE = 1080;
export const DURATION = Math.round(timeline.scenes[timeline.scenes.length - 1]!.end * FPS);
export type SpotlightProps = { id: string };

const ORANGE = "#ea580c";
const CREAM = "#f1e6e1";
const INK = "#0b0b0b";
const NAVY = "#121e29";
const MUTED = "#57534e";
const GREEN = "#15803d";
const f = (s: number) => Math.round(s * FPS);
const at = (id: string) => timeline.scenes.find((s) => s.id === id)!.start;

const LABEL: Record<string, string> = { REBALANCING: "Rebalancing", GRID: "Grid", YIELD: "Yield", HEALTH_FACTOR: "Health factor", TREASURY: "Treasury", HIRING: "Hiring", COMMERCE: "Commerce", AUTONOMOUS: "Autonomous", STREAMING: "Streaming" };
const period = (s: number) => (s < 60 ? `${s} s` : s % 3600 === 0 ? `${s / 3600} h` : `${s / 60} min`);
const money = (n: number) => (n >= 0.01 ? `$${n.toFixed(2)}` : `$${n}`);
const day = new Date(data.readAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Rise({ delay = 0, children, style, distance = 40 }: { delay?: number; children: ReactNode; style?: CSSProperties; distance?: number }) {
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - f(delay), fps: FPS, config: { damping: 20, stiffness: 140 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
}

function Fact({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <Rise delay={delay} style={{ flex: 1, background: "#fff", borderRadius: 26, padding: "22px 26px", boxShadow: "0 24px 50px -34px rgba(0,0,0,0.45)" }}>
      <div style={{ fontSize: 22, color: MUTED, fontWeight: 500 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 34, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{value}</div>
    </Rise>
  );
}

export function Spotlight({ id }: SpotlightProps) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const a = data.agents.find((x) => x.id === id);
  if (!a) throw new Error(`${id} is not in src/spotlight/data.json; run scripts/data-spotlight.mjs with its listing id`);
  if (!a.ours && !a.probe.ok) throw new Error(`${a.name}'s endpoint did not answer at ${data.readAt}; not rendering a spotlight for it`);
  const extra = (lines.agents as Record<string, { line: string; kind?: string }>)[id];
  if (!extra) throw new Error(`${id} has no line in src/spotlight/lines.json`);

  // Our agents puff and settle, the brand's idea in one breath; a builder's fish stays as the marketplace draws it.
  const level = extra.kind ? [1, 2, 3, 2, 1][Math.min(4, Math.floor(Math.max(0, t - 1) / 0.5)) % 5] : 2;
  const art = extra.kind ? `agents/${extra.kind}-${level}.svg` : `agents/builder-${id.split(":")[1]}.svg`;
  const bob = Math.sin(frame / 14) * 6;
  const cta = t >= at("cta");
  const fade = interpolate(t, [at("cta") - 0.35, at("cta")], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const end = interpolate(frame, [DURATION - 12, DURATION], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const drift = Math.sin(frame / 50) * 6;
  const status = a.ours
    ? a.hires
      ? `Hired ${a.hires} times by ${a.hirers} people`
      : "Live on BNB Chain testnet"
    : `Endpoint answered · checked ${day}`;

  return (
    <AbsoluteFill
      style={{
        opacity: end,
        fontFamily: SANS,
        color: INK,
        background: `radial-gradient(circle at ${20 + drift}% 8%, #fde7d6 0, transparent 45%), radial-gradient(circle at 92% 96%, #fbd5bb 0, transparent 50%), ${CREAM}`,
      }}
    >
      <Audio src={staticFile("spotlight/music.wav")} />
      {!cta ? (
        <AbsoluteFill style={{ opacity: fade, padding: "80px 80px 70px", display: "flex", flexDirection: "column" }}>
          <Rise delay={0.15}>
            <span style={{ display: "inline-flex", padding: "10px 24px", borderRadius: 999, background: a.ours ? NAVY : ORANGE, color: a.ours ? "#fff" : INK, fontWeight: 700, fontSize: 28 }}>
              {a.ours ? "Meet the agents" : "New on HelloFugu"}
            </span>
          </Rise>
          <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 48 }}>
            <Rise delay={0.35} distance={70}>
              <Img src={staticFile(art)} style={{ width: 300, height: 300, borderRadius: 48, transform: `translateY(${bob}px)`, boxShadow: "0 30px 60px -28px rgba(18,30,41,0.6)" }} />
            </Rise>
            <Rise delay={0.8} style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: a.name.length > 20 ? 66 : 84, letterSpacing: "-0.045em", lineHeight: 1.0 }}>{a.name}</div>
              <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 26, color: MUTED }}>ERC-8004 · {a.id}</div>
            </Rise>
          </div>
          <Rise delay={at("facts")} style={{ marginTop: 48, fontSize: 46, fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.02em" }}>
            {extra.line}
          </Rise>
          <div style={{ display: "flex", gap: 20, marginTop: "auto" }}>
            <Fact delay={at("facts") + 1.6} label="Price" value={`${money(a.price)} / ${period(a.periodSeconds)}`} />
            <Fact delay={at("facts") + 1.85} label="Kind" value={LABEL[a.category] ?? a.category} />
            <Fact delay={at("facts") + 2.1} label="Built by" value={a.ours ? "HelloFugu" : "Another builder"} />
          </div>
          <Rise delay={at("facts") + 3.2} style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 14, fontSize: 28, color: GREEN, fontWeight: 600 }}>
            <span style={{ width: 16, height: 16, borderRadius: 99, background: GREEN, opacity: 0.6 + 0.4 * Math.sin(frame / 6) }} />
            {status}
          </Rise>
        </AbsoluteFill>
      ) : (
        <Cta name={a.name} art={art} id={id} />
      )}
    </AbsoluteFill>
  );
}

function Cta({ name, art, id }: { name: string; art: string; id: string }) {
  const frame = useCurrentFrame();
  const local = frame - f(at("cta"));
  const pill = spring({ frame: local - f(0.7), fps: FPS, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34, padding: 80, textAlign: "center" }}>
      <div style={{ opacity: spring({ frame: local, fps: FPS, config: { damping: 20 } }) }}>
        <Img src={staticFile(art)} style={{ width: 200, height: 200, borderRadius: 36, boxShadow: "0 30px 60px -28px rgba(18,30,41,0.6)" }} />
      </div>
      <div style={{ opacity: spring({ frame: local - f(0.25), fps: FPS, config: { damping: 20 } }) }}>
        <div style={{ fontWeight: 800, fontSize: 86, letterSpacing: "-0.045em", lineHeight: 1.02 }}>Hire {name.length > 22 ? "it" : name}.</div>
        <div style={{ marginTop: 18, fontSize: 34, color: MUTED, fontWeight: 500 }}>A capped deposit. Cancel any time and get the rest back.</div>
      </div>
      <div style={{ transform: `scale(${0.85 + 0.15 * pill})`, opacity: pill, padding: "18px 40px", borderRadius: 999, background: ORANGE, fontFamily: MONO, fontSize: 40 }}>app.hellofugu.xyz</div>
      <div style={{ opacity: spring({ frame: local - f(1.3), fps: FPS, config: { damping: 20 } }), display: "flex", alignItems: "center", gap: 16, fontSize: 26, color: MUTED }}>
        <Img src={staticFile("logo.webp")} style={{ width: 40, height: 40 }} />
        HelloFugu · BNB Chain testnet · {id}
      </div>
    </AbsoluteFill>
  );
}
