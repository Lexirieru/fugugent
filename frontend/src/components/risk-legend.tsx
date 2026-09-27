import { ActionToken, SpendMarker } from "@/components/action-token";
import { Fugu } from "@/components/fugu";
import { InfoTip } from "@/components/info-tip";
import { BLOAT, BLOAT_LEVELS, GUARDIAN_ACTIONS } from "@/lib/risk";

/**
 * How to read the fish, and, kept visibly apart from it, what the agent does about what
 * the fish shows.
 *
 * These are two scales, not one. Before paying, a buyer needs two answers: how much
 * trouble is my money in, and what will this agent do if I hire it. Each scale carries
 * information the other does not, so both stay. But an earlier round gave them lookalike
 * prose names ("Watchful" on one, "Watching" on the other) and a reader who saw one of
 * them assumed they had both answers.
 *
 * The fix here is structural rather than lexical. The two tracks are two separately
 * headed blocks with a rule between them, each headed by the question it answers, and
 * they are drawn in two registers that cannot be confused: prose in a pill beside a fugu
 * for risk, UPPERCASE_SNAKE_CASE monospace in a square box for actions. Nothing is
 * distinguished by colour alone, so the separation survives grayscale and colour
 * blindness exactly as the avatar assets do.
 *
 * This is a legend, not a claim: there is not a single agent number in it. The copy is
 * kept to a heading and one short line per track; the longer notes sit in `InfoTip`s.
 */
export function RiskLegend() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      {/* Track 1: the risk state. Prose names, fugu avatars, pill chips. */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-sm font-medium text-fg">1 · How much trouble is the money in?</h3>
          <p className="flex items-center gap-2 text-xs text-faint">
            Colour is the agent. Shape is the risk.
            <InfoTip label="How to read the levels" align="end">
              Level 5 alone holds still and has a black-and-white ring, so it reads without
              colour or motion.
            </InfoTip>
          </p>
        </div>

        <ol className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {BLOAT_LEVELS.map((level) => {
            const spec = BLOAT[level];
            return (
              <li key={level} className="flex flex-col items-center text-center">
                <Fugu
                  kind="guardian"
                  level={level}
                  className="size-14"
                  animated={false}
                  label={`Risk level ${level} of 5, ${spec.name}: ${spec.ring}.`}
                />
                <span
                  className="mt-3 rounded-full border px-2.5 py-0.5 text-sm font-medium text-fg"
                  style={{ borderColor: spec.color }}
                >
                  {spec.name}
                </span>
                <span className="mt-2 text-[11px] leading-snug text-faint">{spec.ring}</span>
              </li>
            );
          })}
        </ol>

        <p className="mt-6 flex items-start justify-between gap-3 text-pretty text-xs leading-relaxed text-faint">
          <span>A hollow, dashed fish means no fresh reading. We never guess a level.</span>
          <InfoTip label="Why we never guess" align="end">
            Giza and ARMA shut down in February 2026 after dashboards showed amounts nobody
            could check.
          </InfoTip>
        </p>
      </section>

      {/* Track 2: the action band. Code tokens, no avatars, square boxes. */}
      <section className="mt-8 border-t border-line pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-sm font-medium text-fg">2 · What does the agent do about it?</h3>
          <p className="flex items-center gap-2 text-xs text-faint">
            Names straight from the code.
            <InfoTip label="Where these names come from">
              These are the <code className="font-mono">Action</code> names Fugu Guardian&apos;s
              decision code branches on, not labels written for the page.
            </InfoTip>
          </p>
        </div>

        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {GUARDIAN_ACTIONS.map((spec) => (
            <li
              key={spec.action}
              className="flex flex-col items-start rounded-xl border border-line bg-bg-elev px-3 py-3"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <ActionToken spec={spec} />
                <InfoTip label={`What ${spec.action} does`} align="end">
                  {spec.does}
                </InfoTip>
              </span>
              <div className="grow" />
              <span className="mt-3">
                <SpendMarker spends={spec.spendsMoney} />
              </span>
              <span className="mt-2 text-[10px] leading-snug text-faint">
                pairs with level {spec.level}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-pretty text-xs leading-relaxed text-faint">
          Only Fugu Guardian has this ladder. Other kinds have no actions written yet.
        </p>
      </section>
    </div>
  );
}
