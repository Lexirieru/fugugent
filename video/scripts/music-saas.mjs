#!/usr/bin/env node
/**
 * A warm, bright product-film track, synthesised as a WAV (no licence to track).
 *
 * Unlike the launch films' four-on-the-floor and impacts, this is the sound of a calm
 * SaaS walkthrough: 100 BPM, F major (F, C, Dm, Bb), electric-piano chords that breathe
 * with the kick, a marimba hook, a swung shaker, a round sub. Scene changes get a soft
 * whoosh instead of a hit. It reads the scene list from a timeline file, so the
 * whooshes land on the cuts.
 *
 *   node scripts/music-saas.mjs src/agents/timeline.json public/agents/music.wav
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(ROOT, process.argv[2] ?? "src/agents/timeline.json"), "utf8"));
const OUTFILE = process.argv[3] ?? "public/agents/music.wav";
const RATE = 48_000;
const BEAT = 60 / T.bpm;
const BAR = 4 * BEAT;
const LENGTH = T.scenes.at(-1).end;
const n = Math.ceil(LENGTH * RATE);
const L = new Float32Array(n);
const R = new Float32Array(n);

let seed = 11;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

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

// F, C, Dm, Bb. Root (bass octave) and a voiced triad with the ninth on top.
const CHORDS = [
  { root: 41, notes: [65, 69, 72, 79] }, // F add9
  { root: 36, notes: [64, 67, 72, 74] }, // C add9
  { root: 38, notes: [65, 69, 74, 76] }, // Dm add9
  { root: 34, notes: [65, 70, 74, 77] }, // Bb maj7
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];
const sceneOf = (t) => T.scenes.find((s) => t >= s.start && t < s.end)?.id ?? "outro";
const intro = (t) => t < T.scenes[1].start;
const outro = (t) => t >= LENGTH - BAR;

// Electric piano: a two-operator FM tone with a bell-like attack.
const ep = (f) => (t) => {
  const mod = Math.sin(2 * Math.PI * f * 1.0 * t) * 1.6 * Math.exp(-t * 6);
  return Math.sin(2 * Math.PI * f * t + mod) * Math.exp(-t * 1.6) * Math.min(1, t * 200);
};
// Marimba: a fundamental and a fourth partial that dies fast.
const marimba = (f) => (t) =>
  (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t * 30)) * Math.exp(-t * 7) * Math.min(1, t * 600);
const kick = (t) => Math.sin(2 * Math.PI * (48 * t + 60 * (1 - Math.exp(-t * 22)) / 22)) * Math.exp(-t * 9);
const snap = (t) => (noise() * 0.7 + Math.sin(2 * Math.PI * 1800 * t) * 0.3) * Math.exp(-t * 45);
const shaker = (t) => noise() * Math.exp(-t * 60) * Math.min(1, t * 3000);
const sub = (f) => (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 60) * Math.exp(-t * 2.2);

// Sidechain-ish pump: everything tonal ducks a little on each beat.
const pump = new Float32Array(n).fill(1);
for (let b = 0; b * BEAT < LENGTH; b++) {
  const s0 = Math.floor(b * BEAT * RATE);
  for (let i = 0; i < BEAT * RATE && s0 + i < n; i++) pump[s0 + i] = 0.62 + 0.38 * Math.min(1, i / (0.22 * RATE));
}
const tonalL = new Float32Array(n);
const tonalR = new Float32Array(n);
function addTonal(t0, dur, fn, gain, pan = 0) {
  const s0 = Math.floor(t0 * RATE);
  const len = Math.floor(dur * RATE);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < len && s0 + i < n; i++) {
    const v = fn(i / RATE);
    tonalL[s0 + i] += v * gl;
    tonalR[s0 + i] += v * gr;
  }
}

// Chords: on beat 1 and the "and" of 2, every bar.
for (let bar = 0; bar * BAR < LENGTH; bar++) {
  const t = bar * BAR;
  const c = chordAt(t);
  for (const hit of [0, 1.5 * BEAT, 2.5 * BEAT]) {
    c.notes.forEach((m, k) => addTonal(t + hit + k * 0.008, BEAT * 2.2, ep(hz(m)), 0.055, k % 2 ? 0.25 : -0.25));
  }
  if (!intro(t) && !outro(t)) for (let b = 0; b < 4; b++) addTonal(t + b * BEAT, BEAT, sub(hz(c.root)), 0.32);
}

// The marimba hook: a two-bar pentatonic phrase that follows the chord.
const HOOK = [
  [0, 0], [0.75, 2], [1.5, 4], [2, 3], [3, 2],
  [4, 4], [4.75, 5], [5.5, 4], [6, 2], [7, 0],
]; // [beat, scale step]
const SCALE = [0, 2, 4, 7, 9, 12]; // major pentatonic, in semitones
for (let bar = 0; bar * BAR < LENGTH; bar += 2) {
  const t = bar * BAR;
  if (intro(t) || t >= LENGTH - 2 * BAR) continue;
  const base = 77; // F5
  for (const [beat, step] of HOOK) {
    const at = t + beat * BEAT;
    const f = hz(base + SCALE[step]);
    addTonal(at, 0.9, marimba(f), 0.09, 0.15);
    // A dotted-eighth echo, quieter and the other side.
    addTonal(at + 0.75 * BEAT, 0.9, marimba(f), 0.035, -0.4);
  }
}

// Drums: soft kick on 1 and 3 (and a pickup), snap on 2 and 4, swung shaker.
for (let b = 0; b * BEAT < LENGTH; b++) {
  const t = b * BEAT;
  if (intro(t) || outro(t)) continue;
  const inBar = b % 4;
  if (inBar === 0 || inBar === 2) add(t, 0.45, kick, 0.75);
  if (inBar === 3) add(t + 0.5 * BEAT, 0.3, kick, 0.35);
  if (inBar === 1 || inBar === 3) add(t, 0.15, snap, 0.16, 0.12);
  for (let s = 0; s < 4; s++) {
    const swing = s % 2 ? 0.07 * BEAT : 0;
    add(t + (s * BEAT) / 4 + swing, 0.05, shaker, s % 2 ? 0.045 : 0.07, 0.35);
  }
}

// A soft whoosh into every scene: noise that swells and falls, panned across.
for (const s of T.scenes.slice(1)) {
  const dur = 0.9;
  add(s.start - dur * 0.7, dur, (x) => {
    const p = x / dur;
    return noise() * Math.sin(Math.PI * p) ** 2 * 0.5;
  }, 0.14, -0.3);
}

// Mix, fade in two beats and out over the last bar, normalise to -1.5 dBFS.
for (let i = 0; i < n; i++) {
  L[i] += tonalL[i] * pump[i];
  R[i] += tonalR[i] * pump[i];
  const t = i / RATE;
  const g = Math.min(1, t / (2 * BEAT)) * Math.min(1, (LENGTH - t) / BAR);
  L[i] *= g;
  R[i] *= g;
}
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const k = 0.84 / peak;
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(data.length, 40);
writeFileSync(join(ROOT, OUTFILE), Buffer.concat([h, data]));
console.log(`${OUTFILE}: ${LENGTH}s at ${T.bpm} BPM, F major, ${T.scenes.length - 1} whooshes`);
