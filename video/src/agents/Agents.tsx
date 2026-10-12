/**
 * "Meet the agents": a 55-second motion-graphics film, no screen recordings.
 *
 * Each agent gets its own card: its fugu, its job in one line, its price, and, for the
 * ones that run, its real answer from api.hellofugu.xyz (`data.json`, read and dated by
 * `scripts/data-agents.mjs`). Guardian gets the brand's own idea: the fish puffs up as
 * its loan's health factor falls, and deflates when it repays, with the real repay's
 * numbers and transaction. Variants and builders' agents are named from FuguRegistry,
 * and the film says plainly that the variants have not sent a transaction.
 *
 * Calm cuts on bar lines (100 BPM), slide-and-fade entrances, no impacts.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "../launch/Launch";
import data from "./data.json";
import timeline from "./timeline.json";

export const FPS = timeline.fps;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = Math.round(timeline.scenes[timeline.scenes.length - 1]!.end * FPS);

const ORANGE = "#ea580c";
const CREAM = "#f1e6e1";
const INK = "#0b0b0b";
const NAVY = "#121e29";
const MUTED = "#57534e";
const GREEN = "#15803d";
const f = (s: number) => Math.round(s * FPS);

type Kind = "guardian" | "rebalancer" | "grid" | "yield" | "broker" | "trader" | "pilot" | "meter" | "steward";

function useT() {
  return useCurrentFrame() / FPS;
}

/** Enters sliding up and fading in after `delay` seconds; a spring, not a tween. */
function Rise({ delay = 0, children, style, distance = 50 }: { delay?: number; children: ReactNode; style?: CSSProperties; distance?: number }) {
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - f(delay), fps: FPS, config: { damping: 20, stiffness: 140 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
}

/** The scene's own background and a gentle fade at both ends. */
function Scene({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, 10, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const drift = Math.sin(frame / 80) * 6;
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        background: dark
          ? `radial-gradient(circle at ${50 + drift}% 0%, #1d2f3f 0, ${NAVY} 60%)`
          : `radial-gradient(circle at ${20 + drift}% 10%, #fde7d6 0, transparent 45%), radial-gradient(circle at 90% 95%, #fbd5bb 0, transparent 50%), ${CREAM}`,
        fontFamily: SANS,
        color: dark ? "#fff" : INK,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function Fugu({ kind, level = 2, size, file, bob = true, style }: { kind?: Kind; level?: number; size: number; file?: string; bob?: boolean; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const y = bob ? Math.sin(frame / 22 + size) * 6 : 0;
  return (
    <Img
      src={staticFile(file ?? `agents/${kind}-${level}.svg`)}
      style={{ width: size, height: size, borderRadius: size * 0.16, transform: `translateY(${y}px)`, boxShadow: "0 24px 50px -24px rgba(18,30,41,0.6)", ...style }}
    />
  );
}

function Title({ children, size = 96, style }: { children: ReactNode; size?: number; style?: CSSProperties }) {
  return <div style={{ fontWeight: 800, fontSize: size, letterSpacing: "-0.045em", lineHeight: 1.02, ...style }}>{children}</div>;
}

function Chip({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "orange" | "green" }) {
  const bg = tone === "orange" ? ORANGE : tone === "green" ? "#dcfce7" : "#fff";
  const fg = tone === "orange" ? INK : tone === "green" ? GREEN : INK;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "10px 22px", borderRadius: 999, background: bg, color: fg, fontWeight: 600, fontSize: 30, boxShadow: "0 8px 24px -14px rgba(0,0,0,0.35)" }}>
      {children}
    </span>
  );
}

/** A request and its answer, typed out: what the agent really said. */
function Terminal({ request, lines, start = 0.4, width = 900 }: { request: string; lines: { text: ReactNode; big?: boolean; tone?: string }[]; start?: number; width?: number }) {
  const t = useT();
  const typed = Math.max(0, Math.min(request.length, Math.floor((t - start) * 45)));
  const after = start + request.length / 45 + 0.25;
  return (
    <div style={{ width, borderRadius: 26, background: NAVY, color: "#e5e7eb", padding: "26px 34px 34px", fontFamily: MONO, boxShadow: "0 40px 90px -30px rgba(18,30,41,0.7)" }}>
      <div style={{ display: "flex", gap: 9, marginBottom: 22 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />
        ))}
      </div>
      <div style={{ fontSize: 24, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden" }}>
        <span style={{ color: ORANGE }}>GET</span> {request.slice(0, typed)}
        {typed < request.length ? <span style={{ opacity: Math.floor(t * 3) % 2 ? 1 : 0 }}>▍</span> : null}
      </div>
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        {lines.map((l, i) => {
          const p = spring({ frame: f(t) - f(after + i * 0.28), fps: FPS, config: { damping: 22 } });
          return (
            <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * 30}px)`, fontSize: l.big ? 50 : 28, fontWeight: l.big ? 700 : 500, color: l.tone ?? "#e5e7eb", fontFamily: l.big ? SANS : MONO, letterSpacing: l.big ? "-0.02em" : 0 }}>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const listing = (name: string) => data.listings.find((l) => l.name === name)!;
const price = (name: string) => `$${listing(name).price.toFixed(2)} / ${listing(name).periodSeconds === 120 ? "2 min" : `${listing(name).periodSeconds / 60} min`}`;

/** An agent's name, job and price, beside its fish. */
function AgentHead({ kind, name, job, delay = 0 }: { kind: Kind; name: string; job: string; delay?: number }) {
  return (
    <Rise delay={delay} style={{ display: "flex", alignItems: "center", gap: 36 }}>
      <Fugu kind={kind} size={200} />
      <div>
        <Title size={76}>{name}</Title>
        <div style={{ marginTop: 12, fontSize: 36, color: MUTED, fontWeight: 500, maxWidth: 760 }}>{job}</div>
        <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 30 }}>{price(name)}</div>
      </div>
    </Rise>
  );
}

// ── Scenes ───────────────────────────────────────────────────────────────────────

const PARADE: Kind[] = ["guardian", "rebalancer", "grid", "yield", "broker", "trader", "pilot", "meter", "steward"];

function Intro() {
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 70 }}>
        <div style={{ display: "flex", gap: 26 }}>
          {PARADE.map((k, i) => (
            <Rise key={k} delay={0.1 + i * 0.1} distance={90}>
              <Fugu kind={k} size={150} />
            </Rise>
          ))}
        </div>
        <Rise delay={1.2} style={{ textAlign: "center" }}>
          <Title size={150}>Meet the agents.</Title>
          <div style={{ marginTop: 22, fontSize: 44, color: MUTED, fontWeight: 500 }}>
            {data.stats.listings} of them on HelloFugu, each one on the ERC-8004 registry.
          </div>
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
}

const JOBS: { key: keyof typeof data.categories; label: string; kind: Kind; line: string }[] = [
  { key: "YIELD", label: "Yield", kind: "yield", line: "Moves money to a better paying pool" },
  { key: "GRID", label: "Grid", kind: "grid", line: "Buys low and sells high, in steps" },
  { key: "REBALANCING", label: "Rebalancing", kind: "rebalancer", line: "Keeps your mix where you set it" },
  { key: "HEALTH_FACTOR", label: "Health factor", kind: "guardian", line: "Keeps your loan from liquidation" },
];

function Kinds() {
  return (
    <Scene>
      <AbsoluteFill style={{ padding: "0 150px", gap: 56, justifyContent: "center" }}>
        <Rise>
          <Title size={110}>Pick a job.</Title>
        </Rise>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 34 }}>
          {JOBS.map((j, i) => (
            <Rise key={j.key} delay={0.35 + i * 0.15} style={{ display: "flex", alignItems: "center", gap: 36, background: "#fff", borderRadius: 34, padding: 40, boxShadow: "0 30px 60px -40px rgba(0,0,0,0.4)" }}>
              <Fugu kind={j.kind} size={170} bob={false} />
              <div>
                <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.02em" }}>{j.label}</div>
                <div style={{ fontSize: 32, color: MUTED, marginTop: 8 }}>{j.line}</div>
                <div style={{ fontFamily: MONO, fontSize: 28, color: ORANGE, marginTop: 12 }}>{data.categories[j.key]} agents on the registry</div>
              </div>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

/** Health factor to puff level, the bands the product uses. */
const puffFor = (hf: number) => (hf >= 2 ? 1 : hf >= 1.5 ? 2 : hf >= 1.2 ? 3 : hf >= 1.1 ? 4 : 5);

function Guardian() {
  const t = useT();
  // The loan slides into danger, then Guardian repays: the real numbers.
  const falling = interpolate(t, [0.8, 4.2], [2.1, 1.14], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const hf = t < 5.2 ? falling : interpolate(t, [5.2, 6.2], [1.14, 1.5], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const level = puffFor(hf);
  const repaid = t >= 5.0;
  const shake = !repaid && level >= 4 ? Math.sin(t * 40) * 3 : 0;
  const colour = hf < 1.2 ? "#dc2626" : hf < 1.5 ? "#d97706" : GREEN;
  return (
    <Scene>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 140px", gap: 110 }}>
        <div style={{ position: "relative", width: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
          <div style={{ transform: `translateX(${shake}px)` }}>
            <Fugu kind="guardian" level={level} size={480} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 34, color: MUTED }}>
            health factor <span style={{ fontSize: 64, fontWeight: 700, color: colour, fontFamily: SANS }}>{hf.toFixed(2)}</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Rise delay={0.2}>
            <Chip>Fugu Guardian · Health factor</Chip>
          </Rise>
          <Rise delay={0.5} style={{ marginTop: 30 }}>
            <Title size={88}>The fish puffs up as your loan gets riskier.</Title>
          </Rise>
          <Rise delay={2.2} style={{ marginTop: 26, fontSize: 38, color: MUTED, fontWeight: 500 }}>
            Guardian watches it and repays part of it before it can be liquidated.
          </Rise>
          {repaid ? (
            <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
              <Rise delay={5.0}>
                <Chip tone="green">
                  Repaid {data.guardianProof.repaid}: {data.guardianProof.hfBefore} → {data.guardianProof.hfAfter}
                </Chip>
              </Rise>
              <Rise delay={5.6} style={{ fontFamily: MONO, fontSize: 26, color: MUTED }}>
                tx {data.guardianProof.tx.slice(0, 10)}…{data.guardianProof.tx.slice(-6)} · block {data.guardianProof.block.toLocaleString("en-US")}
              </Rise>
              <Rise delay={6.2} style={{ fontSize: 30, color: INK, fontWeight: 600 }}>
                Signed by a key that can call exactly two functions.
              </Rise>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Watch() {
  const w = data.outputs.watch;
  return (
    <Scene>
      <AbsoluteFill style={{ padding: "120px 140px", justifyContent: "space-between" }}>
        <AgentHead kind="meter" name="Fugu Watch" job="Tells you how safe a loan is." />
        <div style={{ alignSelf: "flex-end" }}>
          <Rise delay={0.6}>
            <Terminal
              start={0.9}
              request={`/api/run/watch?wallet=${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}`}
              lines={[
                { text: `health factor ${w.healthFactor}`, big: true },
                { text: w.says, tone: "#86efac" },
                { text: `read at block ${w.block}`, tone: "#64748b" },
              ]}
            />
          </Rise>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Quote() {
  const q = data.outputs.quote;
  return (
    <Scene>
      <AbsoluteFill style={{ padding: "120px 140px", justifyContent: "space-between" }}>
        <AgentHead kind="trader" name="Fugu Quote" job="Turns a dollar price into BNB at the live rate." />
        <div style={{ alignSelf: "flex-end" }}>
          <Rise delay={0.6}>
            <Terminal
              start={0.9}
              request="/api/run/quote?usd=1"
              lines={[
                { text: `$1.00 = ${q.tbnb} tBNB`, big: true },
                { text: `BNB at $${q.bnbUsd.toFixed(2)}, from the on-chain oracle`, tone: "#86efac" },
                { text: `read at block ${q.block}`, tone: "#64748b" },
              ]}
            />
          </Rise>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Scout() {
  const t = useT();
  const s = data.outputs.scout as Record<string, string[]>;
  return (
    <Scene>
      <AbsoluteFill style={{ padding: "0 140px", gap: 70, justifyContent: "center" }}>
        <AgentHead kind="broker" name="Fugu Scout" job="Finds agents for a job, straight from the registry." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 26 }}>
          {JOBS.map((j, i) => (
            <Rise key={j.key} delay={0.7 + i * 0.18} style={{ background: NAVY, color: "#fff", borderRadius: 26, padding: "26px 28px" }}>
              <div style={{ fontFamily: MONO, fontSize: 26, color: ORANGE }}>{j.label.toLowerCase()}</div>
              {(s[j.key] ?? []).map((name, k) => (
                <div key={name} style={{ marginTop: 16, fontSize: 32, fontWeight: 600, opacity: interpolate(t, [1.1 + i * 0.18 + k * 0.15, 1.4 + i * 0.18 + k * 0.15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                  {name}
                </div>
              ))}
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Keys() {
  const { keycheck, tally } = data.outputs;
  const card = { background: "#fff", borderRadius: 34, padding: 44, flex: 1, boxShadow: "0 30px 70px -40px rgba(0,0,0,0.45)" } as CSSProperties;
  return (
    <Scene>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 140px", gap: 50 }}>
        <Rise delay={0.1} style={card}>
          <Fugu kind="pilot" size={140} />
          <Title size={60} style={{ marginTop: 26 }}>Fugu Keycheck</Title>
          <div style={{ fontSize: 30, color: MUTED, marginTop: 10 }}>Is an agent&apos;s key still allowed to act?</div>
          <div style={{ marginTop: 30 }}>
            <Chip tone="green">{keycheck.valid ? "Valid, checked on chain" : "Not valid"}</Chip>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 24, color: MUTED, marginTop: 18 }}>block {keycheck.block}</div>
        </Rise>
        <Rise delay={0.5} style={card}>
          <Fugu kind="steward" size={140} />
          <Title size={60} style={{ marginTop: 26 }}>Fugu Tally</Title>
          <div style={{ fontSize: 30, color: MUTED, marginTop: 10 }}>What a wallet has spent hiring agents.</div>
          <div style={{ marginTop: 30 }}>
            <Chip>
              {tally.hires} hires · {tally.spentTbnb} tBNB
            </Chip>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 24, color: MUTED, marginTop: 18 }}>our own test wallet · block {tally.block}</div>
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
}

const VARIANTS: { name: string; kind: Kind; setting: string }[] = [
  { name: "Fugu Guardian Early", kind: "guardian", setting: "Repays at 1.40, not 1.20" },
  { name: "Fugu Rebalancer Wide", kind: "rebalancer", setting: "Trades less, on bigger drift" },
  { name: "Fugu Rebalancer Stable", kind: "rebalancer", setting: "Stablecoins only" },
  { name: "Fugu Grid Wide", kind: "grid", setting: "Fewer, bigger steps" },
  { name: "Fugu Grid Tight", kind: "grid", setting: "More, smaller steps" },
  { name: "Fugu Yield Patient", kind: "yield", setting: "For money that stays put" },
];

function Variants() {
  return (
    <Scene dark>
      <AbsoluteFill style={{ padding: "0 140px", gap: 50, justifyContent: "center" }}>
        <Rise>
          <Title size={100}>Same agents, your settings.</Title>
        </Rise>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 26 }}>
          {VARIANTS.map((v, i) => (
            <Rise key={v.name} delay={0.3 + i * 0.12} style={{ display: "flex", alignItems: "center", gap: 26, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 28, padding: 30 }}>
              <Fugu kind={v.kind} level={1} size={130} bob={false} />
              <div>
                <div style={{ fontSize: 34, fontWeight: 700 }}>{v.name}</div>
                <div style={{ fontSize: 28, color: "#cbd5e1", marginTop: 6 }}>{v.setting}</div>
                <div style={{ fontFamily: MONO, fontSize: 26, color: ORANGE, marginTop: 8 }}>{price(v.name)}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={1.4} style={{ fontSize: 30, color: "#94a3b8" }}>
          Same tested code with different settings. Like the agents they come from, they have not sent a transaction yet, and each page says so.
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
}

const LABEL: Record<string, string> = { REBALANCING: "Rebalancing", GRID: "Grid", YIELD: "Yield", HEALTH_FACTOR: "Health factor", TREASURY: "Treasury", HIRING: "Hiring", COMMERCE: "Commerce", AUTONOMOUS: "Autonomous", STREAMING: "Streaming" };

function Builders() {
  const theirs = data.listings.filter((l) => !l.ours);
  return (
    <Scene>
      <AbsoluteFill style={{ padding: "0 140px", gap: 60, justifyContent: "center" }}>
        <Rise>
          <Title size={104}>And agents from other builders.</Title>
          <div style={{ marginTop: 16, fontSize: 36, color: MUTED }}>
            {data.stats.others} listed by {data.stats.builders} builders. {data.stats.hiresByOthers} hires from {data.stats.hirers} people so far.
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {theirs.map((l, i) => (
            <Rise key={l.id} delay={0.4 + i * 0.13} style={{ display: "flex", alignItems: "center", gap: 22, background: "#fff", borderRadius: 999, padding: "18px 40px 18px 18px", boxShadow: "0 18px 40px -26px rgba(0,0,0,0.4)" }}>
              <Fugu file={`agents/builder-${l.id.split(":")[1]}.svg`} size={100} bob={false} style={{ borderRadius: 999 }} />
              <div>
                <div style={{ fontSize: 38, fontWeight: 700 }}>{l.name}</div>
                <div style={{ fontSize: 26, color: MUTED }}>{LABEL[l.category]}{l.reviews ? ` · ${l.reviews} rating` : ""}</div>
              </div>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Cta() {
  const frame = useCurrentFrame();
  const pill = spring({ frame: frame - f(0.9), fps: FPS, config: { damping: 16 } });
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <Rise delay={0.1} style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Img src={staticFile("logo.webp")} style={{ width: 110, height: 110 }} />
          <span style={{ fontWeight: 800, fontSize: 110, letterSpacing: "-0.055em" }}>HelloFugu</span>
        </Rise>
        <Rise delay={0.5}>
          <Title size={130} style={{ textAlign: "center" }}>Hire one for two cents.</Title>
        </Rise>
        <div style={{ transform: `scale(${0.85 + 0.15 * pill})`, opacity: pill, padding: "20px 46px", borderRadius: 999, background: ORANGE, fontFamily: MONO, fontSize: 54 }}>app.hellofugu.xyz</div>
        <Rise delay={1.4} style={{ fontSize: 32, color: MUTED }}>
          BNB Chain testnet · Set and Earn runs until Nov 5
        </Rise>
        <div style={{ position: "absolute", bottom: 60, display: "flex", gap: 22, opacity: 0.9 }}>
          {PARADE.map((k, i) => (
            <Rise key={k} delay={1.8 + i * 0.07} distance={40}>
              <Fugu kind={k} size={84} />
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

const SCENES: Record<string, () => ReactNode> = {
  intro: () => <Intro />,
  kinds: () => <Kinds />,
  guardian: () => <Guardian />,
  watch: () => <Watch />,
  quote: () => <Quote />,
  scout: () => <Scout />,
  keys: () => <Keys />,
  variants: () => <Variants />,
  builders: () => <Builders />,
  cta: () => <Cta />,
};

export function Agents() {
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Audio src={staticFile("agents/music.wav")} />
      {timeline.scenes.map((s) => (
        <Sequence key={s.id} from={f(s.start)} durationInFrames={f(s.end - s.start)} name={s.id}>
          {SCENES[s.id]!()}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
