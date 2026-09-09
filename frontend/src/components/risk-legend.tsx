import { ActionToken, SpendMarker } from "@/components/action-token";
import { Fugu } from "@/components/fugu";
import { BLOAT, BLOAT_LEVELS, GUARDIAN_ACTIONS } from "@/lib/risk";

/**
 * How to read the fish — and, kept visibly apart from it, what the agent does about what
 * the fish shows.
 *
 * These are two scales, not one. Before paying, a buyer needs two answers: **how
 * dangerous is my position** and **what will this agent do if I hire it**. Each scale
 * carries information the other does not, so both stay; but an earlier round gave them
 * lookalike prose names ("Watchful" on one, "Watching" on the other) and a reader who saw
 * one of them assumed they had both answers.
 *
 * The fix here is structural rather than lexical. The two tracks are two separately headed
 * blocks with a rule between them, each headed by the **question it answers**, and they
 * are drawn in two registers that cannot be confused: prose-in-a-pill beside a fugu for
 * risk, UPPERCASE_SNAKE_CASE monospace in a square box for actions. Nothing is
 * distinguished by colour alone, so the separation survives grayscale and colour blindness
 * exactly as the avatar assets do.
 *
 * This is a legend, not a claim: there is not a single agent number in it.
 */
export function RiskLegend() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        Two questions, two different scales
      </h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-faint">
        They are read together and they are not the same thing. One says how much trouble
        your position is in; the other says what the agent will do about it. Answering one
        is not answering both, so this legend keeps them apart.
      </p>

      {/* Track 1 — the risk state. Prose names, fugu avatars, pill chips. */}
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-medium text-fg">
            1 · How risky is the position right now?
          </h3>
          <p className="text-xs text-faint">
            Puff level. Body colour says which agent; body shape says how much risk.
          </p>
        </div>

        <ol className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {BLOAT_LEVELS.map((level) => {
            const spec = BLOAT[level];
            return (
              <li key={level} className="flex flex-col items-center text-center">
                <Fugu
                  kind="guardian"
                  level={level}
                  className="h-14 w-14"
                  animated={false}
                  label={`Risk level ${level} of 5, ${spec.name}: ${spec.ring}.`}
                />
                <span className="mt-2 rounded-full border px-2.5 py-0.5 text-sm font-medium text-fg" style={{ borderColor: spec.color }}>
                  {spec.name}
                </span>
                <span className="mt-1.5 text-[11px] leading-snug text-faint">{spec.ring}</span>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs leading-relaxed text-faint">
          Level 5 is the only one that holds still, and the only one whose ring is a
          black-and-white pattern rather than a colour — so it stays unmistakable with the
          colour taken away, and for anyone who turns animation off. A hollow, dashed fish
          means there is no fresh reading; we draw the gap rather than guess a level.
        </p>
      </section>

      {/* Track 2 — the action band. Code tokens, no avatars, square boxes. */}
      <section className="mt-7 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-medium text-fg">2 · What does the agent do about it?</h3>
          <p className="text-xs text-faint">
            Action band. These are the names in the code, not labels we wrote for the page.
          </p>
        </div>

        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {GUARDIAN_ACTIONS.map((spec) => (
            <li
              key={spec.action}
              className="flex flex-col items-start rounded-xl border border-line bg-bg-elev px-3 py-3"
            >
              <ActionToken spec={spec} />
              <span className="mt-2 text-[11px] leading-snug text-muted">{spec.does}</span>
              <span className="mt-2">
                <SpendMarker spends={spec.spendsMoney} />
              </span>
              <span className="mt-2 text-[10px] leading-snug text-faint">
                pairs with level {spec.level}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-xs leading-relaxed text-faint">
          This ladder is Fugu Guardian&apos;s, and the tokens are the <code className="font-mono">Action</code>{" "}
          union its decision engine actually branches on. The other three categories swell on
          their own metric across the same five risk levels, but they have no action ladder
          shipped yet — so their pages show the risk scale and say nothing about actions,
          rather than borrowing Guardian&apos;s.
        </p>
      </section>
    </div>
  );
}
