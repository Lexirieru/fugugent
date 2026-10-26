/**
 * A 30-second launch film in the dark, cinematic style of product-launch spots:
 * kinetic type over a perspective grid, a real 3D coin in a column of light, neon
 * keywords drawn by light beams and circuits, the product on floating screens, a
 * glowing feature ring, and a quiet end card.
 *
 * What it says is what the product does: hires are capped and revocable and public,
 * Guardian has repaid a live loan, Watch and Scout answer today. The screens are the
 * real app, captured by `scripts/capture-quest.mjs`. Cuts land on beats of the
 * synthesised track (`scripts/music-film.mjs`), both read from `timeline.json`.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "../launch/Launch";
import captured from "../quest/captured.json";
import { Coins } from "./Coin";
import timeline from "./timeline.json";

export const FPS = timeline.fps;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = Math.round(timeline.scenes[timeline.scenes.length - 1]!.end * FPS);

const ORANGE = "#f97316";
const AMBER = "#fbbf24";
const BG = "#050608";
const f = (s: number) => Math.round(s * FPS);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function useT() {
  return useCurrentFrame() / FPS;
}
const ease = (t: number, a: number, b: number, from = 0, to = 1, e = Easing.out(Easing.cubic)) => interpolate(t, [a, b], [from, to], { ...clamp, easing: e });

/** Fades a scene in and out at its edges so cuts never pop. */
function Scene({ children, style, fadeIn = 0.15, fadeOut = 0.15 }: { children: ReactNode; style?: CSSProperties; fadeIn?: number; fadeOut?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, Math.max(1, f(fadeIn)), durationInFrames - Math.max(1, f(fadeOut)), durationInFrames], [fadeIn ? 0 : 1, 1, 1, fadeOut ? 0 : 1], clamp);
  return <AbsoluteFill style={{ background: BG, opacity: o, fontFamily: SANS, color: "#fff", overflow: "hidden", ...style }}>{children}</AbsoluteFill>;
}

/** Text that sharpens out of a blur while it rises. */
function Reveal({ at = 0, children, style, blur = 14, rise = 24 }: { at?: number; children: ReactNode; style?: CSSProperties; blur?: number; rise?: number }) {
  const t = useT();
  const p = ease(t, at, at + 0.45, 0, 1);
  return <div style={{ opacity: p, filter: `blur(${(1 - p) * blur}px)`, transform: `translateY(${(1 - p) * rise}px)`, ...style }}>{children}</div>;
}

/** A floor of grid lines receding to a horizon, scrolling toward the camera. */
function Floor({ speed = 120, tilt = 74, top = "48%", opacity = 0.5, color = "255,255,255" }: { speed?: number; tilt?: number; top?: string; opacity?: number; color?: string }) {
  const t = useT();
  const line = `rgba(${color},${opacity})`;
  return (
    <div style={{ position: "absolute", inset: 0, perspective: 900, perspectiveOrigin: "50% 20%" }}>
      <div
        style={{
          position: "absolute",
          left: "-150%",
          width: "400%",
          top,
          height: "200%",
          transformOrigin: "50% 0",
          transform: `rotateX(${tilt}deg)`,
          backgroundImage: `linear-gradient(${line} 2px, transparent 2px), linear-gradient(90deg, ${line} 2px, transparent 2px)`,
          backgroundSize: "160px 160px",
          backgroundPosition: `0 ${(t * speed) % 160}px`,
          maskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 60%, transparent 100%)",
        }}
      />
    </div>
  );
}

/** Grey haze with a field of small crosses, the backdrop of the logo cards. */
function Haze({ drift = 0 }: { drift?: number }) {
  const t = useT();
  const x = 70 + Math.sin(t * 0.6) * 4 + drift;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at ${x}% 95%, rgba(210,210,215,0.55) 0%, rgba(90,90,95,0.25) 40%, transparent 70%), #0b0b0d` }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
        <defs>
          <pattern id="cross" width="240" height="240" patternUnits="userSpaceOnUse">
            <path d="M120 112 L120 128 M112 120 L128 120" stroke="#fff" strokeWidth="2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cross)" />
      </svg>
    </AbsoluteFill>
  );
}

function LogoTile({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: "#121e29", border: "2px solid rgba(255,255,255,0.14)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12)", overflow: "hidden", display: "flex" }}>
      <Img src={staticFile("film/maskot.svg")} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

const neon = (c: string): CSSProperties => ({
  fontWeight: 800,
  letterSpacing: "-0.03em",
  backgroundImage: `linear-gradient(180deg, #fff 20%, ${c} 140%)`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  filter: `drop-shadow(0 0 18px ${c}) drop-shadow(0 0 2px #fff)`,
});

// ── Scenes ───────────────────────────────────────────────────────────────────────

function Hook() {
  const t = useT();
  const first = ["Watching", "a", "DeFi", "loan"];
  const second = ["all", "night", "is", "a"];
  const words = t < 1 ? first : second;
  const base = t < 1 ? 0.05 : 1;
  return (
    <Scene fadeIn={0} fadeOut={0}>
      <div style={{ position: "absolute", left: "50%", bottom: -380, width: 1400, height: 600, transform: "translateX(-50%)", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.35), transparent)", filter: "blur(30px)" }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 300 }}>
        <div style={{ display: "flex", gap: 22, fontSize: 64, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {words.map((w, i) => (
            <Reveal key={`${t < 1}${w}${i}`} at={base + i * 0.17} blur={10} rise={10} style={{ color: i >= 2 ? "#a1a1aa" : "#fff" }}>
              {w}
            </Reveal>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Pain() {
  const t = useT();
  const x = interpolate(t, [0, 1.5], [120, -60]);
  const p = ease(t, 0, 0.35);
  return (
    <Scene fadeIn={0}>
      <Floor speed={260} tilt={70} top="30%" opacity={0.22} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1200 }}>
        <div
          style={{
            fontSize: 420,
            fontWeight: 700,
            letterSpacing: "-0.05em",
            transform: `translateX(${x}px) rotateX(18deg) rotateY(-10deg) scale(${1.25 - 0.25 * p})`,
            filter: `blur(${(1 - p) * 16}px)`,
            backgroundImage: "linear-gradient(180deg, #ffffff 30%, #6b7280 100%)",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          a pain.
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

/** The brand's idea in the dark: the fish puffs up as the loan's health factor falls. */
function Risk() {
  const t = useT();
  const streak = ease(t, 0, 0.75, 0, 1, Easing.in(Easing.quad));
  const hf = interpolate(t, [0.7, 2.0], [1.62, 1.04], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const level = hf >= 1.5 ? 1 : hf >= 1.35 ? 2 : hf >= 1.2 ? 3 : hf >= 1.1 ? 4 : 5;
  const appear = ease(t, 0.55, 0.9);
  const shake = level >= 4 ? Math.sin(t * 60) * (level - 3) * 3 : 0;
  const red = interpolate(hf, [1.04, 1.62], [1, 0], clamp);
  const flash = ease(t, 2.15, 2.5, 0, 1, Easing.in(Easing.quad));
  return (
    <Scene>
      <Floor speed={60} tilt={66} top="42%" opacity={0.28} />
      {/* A light streak racing across the floor. */}
      <div style={{ position: "absolute", left: `${-20 + streak * 140}%`, top: `${30 + streak * 40}%`, width: 420, height: 6, borderRadius: 6, transform: "rotate(28deg)", background: "linear-gradient(90deg, transparent, #fff)", boxShadow: "0 0 30px 6px rgba(255,255,255,0.6)", opacity: streak < 1 ? 1 : 0 }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 600, width: 700, height: 180, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(239,68,68,${0.15 + red * 0.6}), transparent)`, filter: "blur(10px)" }} />
        <div style={{ opacity: appear, transform: `translate(${shake}px, ${(1 - appear) * 80 - 40}px) scale(${0.8 + level * 0.07})` }}>
          <Img src={staticFile(`film/guardian-${level}.svg`)} style={{ width: 420, height: 420, filter: `drop-shadow(0 0 ${20 + red * 50}px rgba(239,68,68,${0.3 + red * 0.6}))` }} />
        </div>
        <div style={{ position: "absolute", top: 180, opacity: appear, fontFamily: MONO, fontSize: 34, color: "#a1a1aa" }}>
          health factor <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 72, color: `rgb(${255}, ${Math.round(255 - red * 170)}, ${Math.round(255 - red * 170)})` }}>{hf.toFixed(2)}</span>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.9 }} />
    </Scene>
  );
}

/** A column of orange light, the coin's stage. */
function Column({ width = 560, strength = 1 }: { width?: number; strength?: number }) {
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ width, height: "100%", background: `linear-gradient(90deg, rgba(249,115,22,0) 0%, rgba(249,115,22,${0.55 * strength}) 12%, rgba(253,186,116,${0.85 * strength}) 50%, rgba(249,115,22,${0.55 * strength}) 88%, rgba(249,115,22,0) 100%)`, boxShadow: `0 0 160px 40px rgba(249,115,22,${0.35 * strength})` }} />
    </AbsoluteFill>
  );
}

function Coin() {
  const t = useT();
  const col = ease(t, 0.3, 0.9);
  return (
    <Scene fadeIn={0.1}>
      <Floor speed={40} tilt={66} top="42%" opacity={0.2 * (1 - col)} />
      <div style={{ position: "absolute", inset: 0, opacity: col }}>
        <Column strength={col} />
      </div>
      <Coins
        poses={(s) => {
          const up = ease(s, 0, 0.9, 0, 1, Easing.out(Easing.back(1.3)));
          return [{ y: -0.9 + up * 0.9, rx: (-Math.PI / 2) * (1 - up) + 0.12, ry: -0.5 + up * 0.5 + Math.sin(s * 2.2) * 0.35, scale: 0.75 + up * 0.25 }];
        }}
      />
    </Scene>
  );
}

function Meet() {
  const t = useT();
  const meetOut = ease(t, 0.85, 1.15);
  const slide = ease(t, 0.85, 1.3);
  return (
    <Scene fadeIn={0.12}>
      <Haze />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30, transform: `translateX(${-110 * slide + 110}px)` }}>
          <Reveal at={0.1} style={{ fontSize: 84, fontWeight: 500, color: "#d4d4d8", opacity: 1 - meetOut, width: 220 * (1 - slide), overflow: "hidden", whiteSpace: "nowrap" }}>
            Meet
          </Reveal>
          <Reveal at={0.3}>
            <LogoTile size={120} />
          </Reveal>
          <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: "-0.04em", opacity: slide, filter: `blur(${(1 - slide) * 12}px)`, transform: `translateX(${(1 - slide) * 40}px)` }}>HelloFugu</div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

/** A keyword drawn by a beam of light: the beam crosses the frame, the word lights up behind it. */
function Capped() {
  const t = useT();
  const head = ease(t, 0, 0.45, -10, 62, Easing.out(Easing.quad));
  const word = ease(t, 0.25, 0.6);
  return (
    <Scene fadeIn={0.05}>
      <Floor speed={30} tilt={72} top="56%" opacity={0.14} color="251,146,60" />
      <div style={{ position: "absolute", top: 560, left: 0, width: `${head}%`, height: 8, background: `linear-gradient(90deg, transparent, ${ORANGE} 50%, #fff)`, boxShadow: `0 0 40px 10px rgba(249,115,22,0.6)`, borderRadius: 8 }} />
      <div style={{ position: "absolute", top: 520, left: `calc(${head}% - 50px)`, width: 100, height: 90, borderRadius: "50%", background: "radial-gradient(closest-side, #fff, rgba(249,115,22,0.8), transparent)" }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 300 }}>
        <div style={{ ...neon(ORANGE), fontSize: 190, fontStyle: "italic", opacity: word, transform: `translateX(${(1 - word) * -60}px)` }}>Capped</div>
        <div style={{ opacity: ease(t, 0.5, 0.8), fontSize: 38, color: "#d4d4d8", marginTop: 150 }}>Every hire is a set deposit. Never more.</div>
      </AbsoluteFill>
    </Scene>
  );
}

/** A keyword traced by circuit lines whose nodes light up as the signal passes. */
function Circuit({ word, sub, color, dashed = false, len }: { word: string; sub: string; color: string; dashed?: boolean; len: number }) {
  const t = useT();
  const draw = ease(t, 0, len * 0.6, 0, 1, Easing.inOut(Easing.quad));
  const path = "M -20 300 L 820 300 L 820 120 L 1000 120 M 820 300 L 820 470 L 700 470 M 820 470 L 820 640 L 1300 640 L 1300 760 L 1940 760 M 820 640 L 700 640 M 1000 120 L 1180 120 L 1180 360 L 1940 360";
  const nodes: [number, number, number][] = [
    [820, 120, 0.25],
    [820, 300, 0.2],
    [820, 470, 0.4],
    [700, 470, 0.5],
    [820, 640, 0.6],
    [700, 640, 0.7],
  ];
  return (
    <Scene fadeIn={0.05}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 70% 80%, #26262b 0%, #050608 60%)" }} />
      <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`glow-${word}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={path} fill="none" stroke={dashed ? color : "rgba(255,255,255,0.85)"} strokeWidth={dashed ? 4 : 5} strokeDasharray={dashed ? "16 12" : "4000"} strokeDashoffset={dashed ? -t * 60 : 4000 * (1 - draw)} opacity={dashed ? draw : 1} filter={`url(#glow-${word})`} strokeLinejoin="round" />
        {nodes.map(([x, y, at], i) => {
          const lit = ease(draw, at, at + 0.15);
          return <rect key={i} x={x - 26} y={y - 26} width={52} height={52} rx={12} fill={lit > 0.5 ? color : "#0b0b0d"} fillOpacity={lit > 0.5 ? 0.85 : 1} stroke={lit > 0.5 ? "#fff" : "rgba(255,255,255,0.7)"} strokeWidth={4} filter={lit > 0.5 ? `url(#glow-${word})` : undefined} />;
        })}
      </svg>
      <div style={{ position: "absolute", left: 90, top: 70, opacity: ease(t, 0.15, 0.5), transform: `translateX(${(1 - ease(t, 0.15, 0.5)) * -40}px)` }}>
        <div style={{ ...neon(color), fontSize: 128 }}>{word}</div>
      </div>
      <div style={{ position: "absolute", left: 1000, top: 860, fontSize: 38, color: "#d4d4d8", opacity: ease(t, 0.5, 0.85) }}>{sub}</div>
    </Scene>
  );
}

type Shot = keyof typeof captured.shots;
type Box = { x: number; y: number; w: number; h: number };

/** The real app on a floating screen, pushing in toward the element that matters. */
function Screen({ title, shot, focus, len, tint }: { title: string; shot: Shot; focus: Box; len: number; tint: string }) {
  const t = useT();
  const s = captured.shots[shot] as { file: string; width: number; height: number };
  const W = 1180;
  const k = W / s.width;
  const push = ease(t, 0.15, len, 1.05, 1.55, Easing.inOut(Easing.cubic));
  const origin = `${((focus.x + focus.w / 2) / s.width) * 100}% ${((focus.y + focus.h / 2) / s.height) * 100}%`;
  const enter = spring({ frame: f(t), fps: FPS, config: { damping: 18, stiffness: 120 } });
  return (
    <Scene fadeIn={0.1}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 120%, ${tint} 0%, #050608 65%)` }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 90 }}>
        <Reveal at={0.05} style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.03em" }}>
          {title}
        </Reveal>
        <div style={{ marginTop: 50, perspective: 1600 }}>
          <div style={{ transform: `translateY(${(1 - enter) * 160}px) rotateX(${(1 - enter) * 18 + 6}deg)`, opacity: enter, width: W, borderRadius: 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.18)", boxShadow: `0 60px 140px -40px ${tint}, 0 0 0 10px rgba(255,255,255,0.03)`, background: "#111" }}>
            <div style={{ height: 40, background: "#18181b", display: "flex", alignItems: "center", gap: 9, padding: "0 18px" }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
              ))}
              <span style={{ marginLeft: 20, fontFamily: MONO, fontSize: 18, color: "#71717a" }}>app.hellofugu.xyz</span>
            </div>
            <div style={{ width: W, height: s.height * k, overflow: "hidden" }}>
              <Img src={staticFile(s.file)} style={{ width: W, height: s.height * k, transform: `scale(${push})`, transformOrigin: origin }} />
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

const FEATURES = [
  { name: "Guardian", line: "Repays a loan before it can be liquidated", kind: "guardian", color: "#38bdf8", from: "left" },
  { name: "Watch", line: "Tells you how safe a loan is", kind: "meter", color: "#a3e635", from: "bottom" },
  { name: "Scout", line: "Finds agents on the ERC-8004 registry", kind: "broker", color: "#e879f9", from: "top" },
] as const;

/** A glowing segmented ring around a fish; each feature sweeps in with its own colour. */
function Ring() {
  const t = useT();
  const step = 4 / FEATURES.length;
  const i = Math.min(FEATURES.length - 1, Math.floor(t / step));
  const feat = FEATURES[i]!;
  const local = t - i * step;
  const sweep = ease(local, 0, 0.45, 0, 1, Easing.out(Easing.cubic));
  const out = ease(local, step - 0.25, step, 0, 1, Easing.in(Easing.cubic));
  const spin = t * 18;
  const cx = 760;
  const cy = 540;
  const R = 230;
  const arc = (a0: number, a1: number, r: number) => {
    const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const shape: Record<string, CSSProperties> = {
    left: { left: -200 + (1 - sweep) * -900 + out * -900, top: 180, width: 900, height: 720, transform: "skewX(-18deg)" },
    bottom: { right: -100, bottom: -300 + (1 - sweep) * -600 + out * -600, width: 1100, height: 560, transform: "skewY(-12deg)" },
    top: { right: -150, top: -280 + (1 - sweep) * -600 + out * -600, width: 1000, height: 560, transform: "skewY(10deg)" },
  };
  const label: Record<string, CSSProperties> = {
    left: { left: 150, top: 470, textAlign: "left" },
    bottom: { right: 160, bottom: 140, textAlign: "right" },
    top: { right: 160, top: 120, textAlign: "right" },
  };
  return (
    <Scene>
      <div style={{ position: "absolute", borderRadius: 120, background: `linear-gradient(135deg, ${feat.color}, #1e1b4b)`, opacity: 0.55, filter: "blur(2px)", ...shape[feat.from] }} />
      <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="ringglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <g transform={`rotate(${spin} ${cx} ${cy})`}>
          {[0, 90, 180, 270].map((a, k) => {
            const on = k === i || (i === 2 && k === 3);
            return (
              <g key={a}>
                <path d={arc(a + 6, a + 84, R)} stroke={on ? feat.color : "#27272a"} strokeWidth={on ? 70 : 64} fill="none" opacity={on ? 0.9 : 1} filter={on ? "url(#ringglow)" : undefined} />
                <path d={arc(a + 6, a + 84, R)} stroke={on ? feat.color : "#18181b"} strokeWidth={60} fill="none" strokeLinecap="round" opacity={on ? 0.95 : 1} />
                <path d={arc(a + 8, a + 82, R + 28)} stroke="rgba(255,255,255,0.18)" strokeWidth={2} fill="none" />
              </g>
            );
          })}
        </g>
        <circle cx={cx} cy={cy} r={150} fill="#0b0b0d" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
      </svg>
      <Img src={staticFile(`film/${feat.kind}-1.svg`)} style={{ position: "absolute", left: cx - 120, top: cy - 120, width: 240, height: 240, opacity: ease(local, 0, 0.3) * (1 - out) }} />
      <div style={{ position: "absolute", width: 640, opacity: sweep * (1 - out), ...label[feat.from] }}>
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: "-0.04em" }}>{feat.name}</div>
        <div style={{ fontSize: 36, color: "#e4e4e7", marginTop: 6 }}>{feat.line}</div>
      </div>
    </Scene>
  );
}

function Closeup() {
  return (
    <Scene fadeIn={0.1}>
      <AbsoluteFill style={{ background: "linear-gradient(90deg, #7c2d12 0%, #fb923c 30%, #fdba74 55%, #ea580c 100%)" }} />
      <Column width={760} strength={0.8} />
      <Coins fov={28} poses={(s) => [{ x: 0.1, rx: 0.35 - s * 0.12, ry: -0.65 + s * 0.45, rz: 0.15, scale: 1.55 + s * 0.12 }]} />
    </Scene>
  );
}

function Powered() {
  const t = useT();
  return (
    <Scene fadeIn={0.1}>
      {/* A cone of light from above. */}
      <div style={{ position: "absolute", left: 560, top: -40, width: 800, height: 1160, clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)", background: "linear-gradient(180deg, rgba(249,115,22,0.35), rgba(253,186,116,0.95))", filter: "blur(4px)" }} />
      <Coins
        poses={(s) => [
          { x: -1.25, y: 0.55 - s * 0.1, rx: 0.5, ry: -0.6 + s * 0.6, scale: 0.42 },
          { x: 1.35, y: 0.35 - s * 0.14, rx: 0.3, ry: 0.8 - s * 0.5, scale: 0.36 },
          { x: 0.05, y: -0.75 - s * 0.08, rx: 0.6, ry: 0.3 + s * 0.4, scale: 0.6 },
        ]}
      />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 110 }}>
        <Reveal at={0.1} style={{ fontSize: 46, fontWeight: 500, color: "#1c1917" }}>
          Registered on
        </Reveal>
        <Reveal at={0.25} style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.03em", color: "#0b0b0b" }}>
          ERC-8004
        </Reveal>
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 80, width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 18, opacity: ease(t, 0.6, 1), fontSize: 36, fontWeight: 600 }}>
        <Img src={staticFile("film/bnb-chain.svg")} style={{ width: 54, height: 54 }} />
        Built on BNB Chain
      </div>
    </Scene>
  );
}

function End() {
  return (
    <Scene fadeIn={0.2} fadeOut={0.6}>
      <Haze />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 120 }}>
        <Reveal at={0.15} style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LogoTile size={110} />
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: "-0.04em" }}>HelloFugu</div>
          <div style={{ fontSize: 26, color: "#a1a1aa", lineHeight: 1.2, marginLeft: 6 }}>
            DeFi agents
            <br />
            you can hire
          </div>
        </Reveal>
        <Reveal at={0.6} style={{ textAlign: "center", fontFamily: MONO, letterSpacing: "0.12em" }}>
          <div style={{ fontSize: 22, color: "#71717a" }}>GET STARTED</div>
          <div style={{ fontSize: 30, color: "#fff", marginTop: 12 }}>APP.HELLOFUGU.XYZ</div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
}

const len = (id: string) => {
  const s = timeline.scenes.find((x) => x.id === id)!;
  return s.end - s.start;
};
const SCENES: Record<string, () => ReactNode> = {
  hook: () => <Hook />,
  pain: () => <Pain />,
  risk: () => <Risk />,
  coin: () => <Coin />,
  meet: () => <Meet />,
  capped: () => <Capped />,
  revocable: () => <Circuit word="Revocable" sub="Cancel any time. The rest comes back." color="#60a5fa" len={len("revocable")} />,
  onchain: () => <Circuit word="On chain" sub="Every hire and rating is public." color={AMBER} dashed len={len("onchain")} />,
  hire: () => <Screen title="Hire in one signature" shot="watch-hire" focus={captured.shots["watch-hire"].hire} len={len("hire")} tint="#7c2d12" />,
  found: () => <Screen title="See what it found" shot="me-found" focus={captured.shots["me-found"].found} len={len("found")} tint="#14532d" />,
  builders: () => <Screen title="List your own agent" shot="checklist" focus={captured.shots.checklist.score} len={len("builders")} tint="#1e3a8a" />,
  ring: () => <Ring />,
  closeup: () => <Closeup />,
  powered: () => <Powered />,
  end: () => <End />,
};

export function Film() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Audio src={staticFile("film/music.wav")} />
      {timeline.scenes.map((s) => (
        <Sequence key={s.id} from={f(s.start)} durationInFrames={f(s.end - s.start)} name={s.id}>
          {SCENES[s.id]!()}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
