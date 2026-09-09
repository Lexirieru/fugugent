import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import "./style.css";
import { SCENES } from "./script";
import durations from "../public/audio/durations.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1200;

/** A breath after each line, so the next one does not tread on it. */
const TAIL_SECONDS = 0.55;
const TITLE_SECONDS = 3.2;
/**
 * A short hold after the last line, so the closing card is still on screen when the
 * voice stops. It carries no caption: the sentence has already been said and read.
 */
const HOLD_SECONDS = 2.2;

const secondsFor = (id: string): number => (durations as Record<string, number>)[id] ?? 5;

function sceneFrames(id: string): number {
  return Math.round((secondsFor(id) + TAIL_SECONDS) * FPS);
}

export function demoDurationInFrames(): number {
  const body = SCENES.reduce((n, s) => n + sceneFrames(s.id), 0);
  return Math.round(TITLE_SECONDS * FPS) + body + Math.round(HOLD_SECONDS * FPS);
}

/**
 * The recorded page, held slightly larger than the frame and drifting in.
 *
 * The capture is 2880x1800 of a 1440x900 viewport, so there is real resolution to spare;
 * the scale here is a slow push rather than an upscale. Motion is a few percent because
 * the footage is already scrolling. Two moving things at once reads as a mistake.
 */
const Shot: React.FC<{ clip: string }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1.04, 1.0], {
    extrapolateRight: "clamp",
  });
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "var(--bg)", opacity: fade }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "50% 40%",
        }}
      >
        <OffthreadVideo
          src={staticFile(`capture/${clip}.mp4`)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
          muted
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The caption under each shot: the sentence being spoken, in the product's own type.
 *
 * It is there because a demo is watched muted more often than not, and because the
 * placeholder voice track should not be the only way to follow the argument.
 */
const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 0 56px" }}>
      <div
        style={{
          margin: "0 auto",
          maxWidth: 1360,
          padding: "20px 34px",
          borderRadius: 18,
          background: "rgba(241, 230, 225, 0.94)",
          border: "1px solid var(--border)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.14)",
          transform: `translateY(${interpolate(rise, [0, 1], [26, 0])}px)`,
          opacity: rise,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 34,
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            color: "var(--fg)",
            textAlign: "center",
          }}
        >
          {text}
        </p>
      </div>
    </AbsoluteFill>
  );
};

/** The opening card: the landing page's own eyebrow, headline and logo. */
const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const out = interpolate(frame, [TITLE_SECONDS * FPS - 14, TITLE_SECONDS * FPS], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "var(--bg)",
        alignItems: "center",
        justifyContent: "center",
        opacity: out,
      }}
    >
      <div style={{ textAlign: "center", transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`, opacity: enter }}>
        <Img src={staticFile("logo.webp")} style={{ width: 132, height: 132, borderRadius: 30, objectFit: "cover" }} />
        <p
          style={{
            fontFamily: "var(--font-hand)",
            fontSize: 34,
            color: "var(--accent-strong)",
            margin: "30px 0 10px",
          }}
        >
          an agent marketplace on BNB Chain
        </p>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 92,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: "var(--fg)",
            margin: 0,
          }}
        >
          Buy an agent like you buy an app.
        </h1>
      </div>
    </AbsoluteFill>
  );
};

/**
 * The closing card states the limitation rather than the pitch.
 *
 * That is the product's whole argument, so ending on it is not modesty; it is the demo.
 * Both numbers are checkable: nine listings on FuguRegistry, and exactly one agent that
 * has ever sent a transaction.
 */
const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });

  return (
    <AbsoluteFill
      style={{ background: "var(--bg)", alignItems: "center", justifyContent: "center", opacity: enter }}
    >
      <div style={{ textAlign: "center", maxWidth: 1320 }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 74,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            color: "var(--fg)",
            margin: "0 0 26px",
          }}
        >
          Nine agents listed. One has ever sent a transaction.
        </h2>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 34, color: "var(--fg-muted)", margin: "0 0 44px" }}>
          That sentence is on the site too.
        </p>
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 46,
            color: "var(--accent-strong)",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          hellofugu.xyz
        </p>
      </div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  let at = 0;
  const titleFrames = Math.round(TITLE_SECONDS * FPS);

  const body = SCENES.map((scene) => {
    const from = at + titleFrames;
    const frames = sceneFrames(scene.id);
    at += frames;
    return { scene, from, frames };
  });

  const outroFrom = titleFrames + at;

  return (
    <AbsoluteFill style={{ background: "var(--bg)" }}>
      <Sequence durationInFrames={titleFrames}>
        <Title />
      </Sequence>

      {body.map(({ scene, from, frames }) => (
        <Sequence key={scene.id} from={from} durationInFrames={frames}>
          {scene.id === "close" ? <Outro /> : <Shot clip={scene.id} />}
          {scene.id === "close" ? null : <Caption text={scene.say} />}
          <Audio src={staticFile(`audio/${scene.id}.mp3`)} />
        </Sequence>
      ))}

      {/*
        The music bed, under everything, for the whole film.
        `scripts/music.mjs` synthesises it rather than downloading a track: a demo video is
        the easiest place to inherit a licence nobody read, and this way there is nothing to
        attribute. It is mixed low on purpose. See the note in that file.
      */}
      <Audio src={staticFile("music.wav")} volume={0.5} />

      {/* The card stays up while the last sentence finishes landing. */}
      <Sequence from={outroFrom} durationInFrames={Math.round(HOLD_SECONDS * FPS)}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
