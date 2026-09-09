import { ActionToken, SpendMarker } from "@/components/action-token";
import { Fugu } from "@/components/fugu";
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
 * This is a legend, not a claim: there is not a single agent number in it.
 */
export function RiskLegend() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      {/* Track 1: the risk state. Prose names, fugu avatars, pill chips. */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-sm font-medium text-fg">1 · How much trouble is the money in?</h3>
          <p className="text-xs text-faint">
            Body colour says which agent. Body shape says how much risk.
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

        <p className="mt-6 text-pretty text-xs leading-relaxed text-faint">
          Level 5 is the only one that holds still, and the only one whose ring is a black-and-white
          pattern rather than a colour, so it stays unmistakable with the colour taken away and for
          anyone who turns animation off. A hollow, dashed fish means there is no fresh reading. We
          draw the gap rather than guess a level.
        </p>
      </section>

      {/* Track 2: the action band. Code tokens, no avatars, square boxes. */}
      <section className="mt-8 border-t border-line pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-sm font-medium text-fg">2 · What does the agent do about it?</h3>
          <p className="text-xs text-faint">
            These are the names in the code, not labels we wrote for the page.
          </p>
        </div>

        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {GUARDIAN_ACTIONS.map((spec) => (
            <li
              key={spec.action}
              className="flex flex-col items-start rounded-xl border border-line bg-bg-elev px-3 py-3"
            >
              <ActionToken spec={spec} />
              <span className="mt-3 text-[11px] leading-snug text-muted">{spec.does}</span>
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
          This ladder is Fugu Guardian&apos;s, and the tokens are the{" "}
          <code className="font-mono">Action</code> names its decision code actually branches on.
          The other kinds swell on their own number across the same five levels, but they have no
          ladder written yet, so their pages show the risk scale and say nothing about actions
          rather than borrowing Guardian&apos;s.
        </p>
      </section>
    </div>
  );
}
