/**
 * The only door to the skill data. Pages call `skillSource()`, never `fetch`.
 *
 * Connecting a real backend is one environment variable — `NEXT_PUBLIC_API_BASE_URL`,
 * the same one the agent marketplace already uses. No component changes, because no
 * component knows where its data came from: they read `source` and `healthy` off the
 * envelope and show them exactly as they are.
 */

import { createHttpSkillSource } from "@/lib/skills/http";
import { seedSkillSource } from "@/lib/skills/seed";
import type { SkillSourcePort } from "@/lib/skills/source";

export function skillSource(): SkillSourcePort {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return base ? createHttpSkillSource(base) : seedSkillSource;
}

export type {
  AuditorList,
  SkillDetail,
  SkillPage,
  SkillQuery,
  SkillSourcePort,
} from "@/lib/skills/source";
