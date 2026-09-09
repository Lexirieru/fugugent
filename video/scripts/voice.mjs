#!/usr/bin/env node
/**
 * Turns the narration in `src/script.ts` into one mp3 per scene, through ElevenLabs.
 *
 * The key is read from `video/.env`, which is gitignored, and it never reaches the
 * browser: this is a build step, and the rendered video carries audio, not credentials.
 *
 * **There is a fallback, and the log always says which voice was used.** The account we
 * were given answers 401 `detected_unusual_activity`: its free tier is switched off, and
 * ElevenLabs only lifts that on a paid plan. Rather than leave the video unbuildable, a
 * failure falls back to the system voice and writes `voice.json` recording that the audio
 * is a placeholder. Upgrade the account and rerun; nothing else has to change.
 *
 * Each clip's real duration is measured with ffprobe and written to
 * `assets/audio/durations.json`. The composition reads that rather than guessing, so a
 * line is never cut off by a hard-coded scene length. Guessing here is how a demo ends
 * up with a sentence chopped in half at the exact moment someone is judging it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// `public/`, for the same reason as the capture script: one directory, so a regenerated
// clip cannot end up somewhere the render does not look.
const OUT = join(ROOT, "public", "audio");

// Roger: laid-back and resonant. A demo should sound like a person explaining
// something, not like an advertisement reading at you.
const VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17";
const MODEL = "eleven_multilingual_v2";

async function loadEnv() {
  const raw = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY missing from video/.env");
}

async function scenes() {
  const src = await readFile(join(ROOT, "src", "script.ts"), "utf8");
  const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  const says = [...src.matchAll(/say:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ids.length !== says.length) throw new Error("script.ts: every scene needs an id and a say");
  return ids.map((id, i) => ({ id, say: says[i] }));
}

/**
 * macOS `say` writes AIFF; ffmpeg converts it so the composition only ever loads one
 * format. `-r 172` is a shade slower than the default, because the default reads a
 * technical sentence faster than anyone can follow it.
 */
async function systemVoice(text, mp3Path) {
  const aiff = mp3Path.replace(/\.mp3$/, ".aiff");
  await run("say", ["-v", "Samantha", "-r", "172", "-o", aiff, text]);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path]);
  await run("rm", ["-f", aiff]);
}

async function main() {
  await loadEnv();
  await mkdir(OUT, { recursive: true });

  const durations = {};
  let usedElevenLabs = false;
  let warned = false;
  for (const scene of await scenes()) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: scene.say,
        model_id: MODEL,
        // Stability high enough that the same script renders the same way twice; a demo
        // that sounds different on every render cannot be reviewed.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
      }),
    });

    const file = join(OUT, `${scene.id}.mp3`);

    if (res.ok) {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      usedElevenLabs = true;
    } else {
      const detail = (await res.text()).slice(0, 200);
      if (!warned) {
        console.warn(`! ElevenLabs ${res.status}: ${detail}`);
        console.warn("! falling back to the system voice. The audio is a placeholder.");
        warned = true;
      }
      await systemVoice(scene.say, file);
    }

    const { stdout } = await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]);
    durations[scene.id] = Number(stdout.trim());
    console.log(`${scene.id}: ${durations[scene.id].toFixed(2)}s`);
  }

  await writeFile(join(OUT, "durations.json"), JSON.stringify(durations, null, 2) + "\n");
  await writeFile(
    join(OUT, "voice.json"),
    JSON.stringify({ provider: usedElevenLabs ? "elevenlabs" : "macos-say", voiceId: usedElevenLabs ? VOICE_ID : "Samantha", placeholder: !usedElevenLabs }, null, 2) + "\n",
  );
  const total = Object.values(durations).reduce((a, b) => a + b, 0);
  console.log(`spoken total: ${total.toFixed(1)}s across ${Object.keys(durations).length} scenes`);
  console.log(usedElevenLabs ? "voice: ElevenLabs" : "voice: macOS say (PLACEHOLDER, see voice.json)");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
