/**
 * The Set and Earn film: 48 seconds that walk a newcomer from /quest to a two-cent hire,
 * what the agent found for them, the rating after, and the builder's checklist.
 *
 * Same machinery as the launch film (`../launch/Launch.tsx`): 2x stills of the real
 * site, a camera and cursor done here, cuts on the impacts in `timeline.json`. The hire,
 * /me and the rating were recorded on an anvil fork, so no real transaction is shown as
 * if it were one. The call to action is to try it, not to farm it.
 */
import type { ReactNode } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CREAM,
  Caption,
  Cursor,
  Enter,
  HEIGHT,
  INK,
  Impacts,
  type Key,
  MID,
  MONO,
  ORANGE,
  SANS,
  type Shot,
  ShotImg,
  Slam,
  Stage,
  WIDTH,
  center,
  track,
  useT,
} from "../launch/Launch";
import captured from "./captured.json";
import timeline from "./timeline.json";

export { WIDTH, HEIGHT };
export const FPS = timeline.fps;
export const DURATION = Math.round(timeline.scenes[timeline.scenes.length - 1]!.end * FPS);

type Box = { x: number; y: number; w: number; h: number };
const SHOTS = captured.shots as unknown as Record<string, Shot>;
const box = (shot: string, key: string) => SHOTS[shot]![key] as Box;
const f = (s: number) => Math.round(s * FPS);
const Img2 = (p: { name: string; scroll?: number }) => <ShotImg {...p} shots={SHOTS} />;

function Hook() {
  const t = useT();
  const lines: { at: number; text: ReactNode }[] = [
    { at: 0, text: "Set and Earn is live." },
    { at: 1, text: "Hire 3 agents. Build 1." },
    { at: 2, text: "The first 100 wallets get merch." },
    { at: 3, text: <span style={{ color: ORANGE, fontSize: 180 }}>Start here.</span> },
  ];
  const current = [...lines].reverse().find((l) => t >= l.at)!;
  return (
    <AbsoluteFill style={{ background: INK, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 50%, rgba(234,88,12,0.2), transparent 60%)" }} />
      <Slam key={current.at} at={current.at} style={{ fontFamily: SANS, fontWeight: 800, fontSize: 124, color: "#fff", letterSpacing: "-0.045em", textAlign: "center", padding: "0 120px", lineHeight: 1.03 }}>
        {current.text}
      </Slam>
    </AbsoluteFill>
  );
}

function QuestPage() {
  const t = useT();
  const reg = center(box("quest-page", "register"));
  const fau = center(box("quest-page", "faucet"));
  const [scroll] = track(t, [{ t: 0, v: [0] }, { t: 2.6, v: [0] }, { t: 3.4, v: [140] }]) as [number];
  const [z, x, py] = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.4, v: [1, MID.x, MID.y] },
    { t: 1.4, v: [1.8, reg.x - 120, reg.y] },
    { t: 2.6, v: [1.8, reg.x - 120, reg.y] },
    { t: 3.6, v: [1.8, fau.x - 120, fau.y] },
    { t: 5.0, v: [1.8, fau.x - 120, fau.y] },
    { t: 5.9, v: [1.2, MID.x, fau.y + 120] },
  ]) as [number, number, number];
  const lift = interpolate(t, [0, 0.6], [80, 0], { extrapolateRight: "clamp" });
  return (
    <Stage cam={[z, x, py - scroll]} url="app.hellofugu.xyz/quest" lift={lift}>
      <Img2 name="quest-page" scroll={scroll} />
    </Stage>
  );
}

function Pick() {
  const t = useT();
  const picks = center(box("quest-page", "picks"));
  const watch = center(box("quest-page", "watch"));
  const scroll = 420;
  const cam = track(t, [
    { t: 0, v: [1.15, MID.x, picks.y - scroll] },
    { t: 1.0, v: [1.45, picks.x, picks.y - scroll] },
    { t: 2.2, v: [1.45, picks.x, picks.y - scroll] },
    { t: 3.0, v: [1.9, watch.x, watch.y - scroll] },
  ]);
  const path: Key[] = [
    { t: 0, v: [1100, 700] },
    { t: 1.0, v: [1100, 700] },
    { t: 2.4, v: [watch.x - 40, watch.y - scroll + 4] },
  ];
  return (
    <Enter kind="whip">
      <Stage cam={cam} url="app.hellofugu.xyz/quest">
        <Img2 name="quest-page" scroll={scroll} />
        <Cursor t={t} path={path} clicks={[2.7]} />
      </Stage>
    </Enter>
  );
}

function Hire() {
  const t = useT();
  const cost = center(box("watch-hire", "cost"));
  const btn = center(box("watch-hire", "hire"));
  const done = box("watch-hired", "done");
  const doneAt = { x: done.x + 230, y: done.y + done.h / 2 };
  const after = t >= 2.6;
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.3, v: [1, MID.x, MID.y] },
    { t: 1.1, v: [1.9, cost.x + 40, cost.y] },
    { t: 1.6, v: [1.9, cost.x + 40, cost.y] },
    { t: 2.2, v: [1.9, btn.x + 60, btn.y] },
    { t: 2.6, v: [1.9, btn.x + 60, btn.y] },
    { t: 3.3, v: [1.9, doneAt.x, doneAt.y] },
    { t: 5.4, v: [1.6, doneAt.x, doneAt.y] },
  ]);
  const path: Key[] = [
    { t: 0, v: [1000, 520] },
    { t: 1.6, v: [1000, 520] },
    { t: 2.2, v: [btn.x + 10, btn.y + 6] },
    { t: 2.8, v: [btn.x + 10, btn.y + 6] },
    { t: 3.6, v: [doneAt.x + 280, doneAt.y + 120] },
  ];
  return (
    <Enter kind="slam">
      <Stage cam={cam} url="app.hellofugu.xyz/agent/97:2513#hire">
        <Img2 name={after ? "watch-hired" : "watch-hire"} />
        <Cursor t={t} path={path} clicks={[2.4]} />
      </Stage>
    </Enter>
  );
}

function Found() {
  const t = useT();
  const found = box("me-found", "found");
  const foundAt = { x: found.x + 200, y: found.y + found.h / 2 };
  const cd = center(box("me-found", "countdown"));
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.3, v: [1, MID.x, MID.y] },
    { t: 1.2, v: [2.1, cd.x + 80, cd.y] },
    { t: 2.6, v: [2.1, cd.x + 80, cd.y] },
    { t: 3.4, v: [2.3, foundAt.x, foundAt.y] },
  ]);
  return (
    <Enter kind="whip">
      <Stage cam={cam} url="app.hellofugu.xyz/me">
        <Img2 name="me-found" />
      </Stage>
    </Enter>
  );
}

function Rate() {
  const t = useT();
  const gate = box("gate", "gate");
  const release = center(box("gate", "release"));
  const five = center(box("gate-stars", "five"));
  const rate = center(box("gate-stars", "rate"));
  const hire = center(box("gate-open", "hire"));
  const shot = t < 2.5 ? "gate" : t < 4.6 ? "gate-stars" : "gate-open";
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.3, v: [1, MID.x, MID.y] },
    { t: 1.1, v: [1.55, gate.x + gate.w / 2, gate.y + gate.h / 2] },
    { t: 1.6, v: [1.55, gate.x + gate.w / 2, gate.y + gate.h / 2] },
    { t: 2.4, v: [2.0, release.x, release.y] },
    { t: 2.6, v: [2.0, five.x + 60, five.y] },
    { t: 4.4, v: [2.0, rate.x - 40, rate.y] },
    { t: 4.7, v: [1.9, hire.x + 40, hire.y] },
  ]);
  const path: Key[] = [
    { t: 0, v: [1000, 640] },
    { t: 1.6, v: [release.x + 10, release.y + 6] },
    { t: 2.4, v: [release.x + 10, release.y + 6] },
    { t: 3.2, v: [five.x, five.y + 4] },
    { t: 3.7, v: [rate.x, rate.y + 4] },
    { t: 4.6, v: [rate.x, rate.y + 4] },
    { t: 5.4, v: [hire.x + 10, hire.y + 6] },
  ];
  return (
    <Enter kind="slam">
      <Stage cam={cam} url="app.hellofugu.xyz/agent/97:2514">
        <Img2 name={shot} />
        <Cursor t={t} path={path} clicks={[2.0, 3.25, 4.2]} />
      </Stage>
    </Enter>
  );
}

function Build() {
  const t = useT();
  const card = box("checklist", "card");
  const score = center(box("checklist", "score"));
  const cam = track(t, [
    { t: 0, v: [1, MID.x, MID.y] },
    { t: 0.3, v: [1, MID.x, MID.y] },
    { t: 1.2, v: [2.2, score.x + 120, score.y + 40] },
    { t: 2.8, v: [2.2, score.x + 120, score.y + 40] },
    { t: 4.0, v: [1.35, card.x + card.w / 2, card.y + card.h / 2 - 40] },
  ]);
  return (
    <Enter kind="whip">
      <Stage cam={cam} url="app.hellofugu.xyz/agent/97:2545#quest">
        <Img2 name="checklist" />
      </Stage>
    </Enter>
  );
}

function Cta() {
  const t = useT();
  const cards = [
    { at: 0, text: "Hire 3.", bg: INK, fg: "#fff" },
    { at: 1.5, text: "Build 1.", bg: ORANGE, fg: INK },
    { at: 3.0, text: "Get the merch.", bg: INK, fg: "#fff" },
  ];
  const c = [...cards].reverse().find((x) => t >= x.at)!;
  return (
    <AbsoluteFill style={{ background: c.bg, alignItems: "center", justifyContent: "center" }}>
      <Slam key={c.at} at={c.at} style={{ fontFamily: SANS, fontWeight: 800, fontSize: 200, letterSpacing: "-0.05em", color: c.fg }}>
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
        <Img src={staticFile("logo.webp")} style={{ width: 130, height: 130 }} />
        <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 120, letterSpacing: "-0.055em", color: INK }}>HelloFugu</span>
      </div>
      <div style={{ marginTop: 48, padding: "18px 40px", borderRadius: 999, background: ORANGE, fontFamily: MONO, fontSize: 52, color: INK, opacity: b, transform: `translateY(${(1 - b) * 24}px)` }}>
        app.hellofugu.xyz/quest
      </div>
      <div style={{ marginTop: 36, fontFamily: SANS, fontWeight: 500, fontSize: 34, color: "#57534e", opacity: c, textAlign: "center", lineHeight: 1.5 }}>
        Set and Earn runs until Nov 5 · BNB Chain testnet, so a hire costs cents
      </div>
    </AbsoluteFill>
  );
}

const CAPTIONS: { text: string; from: number; to: number }[] = [
  { text: "Everything you need is on one page.", from: 4.3, to: 6.9 },
  { text: "Register your wallet, then get free testnet BNB.", from: 7.0, to: 9.9 },
  { text: "Start with an agent that costs two cents.", from: 10.2, to: 13.9 },
  { text: "Pick how long. One signature. No token approval.", from: 14.2, to: 17.4 },
  { text: "Your deposit is your spending limit.", from: 17.5, to: 19.9 },
  { text: "While it runs, it works for you.", from: 20.2, to: 22.9 },
  { text: "Fugu Watch reads your loan and says how safe it is.", from: 23.0, to: 25.9 },
  { text: "When it ends, rate it. The rating lives on chain.", from: 26.2, to: 29.4 },
  { text: "Then your next hire opens up.", from: 29.5, to: 31.9 },
  { text: "Built your own agent? List it on HelloFugu.", from: 32.2, to: 34.9 },
  { text: "See which of BNB Chain's six checks it already passes.", from: 35.0, to: 37.9 },
];

const SCENES: Record<string, () => ReactNode> = {
  hook: () => <Hook />,
  quest: () => <QuestPage />,
  pick: () => <Pick />,
  hire: () => <Hire />,
  found: () => <Found />,
  rate: () => <Rate />,
  build: () => <Build />,
  cta: () => <Cta />,
  end: () => <End />,
};

export function Quest() {
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Audio src={staticFile("quest/music.wav")} />
      <Impacts at={timeline.impacts}>
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
