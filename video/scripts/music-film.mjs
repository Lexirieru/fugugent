#!/usr/bin/env node
/**
 * The 30-second launch film's track, synthesised as a WAV (no licence to track).
 *
 * Darker than the other films: it opens on a sub drone, ticking hats and a riser while
 * the problem is stated, drops into a driving 120 BPM beat when the product appears,
 * and lands an impact (sub drop, noise burst) on every big cut in `timeline.json`.
 * Scene changes in between get a short whoosh. A minor: Am, F, C, G.
 *
 *   node scripts/music-film.mjs   ->  public/film/music.wav
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(ROOT, "src/film/timeline.json"), "utf8"));
// SFX_ONLY=1 writes just the impacts, risers and whooshes, to lay under a real track
// (scripts/music-film-mix.mjs); without it this is the whole synthesised score.
const SFX_ONLY = process.env.SFX_ONLY === "1";
const OUTFILE = process.argv[2] ?? (SFX_ONLY ? "public/film/sfx.wav" : "public/film/music.wav");
const RATE = 48_000;
const BEAT = 60 / T.bpm;
const BAR = 4 * BEAT;
const LENGTH = T.scenes.at(-1).end;
const n = Math.ceil(LENGTH * RATE);
const L = new Float32Array(n);
const R = new Float32Array(n);

let seed = 23;
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

const kick = (t) => Math.sin(2 * Math.PI * (42 * t + 110 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 6.5);
const snare = (t) => (noise() * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 18);
const hat = (t) => noise() * Math.exp(-t * 110);
const saw = (f, t) => 2 * ((f * t) % 1) - 1;
// A detuned saw bass, low-passed by hand: the average of three slightly detuned saws.
const bass = (f) => (t) => ((saw(f, t) + saw(f * 1.006, t) + saw(f * 0.994, t)) / 3) * Math.exp(-t * 4) * Math.min(1, t * 300);
const pad = (fs) => (t) => fs.reduce((v, f) => v + Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.004 * t), 0) / fs.length;
const bell = (f) => (t) => (Math.sin(2 * Math.PI * f * t + 2 * Math.sin(2 * Math.PI * f * 3.5 * t) * Math.exp(-t * 5))) * Math.exp(-t * 3);

const CHORDS = [
  { root: 55.0, notes: [220.0, 261.63, 329.63] },
  { root: 43.65, notes: [174.61, 220.0, 261.63] },
  { root: 65.41, notes: [196.0, 261.63, 329.63] },
  { root: 49.0, notes: [196.0, 246.94, 293.66] },
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];
const DROP = T.scenes.find((s) => s.id === "meet").start;
const OUTRO = T.scenes.find((s) => s.id === "end").start;

if (!SFX_ONLY) {
// Before the drop: a sub drone and ticking hats, tension without a beat.
add(0, DROP, (t) => Math.sin(2 * Math.PI * 55 * t) * Math.min(1, t / 1.5) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t)), 0.3);
for (let b = 0; b * BEAT < DROP; b++) {
  const t = b * BEAT;
  add(t, 0.05, hat, 0.08, b % 2 ? 0.3 : -0.3);
  add(t + BEAT / 2, 0.04, hat, 0.04, 0.1);
  if (t >= 2 && b % 2 === 0) add(t, 0.5, kick, 0.55);
}

// The drop: a driving beat until the outro.
for (let b = 0; DROP + b * BEAT < OUTRO; b++) {
  const t = DROP + b * BEAT;
  const inBar = b % 4;
  add(t, 0.5, kick, 0.95);
  if (inBar === 1 || inBar === 3) add(t, 0.3, snare, 0.22, 0.05);
  add(t + BEAT / 2, 0.06, hat, 0.12, -0.3);
  add(t + BEAT / 4, 0.03, hat, 0.05, 0.4);
  add(t + (3 * BEAT) / 4, 0.03, hat, 0.05, 0.4);
  const c = chordAt(t);
  add(t + BEAT / 2, BEAT / 2, bass(c.root * 2), 0.22);
  if (inBar === 0) add(t, BEAT, bell(c.notes[2] * 2), 0.05, 0.3);
  if (inBar === 2) add(t, BEAT, bell(c.notes[1] * 2), 0.04, -0.3);
}

// The outro rings out: two kicks and the pad.
add(OUTRO, 0.6, kick, 0.8);
add(OUTRO + BAR, 0.6, kick, 0.5);

for (let b = 0; b * BAR < LENGTH; b++) {
  const t = b * BAR;
  const c = chordAt(t);
  add(t, BAR, (x) => pad(c.notes)(x) * Math.sin((Math.PI * Math.min(x, BAR)) / BAR) ** 0.6, t >= DROP && t < OUTRO ? 0.05 : 0.08);
}

}

for (const at of T.risers) {
  const end = T.impacts.find((i) => i > at) ?? at + 2;
  const dur = end - at;
  add(at, dur, (x) => {
    const p = x / dur;
    return (noise() * 0.55 * p ** 2.2 + Math.sin(2 * Math.PI * (180 + 1100 * p * p) * x) * 0.12 * p) * (p < 0.985 ? 1 : 0);
  }, 0.32);
}

for (const at of T.impacts) {
  add(at, 1.4, (x) => Math.sin(2 * Math.PI * (34 + 70 * Math.exp(-x * 11)) * x) * Math.exp(-x * 2.8), 0.9);
  add(at, 0.4, (x) => noise() * Math.exp(-x * 12), 0.22);
}

// A short whoosh on every other cut.
for (const s of T.scenes.slice(1)) {
  if (T.impacts.includes(s.start)) continue;
  add(s.start - 0.25, 0.5, (x) => noise() * Math.sin((Math.PI * x) / 0.5) ** 2, 0.12, x0(s.start));
}
function x0(t) { return Math.sin(t) * 0.5; }

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
writeFileSync(join(ROOT, OUTFILE), Buffer.concat([header, data]));
console.log(`${OUTFILE}: ${LENGTH}s at ${T.bpm} BPM, ${T.impacts.length} impacts, ${T.risers.length} risers`);
