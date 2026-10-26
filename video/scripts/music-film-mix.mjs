#!/usr/bin/env node
/**
 * The film's music: a real track with the cut accents laid under it.
 *
 * The track is "Techno" (Techno_0.mp3) from Pro Sensory's "Electronic" pack on
 * OpenGameArt (https://opengameart.org/content/electronic), licensed CC0. It runs at
 * 120 BPM like the edit, and its drop (the first kick after a 1.7 s silence, at
 * 66.042 s in the file) is placed on the "meet" cut, where HelloFugu appears. The
 * synthesised impacts, risers and whooshes (`SFX_ONLY=1 node scripts/music-film.mjs`)
 * sit 10 dB under it so the cuts before the drop still land. The last 3 s fade out.
 *
 *   SFX_ONLY=1 node scripts/music-film.mjs && node scripts/music-film-mix.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(ROOT, "src/film/timeline.json"), "utf8"));
const LENGTH = T.scenes.at(-1).end;
const DROP_IN_TRACK = 66.042;
const DROP_IN_FILM = T.scenes.find((s) => s.id === "meet").start;
const start = DROP_IN_TRACK - DROP_IN_FILM;

execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-ss", String(start), "-t", String(LENGTH), "-i", join(ROOT, "public/film/techno-0-pro-sensory.mp3"),
  "-i", join(ROOT, "public/film/sfx.wav"),
  "-filter_complex",
  `[0:a]aresample=48000,volume=1.0[m];[1:a]volume=-10dB[s];[m][s]amix=inputs=2:normalize=0,afade=t=out:st=${LENGTH - 3}:d=3,alimiter=limit=0.89[o]`,
  "-map", "[o]", "-ac", "2", "-ar", "48000", join(ROOT, "public/film/music.wav"),
]);
console.log(`public/film/music.wav: track from ${start.toFixed(3)} s, drop on ${DROP_IN_FILM} s, ${LENGTH} s long`);
