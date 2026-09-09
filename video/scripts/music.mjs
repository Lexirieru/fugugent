#!/usr/bin/env node
/**
 * Writes the music bed, from scratch, as a WAV.
 *
 * Not a downloaded track. Every piece of music worth using carries a licence, and most
 * "royalty free" libraries still require attribution that a hackathon video will forget to
 * give. Synthesising it here removes the question entirely: this file is the composition,
 * it is covered by the repository's own licence, and it can be regenerated at any length
 * when the edit changes.
 *
 * It is deliberately plain. Four chords, soft attack, and a level low enough that it never
 * competes with the narration. A demo where the viewer notices the music is a demo where
 * they stopped listening to the sentence.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 48_000;

/** A minor, then F, C, G. Warm rather than triumphant, because the script is not a boast. */
const CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
];

const BAR_SECONDS = 5.4;
/** Roughly -28 dB. Speech sits about 20 dB above this, which is where it belongs. */
const LEVEL = 0.04;

function render(seconds) {
  const n = Math.floor(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const bar = Math.floor(t / BAR_SECONDS);
    const inBar = (t % BAR_SECONDS) / BAR_SECONDS;
    const chord = CHORDS[bar % CHORDS.length];

    // A soft swell per bar rather than a hard chord change, so nothing draws attention.
    const swell = Math.sin(Math.PI * Math.min(1, inBar * 1.15)) ** 0.7;

    let v = 0;
    chord.forEach((f, k) => {
      // Each voice a little quieter than the one below it, which is how a real chord sits.
      const weight = [1, 0.72, 0.5][k];
      v += Math.sin(2 * Math.PI * f * t) * weight;
      // A quiet octave above adds air without adding a note anyone can name.
      v += Math.sin(2 * Math.PI * f * 2 * t) * weight * 0.12;
    });
    v /= 2.6;

    // Very slow tremolo. Two rates, slightly detuned per channel, which is what stops a
    // synthesised pad sounding like a test tone.
    const tremL = 1 + 0.06 * Math.sin(2 * Math.PI * 0.11 * t);
    const tremR = 1 + 0.06 * Math.sin(2 * Math.PI * 0.13 * t + 1.1);

    const fadeIn = Math.min(1, t / 2.5);
    const fadeOut = Math.min(1, (seconds - t) / 3.5);
    const env = LEVEL * swell * Math.max(0, Math.min(fadeIn, fadeOut));

    left[i] = v * env * tremL;
    right[i] = v * env * tremR;
  }

  // One-pole low pass, twice, to take the edge off the harmonics the octave added.
  for (const ch of [left, right]) {
    let prev = 0;
    for (let pass = 0; pass < 2; pass++) {
      prev = 0;
      for (let i = 0; i < ch.length; i++) {
        prev += 0.18 * (ch[i] - prev);
        ch[i] = prev;
      }
    }
  }

  return { left, right, n };
}

function wav({ left, right, n }) {
  const header = Buffer.alloc(44);
  const bytes = n * 4; // 2 channels, 16-bit
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);

  const body = Buffer.alloc(bytes);
  for (let i = 0; i < n; i++) {
    body.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(left[i] * 32767))), i * 4);
    body.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(right[i] * 32767))), i * 4 + 2);
  }
  return Buffer.concat([header, body]);
}

const seconds = Number(process.argv[2] ?? 80);
const out = join(ROOT, "public", "music.wav");
writeFileSync(out, wav(render(seconds)));
console.log(`wrote ${out} (${seconds}s, ${CHORDS.length} chords at ${BAR_SECONDS}s each)`);
