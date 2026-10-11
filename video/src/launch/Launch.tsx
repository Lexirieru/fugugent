/**
 * The launch film: 54 seconds, landing page to app, cut on the beat.
 *
 * Every screen is a 2x still of the real site (`scripts/capture-launch.mjs`), placed in
 * a browser window on a warm gradient. The camera, the cursor and the zooms are done
 * here, in the manner of an auto-zooming screen recorder: the camera eases to whatever
 * the cursor is about to touch, holds, and eases out. Cuts between scenes are hard and
 * land on the impacts in `timeline.json`, which the music is written from too.
 *
 * Copy rules: short sentences, no buzzwords, no em dashes.
 */
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import captured from "./captured.json";
import timeline from "./timeline.json";

const { fontFamily: SANS } = loadGeist("normal", { weights: ["500", "600", "700", "800"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["500"] });

export const FPS = timeline.fps;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = Math.round(timeline.scenes[timeline.scenes.length - 1]!.end * FPS);

const ORANGE = "#ea580c";
const CREAM = "#f1e6e1";
const INK = "#0b0b0b";

type Box = { x: number; y: number; w: number; h: number };
type Shot = { file: string; width: number; height: number; [k: string]: unknown };
const SHOTS = captured.shots as Record<string, Shot>;
const box = (shot: string, key: string) => SHOTS[shot]![key] as Box;
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

const scene = (id: string) => timeline.scenes.find((s) => s.id === id)!;
const f = (s: number) => Math.round(s * FPS);

// ── Keyframes ──────────────────────────────────────────────────────────────────────

type Key = { t: number; v: number[] };
const SMOOTH = Easing.bezier(0.45, 0, 0.15, 1);

/** Values at local second `t`, eased between keyframes and held outside them. */
function track(t: number, keys: Key[], ease = SMOOTH): number[] {
  if (t <= keys[0]!.t) return keys[0]!.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b.t) {
      const p = ease((t - a.t) / Math.max(1e-6, b.t - a.t));
      return a.v.map((v, k) => v + (b.v[k]! - v) * p);
    }
  }
  return keys[keys.length - 1]!.v;
}

// ── The browser window ─────────────────────────────────────────────────────────────

const WIN_W = 1500;
const S = WIN_W / 1440;
const CHROME = 46;
const WIN_H = 900 * S + CHROME;
const WIN_X = (WIDTH - WIN_W) / 2;
const WIN_Y = (HEIGHT - WIN_H) / 2 + 6;
/** The viewport point that sits at the centre of the frame at zoom 1. */
const MID = { x: 720, y: (HEIGHT / 2 - WIN_Y - CHROME) / S };

function Backdrop() {
  const frame = useCurrentFrame();
  const a = 25 + 10 * Math.sin(frame / 90);
  const b = 75 + 8 * Math.cos(frame / 110);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${a}% 18%, #fed7aa 0, transparent 46%), radial-gradient(circle at ${b}% 92%, #fb923c 0, transparent 52%), radial-gradient(circle at 92% 8%, #fde68a 0, transparent 30%), linear-gradient(135deg, #fff7ed 0%, #fdba74 100%)`,
      }}
    />
  );
}

function Chrome({ url }: { url: string }) {
  return (
    <div
      style={{
        height: CHROME,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 18px",
        background: "#f7f2ef",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />
      ))}
      <span
        style={{
          marginLeft: 18,
          flex: "0 1 520px",
          height: 28,
          borderRadius: 99,
          background: "#fff",
          border: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          fontFamily: SANS,
          fontSize: 15,
          color: "#57534e",
        }}
      >
        🔒&nbsp;&nbsp;{url}
      </span>
    </div>
  );
}

/**
 * The window, and the camera on it. `cam` is [zoom, x, y] with x and y in the
 * screenshot's viewport pixels: the point the camera centres on.
 */
function Stage({ cam, url, children, lift = 0 }: { cam: number[]; url: string; children: ReactNode; lift?: number }) {
  const [z, x, y] = cam as [number, number, number];
  const fx = WIN_X + x * S;
  const fy = WIN_Y + CHROME + y * S;
  // Keep the frame on the window when zoomed in, so no gradient shows at the edges.
  const half = { w: WIDTH / 2 / z, h: HEIGHT / 2 / z };
  const cx = z > WIDTH / WIN_W ? Math.min(Math.max(fx, WIN_X + half.w), WIN_X + WIN_W - half.w) : fx;
  const cy = z > HEIGHT / WIN_H ? Math.min(Math.max(fy, WIN_Y + half.h), WIN_Y + WIN_H - half.h) : fy;
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `translate(${WIDTH / 2 - z * cx}px, ${HEIGHT / 2 - z * cy + lift}px) scale(${z})` }}>
        <div
          style={{
            position: "absolute",
            left: WIN_X,
            top: WIN_Y,
            width: WIN_W,
            height: WIN_H,
            borderRadius: 18,
            overflow: "hidden",
            background: CREAM,
            boxShadow: "0 50px 120px -30px rgba(120,45,0,0.45), 0 0 0 1px rgba(0,0,0,0.07)",
          }}
        >
          <Chrome url={url} />
          <div style={{ position: "absolute", top: CHROME, left: 0, width: 1440, height: 900, overflow: "hidden", transform: `scale(${S})`, transformOrigin: "0 0" }}>
            {children}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ShotImg({ name, scroll = 0, opacity = 1 }: { name: string; scroll?: number; opacity?: number }) {
  const s = SHOTS[name]!;
  return <Img src={staticFile(s.file)} style={{ position: "absolute", left: 0, top: -scroll, width: 1440, height: s.height, opacity }} />;
}

/** A cursor that travels along `path` and presses at each time in `clicks`. */
function Cursor({ t, path, clicks }: { t: number; path: Key[]; clicks: number[] }) {
  const [x, y] = track(t, path) as [number, number];
  const pressed = clicks.some((c) => t >= c && t < c + 0.14);
  const ring = clicks.map((c) => t - c).find((d) => d >= 0 && d < 0.6);
  return (
    <>
      {ring !== undefined ? (
        <div
          style={{
            position: "absolute",
            left: x - 30 - ring * 40,
            top: y - 30 - ring * 40,
            width: 60 + ring * 80,
            height: 60 + ring * 80,
            borderRadius: 999,
            border: `4px solid ${ORANGE}`,
            opacity: 1 - ring / 0.6,
          }}
        />
      ) : null}
      <svg
        width={34}
        height={34}
        viewBox="0 0 24 24"
        style={{ position: "absolute", left: x - 4, top: y - 2, transform: `scale(${pressed ? 0.82 : 1})`, transformOrigin: "4px 2px", filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.35))" }}
      >
        <path d="M4 2l16 9.5-7 1.6 3.9 7.4-3 1.5-3.9-7.4L4 19z" fill={INK} stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </>
  );
}

// ── Text ───────────────────────────────────────────────────────────────────────────

/** A caption pill at the bottom, words rising in one after another. */
function Caption({ text, from, to }: { text: string; from: number; to: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < from || t > to) return null;
  const out = interpolate(t, [to - 0.18, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity: out }}>
      <div
        style={{
          maxWidth: 1500,
          padding: "20px 36px",
          borderRadius: 999,
          background: "rgba(11,11,11,0.92)",
          color: "#fff",
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 44,
          letterSpacing: "-0.01em",
          boxShadow: "0 20px 50px -15px rgba(0,0,0,0.5)",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: 12,
        }}
      >
        {words.map((w, i) => {
          const p = spring({ frame: frame - f(from) - i * 2, fps, config: { damping: 18, stiffness: 220 } });
          return (
            <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - p) * 26}px)`, opacity: p }}>
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A line that slams in: oversized and blurred, then hard into place. */
function Slam({ children, at, style }: { children: ReactNode; at: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const d = frame - f(at);
  if (d < 0) return null;
  const p = interpolate(d, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ transform: `scale(${1.55 - 0.55 * p})`, filter: `blur(${(1 - p) * 18}px)`, opacity: Math.min(1, p * 2), ...style }}>{children}</div>
  );
}

// ── Cuts ───────────────────────────────────────────────────────────────────────────

/** A white flash and a short shake on every impact in the timeline. */
function Impacts({ children }: { children: ReactNode }) {
  const frame = useCurrentFrame();
  const since = timeline.impacts.map((s) => frame - f(s)).filter((d) => d >= 0).at(-1) ?? 999;
  const k = since < 10 ? (10 - since) / 10 : 0;
  const shake = k > 0 ? { x: Math.sin(since * 2.1) * 14 * k, y: Math.cos(since * 2.7) * 10 * k } : { x: 0, y: 0 };
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: since < 5 ? (5 - since) / 6 : 0, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}

/** How a scene arrives: a slam (scale and blur) or a whip (horizontal blur and slide). */
function Enter({ kind, children }: { kind: "slam" | "whip"; children: ReactNode }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, kind === "whip" ? 12 : 9], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const style: CSSProperties =
    kind === "whip"
      ? { transform: `translateX(${(1 - p) * 420}px)`, filter: `blur(${(1 - p) * 24}px)` }
      : { transform: `scale(${1.18 - 0.18 * p})`, filter: `blur(${(1 - p) * 14}px)` };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

/** Local time in seconds inside a Sequence. */
function useT() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

// ── Scenes ─────────────────────────────────────────────────────────────────────────

function Hook() {
  const t = useT();
  const lines: { at: number; text: ReactNode }[] = [
    { at: 0.0, text: "Crypto takes time." },
    { at: 1.0, text: "An AI agent could do the work." },
    { at: 2.0, text: "But who checks the agent?" },
    { at: 3.0, text: <span style={{ color: ORANGE, fontSize: 190 }}>You do.</span> },
  ];
  const current = [...lines].reverse().find((l) => t >= l.at)!;
  return (
    <AbsoluteFill style={{ background: INK, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 50%, rgba(234,88,12,0.18), transparent 60%)" }} />
      <Slam key={current.at} at={current.at} style={{ fontFamily: SANS, fontWeight: 800, fontSize: 128, color: "#fff", letterSpacing: "-0.045em", textAlign: "center", padding: "0 120px", lineHeight: 1.02 }}>
        {current.text}
      </Slam>
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 160 } });
  const word = interpolate(frame, [f(0.3), f(0.75)], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const sub = spring({ frame: frame - f(0.85), fps, config: { damping: 20 } });
  return (
    <AbsoluteFill style={{ background: CREAM, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        <Img src={staticFile("logo.webp")} style={{ width: 210, height: 210, transform: `scale(${0.4 + 0.6 * pop}) rotate(${(1 - pop) * -14}deg)` }} />
        <div style={{ clipPath: `inset(0 ${100 - word}% 0 0)`, fontFamily: SANS, fontWeight: 800, fontSize: 190, letterSpacing: "-0.055em", color: INK }}>HelloFugu</div>
      </div>
      <div style={{ position: "absolute", top: 760, fontFamily: SANS, fontWeight: 500, fontSize: 46, color: "#57534e", opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }}>
        Hire an AI agent for your crypto, like you&apos;d download an app.
      </div>
    </AbsoluteFill>
  );
}

function Landing() {
  const t = useT();
  const hero = SHOTS["landing-hero-ui"]!;
  const vid = box("landing-hero-ui", "video");
  if (t < 3) {
    const cam = track(t, [
      { t: 0, v: [1, MID.x, MID.y] },
      { t: 0.5, v: [1, MID.x, MID.y] },
      { t: 2.6, v: [1.32, 420, 300] },
    ]);
    const lift = interpolate(t, [0, 0.7], [90, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    return (
      <Stage cam={cam} url="hellofugu.xyz" lift={lift}>
        <div style={{ position: "absolute", inset: 0, background: hero.bg as string }} />
        <OffthreadVideo src={staticFile("launch/plane.mp4")} muted style={{ position: "absolute", left: vid.x, top: vid.y, width: vid.w, height: vid.h, objectFit: "cover" }} />
        <ShotImg name="landing-hero-ui" />
      </Stage>
    );
  }
  const scroll = track(t - 3, [{ t: 0, v: [0] }, { t: 0.3, v: [0] }, { t: 2.7, v: [620] }])[0]!;
  const cam = track(t - 3, [{ t: 0, v: [1.06, MID.x, MID.y] }, { t: 2.8, v: [1.12, 520, MID.y] }]);
  return (
    <Enter kind="whip">
      <Stage cam={cam} url="hellofugu.xyz">
        <ShotImg name="landing-below" scroll={scroll} />
      </Stage>
    </Enter>
  );
}

function Catalogue() {
  const t = useT();
  const tabAll = center(box("agents-all", "tab"));
  const tabHf = center(box("agents-hf", "tab"));
  const card = center(box("agents-hf", "card"));
  const swapped = t >= 1.55;
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.7, v: [1, MID.x, MID.y] },
    { t: 1.45, v: [1.6, tabAll.x, tabAll.y] },
    { t: 1.6, v: [1.6, tabHf.x, tabHf.y] },
    { t: 2.7, v: [1.6, tabHf.x, tabHf.y] },
    { t: 3.7, v: [1.55, card.x, card.y + 20] },
  ]);
  const path: Key[] = [
    { t: 0, v: [1050, 720] },
    { t: 1.3, v: [tabAll.x, tabAll.y] },
    { t: 1.55, v: [tabAll.x, tabAll.y] },
    { t: 1.6, v: [tabHf.x, tabHf.y] },
    { t: 2.8, v: [tabHf.x, tabHf.y] },
    { t: 3.6, v: [card.x + 60, card.y + 40] },
  ];
  return (
    <Stage cam={cam} url="app.hellofugu.xyz/agents">
      <ShotImg name={swapped ? "agents-hf" : "agents-all"} />
      <Cursor t={t} path={path} clicks={[1.42]} />
    </Stage>
  );
}

function AgentPage() {
  const t = useT();
  const reg = box("agent-page", "registered");
  const ev = box("agent-page", "evidence");
  // The stats row sits about 230 px above the identity card's first row.
  const statsY = ev.y - 231;
  const [scroll] = track(t, [{ t: 0, v: [0] }, { t: 2.0, v: [0] }, { t: 3.2, v: [420] }]) as [number];
  // Page coordinates; the camera wants viewport coordinates, so the scroll comes off y.
  const [z, x, py] = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.4, v: [1, MID.x, MID.y] },
    { t: 1.6, v: [1.75, 953, statsY] },
    { t: 2.0, v: [1.75, 953, statsY] },
    { t: 3.2, v: [1.3, 720, ev.y + 140] },
    { t: 3.8, v: [1.3, 720, ev.y + 140] },
    { t: 4.9, v: [1.8, reg.x + 230, reg.y + 45] },
  ]) as [number, number, number];
  return (
    <Enter kind="slam">
      <Stage cam={[z, x, py - scroll]} url="app.hellofugu.xyz/agent/97:2480">
        <ShotImg name="agent-page" scroll={scroll} />
      </Stage>
    </Enter>
  );
}

function Hire() {
  const t = useT();
  const btn = center(box("hire-before", "hire"));
  const done = box("hire-after", "done");
  const doneAt = { x: done.x + 230, y: done.y + done.h / 2 };
  const after = t >= 2.25;
  const cam = track(t, [
    { t: 0, v: [1.15, MID.x, 380] },
    { t: 0.7, v: [1.15, MID.x, 380] },
    { t: 1.7, v: [1.95, btn.x + 40, btn.y] },
    { t: 2.25, v: [1.95, btn.x + 40, btn.y] },
    { t: 3.1, v: [1.85, doneAt.x, doneAt.y] },
    { t: 5.4, v: [1.85, doneAt.x, doneAt.y] },
    { t: 7.4, v: [1.12, MID.x, 420] },
  ]);
  const path: Key[] = [
    { t: 0, v: [980, 640] },
    { t: 1.6, v: [btn.x + 20, btn.y + 6] },
    { t: 2.5, v: [btn.x + 20, btn.y + 6] },
    { t: 3.4, v: [doneAt.x + 260, doneAt.y + 120] },
  ];
  return (
    <Enter kind="whip">
      <Stage cam={cam} url="app.hellofugu.xyz/agent/97:2480#hire">
        <ShotImg name={after ? "hire-after" : "hire-before"} />
        <Cursor t={t} path={path} clicks={[1.9]} />
      </Stage>
    </Enter>
  );
}

function MyAgents() {
  const t = useT();
  const cd = center(box("me-running-0", "countdown"));
  const cancel = center(box("me-running-0", "cancel"));
  const yes = center(box("me-confirm", "yes"));
  const note = box("me-cancelled", "notice");
  const noteAt = { x: note.x + 210, y: note.y + note.h / 2 };
  const shot = t < 5.7 ? `me-running-${Math.min(4, Math.floor(t))}` : t < 6.9 ? "me-confirm" : "me-cancelled";
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.3, v: [1, MID.x, MID.y] },
    { t: 1.2, v: [2.15, cd.x, cd.y] },
    { t: 4.3, v: [2.15, cd.x, cd.y] },
    { t: 5.2, v: [1.9, cancel.x, cancel.y] },
    { t: 5.8, v: [1.9, cancel.x, cancel.y] },
    { t: 6.4, v: [1.9, yes.x + 60, yes.y] },
    { t: 6.9, v: [1.9, yes.x + 60, yes.y] },
    { t: 7.7, v: [2.2, noteAt.x, noteAt.y] },
  ]);
  const path: Key[] = [
    { t: 0, v: [900, 760] },
    { t: 4.4, v: [900, 760] },
    { t: 5.2, v: [cancel.x + 10, cancel.y + 4] },
    { t: 5.7, v: [cancel.x + 10, cancel.y + 4] },
    { t: 6.4, v: [yes.x + 10, yes.y + 4] },
    { t: 7.0, v: [yes.x + 10, yes.y + 4] },
    { t: 7.8, v: [noteAt.x + 280, noteAt.y + 110] },
  ];
  return (
    <Enter kind="slam">
      <Stage cam={cam} url="app.hellofugu.xyz/me">
        <ShotImg name={shot} />
        <Cursor t={t} path={path} clicks={[5.5, 6.65]} />
      </Stage>
    </Enter>
  );
}

function Stats() {
  const t = useT();
  const cards = [
    { at: 0, text: "Built by one person.", bg: INK, fg: "#fff" },
    { at: 1.5, text: "Shortlisted from 260+ teams.", bg: ORANGE, fg: INK },
    { at: 3.0, text: <>25 agents, all read from <span style={{ whiteSpace: "nowrap" }}>ERC-8004.</span></>, bg: INK, fg: "#fff" },
    { at: 4.5, text: "Live now in BNB Chain's Set and Earn.", bg: CREAM, fg: INK },
  ];
  const c = [...cards].reverse().find((x) => t >= x.at)!;
  return (
    <AbsoluteFill style={{ background: c.bg, alignItems: "center", justifyContent: "center" }}>
      <Slam key={c.at} at={c.at} style={{ fontFamily: SANS, fontWeight: 800, fontSize: 118, letterSpacing: "-0.045em", color: c.fg, textAlign: "center", padding: "0 140px", lineHeight: 1.03 }}>
        {c.text}
      </Slam>
    </AbsoluteFill>
  );
}

function End() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 14 } });
  const b = spring({ frame: frame - f(0.5), fps, config: { damping: 18 } });
  const c = spring({ frame: frame - f(1.0), fps, config: { damping: 20 } });
  const fade = interpolate(frame, [durationInFrames - f(1), durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ background: CREAM, alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30, transform: `scale(${0.8 + 0.2 * a})`, opacity: a }}>
        <Img src={staticFile("logo.webp")} style={{ width: 140, height: 140 }} />
        <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 130, letterSpacing: "-0.055em", color: INK }}>HelloFugu</span>
      </div>
      <div style={{ marginTop: 48, padding: "18px 40px", borderRadius: 999, background: ORANGE, fontFamily: MONO, fontSize: 52, color: INK, opacity: b, transform: `translateY(${(1 - b) * 24}px)` }}>
        app.hellofugu.xyz
      </div>
      <div style={{ marginTop: 36, fontFamily: SANS, fontWeight: 500, fontSize: 34, color: "#57534e", opacity: c }}>
        BNB Chain testnet · Set and Earn, Oct 1 to Nov 5
      </div>
    </AbsoluteFill>
  );
}

const CAPTIONS: { text: string; from: number; to: number }[] = [
  { text: "This is HelloFugu, a marketplace for AI agents on BNB Chain.", from: 6.3, to: 8.9 },
  { text: "Every number links to a record you can check.", from: 9.1, to: 11.9 },
  { text: "Pick a job: health factor, yield, grid, rebalancing.", from: 12.2, to: 14.9 },
  { text: "Every agent is read from the ERC-8004 registry.", from: 15.0, to: 17.9 },
  { text: "Check it before you pay.", from: 18.2, to: 20.9 },
  { text: "Who owns it, its registry ID, and how it was made.", from: 21.0, to: 23.9 },
  { text: "Pick how long. Pay once. No token approval.", from: 24.2, to: 27.9 },
  { text: "The deposit is your spending limit.", from: 28.0, to: 31.9 },
  { text: "Watch it run, with the time left.", from: 32.2, to: 36.4 },
  { text: "Stop anytime. The unused part comes back.", from: 36.6, to: 41.9 },
];

const SCENES: Record<string, () => ReactNode> = {
  hook: () => <Hook />,
  logo: () => <Logo />,
  landing: () => <Landing />,
  catalogue: () => <Catalogue />,
  agent: () => <AgentPage />,
  hire: () => <Hire />,
  me: () => <MyAgents />,
  stats: () => <Stats />,
  end: () => <End />,
};

export function Launch() {
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Audio src={staticFile("launch/music.wav")} />
      <Impacts>
        {timeline.scenes.map((s) => (
          <Sequence key={s.id} from={f(s.start)} durationInFrames={f(s.end - s.start)} name={s.id}>
            {SCENES[s.id]!()}
          </Sequence>
        ))}
      </Impacts>
      {CAPTIONS.map((c) => (
        <Caption key={c.text} {...c} />
      ))}
    </AbsoluteFill>
  );
}
