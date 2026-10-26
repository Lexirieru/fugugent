# The demo video

One command rebuilds the whole thing, and that is the point. A demo video that cannot be
regenerated goes stale the first time the product changes, and then quietly misrepresents it.

```bash
npm install
npm run voice     # narration, one mp3 per scene
npm run capture   # records the live site, one mp4 per scene
npm run music     # synthesises the music bed
npm run render    # out/hellofugu-demo.mp4
```

## What is in it

Everything on screen is the live site at `hellofugu.xyz` and `app.hellofugu.xyz`, recorded
through the Chrome DevTools Protocol. Nothing is a mockup. The title and closing cards are
drawn with the same design tokens as the product, imported from `theme/tokens.css` at the
repository root, so the video cannot drift into being a third design.

The narration is in `src/script.ts`, and every scene there carries a `source` field naming
where its claim can be checked. That field is not rendered. It is there so a number cannot be
put into the video without somebody writing down where it came from.

## The voice is a placeholder right now

`scripts/voice.mjs` calls ElevenLabs first. The account currently answers:

```
401 detected_unusual_activity
Free Tier access has been disabled ... Please upgrade to a paid subscription to continue.
```

The key is valid and the character quota is untouched, so this is the account being flagged
rather than exhausted, and only a paid plan lifts it. Rather than leave the video unbuildable,
the script falls back to the macOS system voice and records that fact in
`public/audio/voice.json` as `"placeholder": true`. Upgrade the account, rerun `npm run voice`
and `npm run render`, and nothing else changes.

## Two things that were learned the hard way

**`Page.startScreencast` only emits a frame when the page repaints.** The first version of the
capture script recorded 110 frames for one scene, 2 for another, and 0 for three more. Frames
are now pulled one at a time with `Page.captureScreenshot`, with the scroll position computed
per frame, which makes the count exact and the motion even.

**The captured clips are written straight into `public/`.** They used to be written to
`assets/` and copied across. A re-record then landed in one directory while the render read
the other, and a take went out with the new narration over the old footage.

## Music

`scripts/music.mjs` synthesises the bed as a WAV. It is not a downloaded track: every piece of
music worth using carries a licence, most "royalty free" libraries still want attribution a
hackathon video will forget to give, and this removes the question. It is four chords, mixed
about 20 dB under the speech, and deliberately unremarkable.

## The launch film (`src/launch/`)

A second, shorter film: 54 seconds, captions instead of narration, landing page to app,
cut on the beat of its own synthesised music.

```bash
npm run capture:launch   # 2x stills of the live site; hire and /me on an anvil fork
npm run music:launch     # 120 BPM, risers and impacts on the cuts in timeline.json
npm run render:launch    # out/hellofugu-launch.mp4, 1920x1080, 60 fps
```

`src/launch/timeline.json` is the edit: scene boundaries, impacts and risers. The music
reads it too, so moving a cut there moves its impact. The camera, the cursor and the
auto-zooms are done in `Launch.tsx`, aimed at element boxes the capture measured from
the DOM (`captured.json`), which is what keeps text sharp at 2x zoom. `ONLY=landing,app`
re-records just those parts; the hire and /me shots need the fork stack described at the
top of `scripts/capture-launch.mjs`.

## The agents film (`src/agents/`)

55 seconds of motion graphics, no screen recordings: each agent's fish, job and price,
and the real answers of the ones that run. Different music too: `scripts/music-saas.mjs`
writes a calm 100 BPM track in F major with soft whooshes on the cuts.

```bash
(cd ../frontend && cp ../video/scripts/fugu-art.ts _fugu-art.ts && npx tsx _fugu-art.ts; rm _fugu-art.ts)
npm run data:agents     # live /api/run answers and FuguRegistry listings, dated
npm run music:agents
npm run render:agents   # out/hellofugu-agents.mp4
```

`data.json` records when it was read; rerun `data:agents` before a new cut so no number
on screen is older than the film.

## The spotlight (`src/spotlight/`)

A 14-second square card for one agent: "New on HelloFugu" for a builder's agent, "Meet
the agents" for ours. One template, rendered once per agent, so a new listing can be
posted the day it appears.

```bash
npm run data:spotlight -- 27 1     # listing ids -> src/spotlight/data.json, endpoints probed
(cd ../frontend && cp ../video/scripts/fugu-art.ts _fugu-art.ts && npx tsx _fugu-art.ts; rm _fugu-art.ts)
npm run music:spotlight
npx remotion render src/spotlight/index.ts Spotlight out/spotlight-2662.mp4 --props='{"id":"97:2662"}'
```

Everything on the card is read from FuguRegistry and the agent's ERC-8004 registration
file, except the one-line job: registration descriptions run to a paragraph, so
`lines.json` holds a shortening of each one that adds no claim of its own. A builder's
agent whose endpoint did not answer when the data was read refuses to render, and the
card says on which day the endpoint was checked.

## The 30-second film (`src/film/`)

A dark, cinematic launch spot: kinetic type on a perspective grid, the fish puffing as
a health factor falls, a real 3D coin (`@remotion/three`) in a column of light, neon
keywords drawn by beams and circuits, the real app on floating screens, a feature ring,
and an end card.

```bash
npm run assets:film   # the CC0 HDRI and track, md5-checked, plus the brand marks
npm run music:film    # the CC0 track, cut so its drop lands on "meet", with accents under it
npm run render:film   # out/hellofugu-film.mp4, 1920x1080, 30 fps
```

The music is "Techno" from Pro Sensory's "Electronic" pack on OpenGameArt
(opengameart.org/content/electronic), licensed CC0. It is 120 BPM like the edit, and
`scripts/music-film-mix.mjs` starts it at 58.042 s so its drop lands on the cut where
HelloFugu appears; the synthesised impacts and risers sit 10 dB under it. Running
`node scripts/music-film.mjs` alone still writes the fully synthesised score instead.

The coin's metal reflects `public/film/studio_small_09_1k.hdr`, "Studio Small 09" by
Sergej Majboroda from Poly Haven, licensed CC0. Fish art in `public/film/` is drawn by
`frontend/src/lib/fugu.ts`; the screens are the stills `capture-quest.mjs` took. Every
line on screen is something the product does today: hires are capped, revocable and
public, Guardian has repaid a live loan, Watch and Scout answer.
