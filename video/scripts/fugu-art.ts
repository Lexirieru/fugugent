import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Run from frontend/ (see video/README.md) so its path aliases resolve.
import { fuguSvg } from "./src/lib/fugu";
import { FIRST_PARTY } from "./src/lib/agents";
const out = "../video/public/agents";
for (const kind of ["guardian", "rebalancer", "grid", "yield", "broker", "trader", "pilot", "meter", "steward"] as const) {
  for (const level of [1, 2, 3, 4, 5] as const) {
    writeFileSync(`${out}/${kind}-${level}.svg`, fuguSvg({ kind, level, uid: `${kind}${level}`, withRim: true, background: "#121e29" }));
  }
}
// Builders' agents wear the seeded fallback fish the marketplace gives them: the agents
// film's five, and whichever the spotlight data names.
const spotlight = JSON.parse(readFileSync("../video/src/spotlight/data.json", "utf8")) as { agents: { id: string }[] };
const seeds = new Set(["97:2545", "97:2550", "97:2554", "97:2555", "97:2556", ...spotlight.agents.map((a) => a.id)]);
for (const seed of seeds) {
  if (FIRST_PARTY[seed]) continue;
  writeFileSync(`${out}/builder-${seed.split(":")[1]}.svg`, fuguSvg({ kind: "fallback", seed, level: 2, uid: `b${seed.split(":")[1]}`, withRim: true, background: "#121e29" }));
}
// The 30-second film: transparent fish (no rim, no background) and the coin's face.
const film = "../video/public/film";
mkdirSync(film, { recursive: true });
for (const kind of ["guardian", "meter", "broker", "trader"] as const) {
  for (const level of [1, 2, 3, 4, 5] as const) {
    writeFileSync(`${film}/${kind}-${level}.svg`, fuguSvg({ kind, level, uid: `f${kind}${level}`, withRim: false, size: 512 }));
  }
}
writeFileSync(`${film}/coin-face.svg`, fuguSvg({ kind: "guardian", level: 1, uid: "coin", withRim: false, size: 1024 }));
console.log("ok");
