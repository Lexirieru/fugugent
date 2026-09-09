/**
 * The narration, and the only place its wording lives.
 *
 * Every number below was read back from the chain or from a live page, and the file
 * says which. A demo video is the easiest place in a project to overstate something,
 * because nobody diffs a video. So the rule that governs the rest of this repository
 * governs this file too: if a sentence cannot be checked, it does not ship.
 *
 * `seconds` is the shot length, not the length of the speech. The voice track for each
 * scene is measured after it is generated and the composition uses whichever is longer,
 * so a line is never cut off mid-word by a hard-coded duration.
 */
export interface Scene {
  /** Matches the clip name in `assets/capture/` and the mp3 in `assets/audio/`. */
  id: string;
  /** What the viewer is looking at, for whoever edits this next. */
  shows: string;
  /** Spoken aloud. */
  say: string;
  /** Where the claim can be checked. Not rendered; it is here so it cannot be lost. */
  source: string;
  seconds: number;
}

export const SCENES: Scene[] = [
  {
    id: "landing",
    shows: "the landing page",
    say: "HelloFugu is a marketplace for agents on BNB Chain. You buy one the way you buy an app.",
    source: "hellofugu.xyz",
    seconds: 5,
  },
  {
    id: "landing-rails",
    shows: "what it is built on",
    say: "It is built on BNB Agent Studio, and every agent carries a spending limit that the chain itself enforces.",
    source: "docs/research/01 and 03; the Altana session key allowlist in ai/fuguguardian",
    seconds: 6,
  },
  {
    id: "marketplace",
    shows: "the catalogue",
    say: "The catalogue holds a hundred and twelve agents across nine kinds. Most of them have no price yet, and the page says so rather than pretending otherwise.",
    source: "GET api.hellofugu.xyz/api/categories, total 112 across 9 categories",
    seconds: 7,
  },
  {
    id: "ready-filter",
    shows: "the ready to hire filter",
    say: "One filter shows the nine you can actually hire today. Nine out of a hundred and twelve. We would rather show you that number than bury it.",
    source: "app.hellofugu.xyz/agents?available=yes prints '9 of the 112 in the catalogue'",
    seconds: 7,
  },
  {
    id: "agent-detail",
    shows: "an agent page and its risk panel",
    say: "Every agent is a pufferfish, and it swells as its risk rises. The puff level comes from one real measurement, never from a mood.",
    source: "docs/brand/puff-levels.md; the reading is read from the agent's own decision engine",
    seconds: 6,
  },
  {
    id: "agent-proof",
    shows: "the on-chain evidence list",
    say: "Fugu Guardian moved a real position from a health factor of one point one four to one point five, repaying four dollars and three cents. It signed with a key allowed to call exactly two functions. When it reached for a third, the account contract refused before anything was sent.",
    source: "tx 0x619cfbe3 at block 129852222; UnauthorizedCall raised during simulation, never broadcast; STATUS.md A4",
    seconds: 9,
  },
  {
    id: "skills",
    shows: "the audited skill marketplace",
    say: "Agents can buy skills from each other too, and every skill carries the audit that examined it.",
    source: "app.hellofugu.xyz/skills; the records shown are labelled examples",
    seconds: 6,
  },
  {
    id: "close",
    shows: "closing card",
    say: "Nine agents are listed. Exactly one of them has ever sent a transaction. That sentence is on the site as well. HelloFugu dot xyz.",
    source: "STATUS.md B17; only fuguguardian has sent a transaction",
    seconds: 7,
  },
];
