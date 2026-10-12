import { writeFileSync } from "node:fs";
// Run from frontend/ (see video/README.md) so its path aliases resolve.
import { fuguSvg } from "./src/lib/fugu";
const out = "../video/public/agents";
for (const kind of ["guardian", "rebalancer", "grid", "yield", "broker", "trader", "pilot", "meter", "steward"] as const) {
  for (const level of [1, 2, 3, 4, 5] as const) {
    writeFileSync(`${out}/${kind}-${level}.svg`, fuguSvg({ kind, level, uid: `${kind}${level}`, withRim: true, background: "#121e29" }));
  }
}
for (const seed of ["97:2545", "97:2550", "97:2554", "97:2555", "97:2556"]) {
  writeFileSync(`${out}/builder-${seed.split(":")[1]}.svg`, fuguSvg({ kind: "fallback", seed, level: 2, uid: `b${seed.split(":")[1]}`, withRim: true, background: "#121e29" }));
}
console.log("ok");
