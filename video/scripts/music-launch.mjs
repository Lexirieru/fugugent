#!/usr/bin/env node
/**
 * The launch film's music, synthesised from scratch as a WAV (no licence to track).
 *
 * Upbeat and plain, the way short SaaS launch films sound: four-on-the-floor kick,
 * claps on two and four, off-beat hats, an off-beat bass, short chord stabs. It reads
 * `src/launch/timeline.json`, so a riser builds into every big cut and an impact lands
 * exactly on it. Change the edit there and rerun this; nothing else needs touching.
 *
 *   node scripts/music-launch.mjs   ->  public/launch/music.wav
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(ROOT, "src/launch/timeline.json"), "utf8"));
const RATE = 48_000;
const BEAT = 60 / T.bpm;
const LENGTH = T.scenes.at(-1).end;
const n = Math.ceil(LENGTH * RATE);
const L = new Float32Array(n);
const R = new Float32Array(n);

/** Deterministic noise, so a rerun produces the same file. */
let seed = 7;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

function add(t0, dur, fn, gain = 1, pan = 0) {
  const s0 = Math.floor(t0 * RATE);
  const len = Math.floor(dur * RATE);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < len && s0 + i < n; i++) {
    if (s0 + i < 0) continue;
    const v = fn(i / RATE);
    L[s0 + i] += v * gl;
    R[s0 + i] += v * gr;
  }
}

const kick = (t) => Math.sin(2 * Math.PI * (45 * t + 90 * (1 - Math.exp(-t * 28)) / 28)) * Math.exp(-t * 7);
const clap = (t) => noise() * Math.exp(-t * 22) * (t < 0.012 || (t > 0.018 && t < 0.03) || t > 0.036 ? 1 : 0.3);
const hat = (t) => noise() * Math.exp(-t * 90);
const sub = (f) => (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 200) * Math.exp(-t * 5);
const pluck = (f) => (t) => {
  let v = 0;
  for (let k = 1; k <= 4; k++) v += Math.sin(2 * Math.PI * f * k * t) / k;
  return v * Math.exp(-t * 9) * Math.min(1, t * 400);
};
const pad = (fs) => (t) => fs.reduce((v, f) => v + Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.003 * t), 0) / fs.length;

// A minor, F, C, G: bright enough to feel like a launch, not a ballad.
const CHORDS = [
  { root: 55.0, notes: [220.0, 261.63, 329.63] },
  { root: 43.65, notes: [174.61, 220.0, 261.63] },
  { root: 65.41, notes: [261.63, 329.63, 392.0] },
  { root: 49.0, notes: [196.0, 246.94, 293.66] },
];
const BAR = 4 * BEAT;
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];

const sceneOf = (t) => T.scenes.find((s) => t >= s.start && t < s.end)?.id ?? "end";
const full = (t) => !["hook", "end"].includes(sceneOf(t));

for (let b = 0; b * BEAT < LENGTH; b++) {
  const t = b * BEAT;
  const scene = sceneOf(t);
  const inBar = b % 4;
  // The hook keeps a kick on every second beat, the outro thins out to nothing.
  if (scene === "hook") {
    if (inBar % 2 === 0) add(t, 0.5, kick, 0.9);
    continue;
  }
  if (scene === "end") {
    if (t < T.scenes.at(-1).start + 2 * BAR && inBar === 0) add(t, 0.6, kick, 0.7);
    continue;
  }
  add(t, 0.5, kick, 0.95);
  if (inBar === 1 || inBar === 3) add(t, 0.25, clap, 0.32, 0.1);
  add(t + BEAT / 2, 0.08, hat, 0.13, -0.3);
  if (b % 2 === 1) add(t + BEAT * 0.75, 0.05, hat, 0.07, 0.35);
  const c = chordAt(t);
  add(t + BEAT / 2, BEAT / 2, sub(c.root * 2), 0.42);
  if (inBar === 0 || inBar === 2) for (const f of c.notes) add(t + BEAT / 2, 0.4, pluck(f), 0.06, 0.25);
}

// A quiet pad under the whole thing, and on its own in the outro.
for (let b = 0; b * BAR < LENGTH; b++) {
  const t = b * BAR;
  const c = chordAt(t);
  add(t, BAR, (x) => pad(c.notes)(x) * Math.sin((Math.PI * Math.min(x, BAR)) / BAR) ** 0.6, full(t) ? 0.045 : 0.08);
}

// Risers into the big cuts: rising filtered noise plus a rising tone.
for (const at of T.risers) {
  const end = T.impacts.find((i) => i > at) ?? at + 2;
  const dur = end - at;
  add(at, dur, (x) => {
    const p = x / dur;
    return (noise() * 0.6 * p ** 2 + Math.sin(2 * Math.PI * (200 + 900 * p * p) * x) * 0.15 * p) * (p < 0.98 ? 1 : 0);
  }, 0.35);
}

// Impacts on the cuts: a sub drop and a burst of noise.
for (const at of T.impacts) {
  add(at, 1.2, (x) => Math.sin(2 * Math.PI * (38 + 60 * Math.exp(-x * 12)) * x) * Math.exp(-x * 3.2), 0.85);
  add(at, 0.35, (x) => noise() * Math.exp(-x * 14), 0.25);
}

// Fade the last two seconds, then normalise to -1 dBFS.
for (let i = 0; i < n; i++) {
  const left = (n - i) / RATE;
  if (left < 2) { L[i] *= left / 2; R[i] *= left / 2; }
}
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak;

const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
writeFileSync(join(ROOT, "public/launch/music.wav"), Buffer.concat([header, data]));
console.log(`public/launch/music.wav: ${LENGTH}s at ${T.bpm} BPM, ${T.impacts.length} impacts, ${T.risers.length} risers`);
