/**
 * Counting what was used.
 *
 * A pure function. No clock, no network, no model. The same records over the same stretch
 * of time always produce the same totals, which is what makes a bill something a person can
 * check rather than something they have to trust.
 *
 * ## The same thing reported twice
 *
 * A client that times out will retry, and the retry carries the same record. Counting it
 * twice means paying twice for one thing, which is the same failure as sending a payment
 * twice, arriving through a much quieter door. So records are counted by their id, and the
 * second sighting of an id is counted as a repeat rather than as more use.
 *
 * Two records sharing an id but disagreeing about what happened are a different matter
 * entirely, and that one throws. Quietly keeping the first, or the larger, or the last,
 * would be picking an answer to a question nobody asked, and the answer is somebody's
 * money.
 *
 * ## Time is a boundary, not a suggestion
 *
 * The stretch of time includes its start second and excludes its end second. Getting that
 * wrong by one second is how a single record ends up on two bills, so it is stated here and
 * tested at the exact boundary rather than near it.
 */
import { MeterError, type BillingWindow, type UsageReading, type UsageRecord, type Unit } from "./types.js";

/** Checks the stretch of time before anything is counted against it. */
export function assertWindowIsSane(window: BillingWindow): void {
  if (!Number.isInteger(window.fromSeconds) || !Number.isInteger(window.toSeconds)) {
    throw new MeterError(
      `The stretch of time runs from ${window.fromSeconds} to ${window.toSeconds}, and both ` +
        "have to be whole seconds.",
    );
  }
  if (window.toSeconds < window.fromSeconds) {
    throw new MeterError(
      `The stretch of time ends at ${window.toSeconds}, before it starts at ` +
        `${window.fromSeconds}. Nothing is counted against a stretch that runs backwards.`,
    );
  }
}

function sameRecord(a: UsageRecord, b: UsageRecord): boolean {
  return a.unit === b.unit && a.quantity === b.quantity && a.at === b.at;
}

/**
 * Adds up the records that fall inside the stretch of time.
 *
 * Records outside it are left out and counted separately, so a bill can say "forty two
 * arrived late and are not on this one" instead of silently swallowing them.
 */
export function readMeter(
  records: readonly UsageRecord[],
  window: BillingWindow,
): UsageReading {
  assertWindowIsSane(window);

  const seen = new Map<string, UsageRecord>();
  const totals = new Map<Unit, bigint>();
  let counted = 0;
  let duplicates = 0;
  let outsideWindow = 0;

  for (const record of records) {
    if (record.id.length === 0) {
      throw new MeterError(
        "A usage record arrived with no id. The id is the only thing that stops the same " +
          "piece of use being paid for twice, so a record without one is refused.",
      );
    }
    if (record.quantity < 0n) {
      throw new MeterError(
        `The record "${record.id}" reports ${record.quantity}, which is below zero. A ` +
          "correction has to arrive as its own record, not as a negative amount, otherwise a " +
          "bill can be talked down to nothing by anyone who can send records.",
      );
    }
    if (!Number.isInteger(record.at)) {
      throw new MeterError(
        `The record "${record.id}" happened at ${record.at}, which is not a whole second.`,
      );
    }

    const already = seen.get(record.id);
    if (already !== undefined) {
      if (!sameRecord(already, record)) {
        throw new MeterError(
          `Two different pieces of use both call themselves "${record.id}". One says ` +
            `${already.quantity} ${already.unit} at second ${already.at}, the other says ` +
            `${record.quantity} ${record.unit} at second ${record.at}. Choosing between them ` +
            "would be inventing an answer, so nothing is counted until whoever sent them fixes it.",
        );
      }
      duplicates += 1;
      continue;
    }
    seen.set(record.id, record);

    if (record.at < window.fromSeconds || record.at >= window.toSeconds) {
      outsideWindow += 1;
      continue;
    }

    if (record.quantity === 0n) {
      // Counted as a record so the totals below stay honest about how many arrived, but it
      // adds nothing, and it must not create a line on the bill out of nowhere.
      counted += 1;
      continue;
    }

    totals.set(record.unit, (totals.get(record.unit) ?? 0n) + record.quantity);
    counted += 1;
  }

  return { window, totals, counted, duplicates, outsideWindow };
}

/** True when nothing at all was used inside the stretch of time. */
export function readingIsEmpty(reading: UsageReading): boolean {
  for (const total of reading.totals.values()) {
    if (total > 0n) return false;
  }
  return true;
}
