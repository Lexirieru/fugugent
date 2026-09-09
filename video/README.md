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
