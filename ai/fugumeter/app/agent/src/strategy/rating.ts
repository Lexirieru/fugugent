/**
 * Turning what was used into what is owed.
 *
 * A pure function, and a deliberately boring one. Everything here is whole number
 * arithmetic on the 8 decimal dollar basis. A model is never asked what something costs:
 * a price a model produced cannot be checked against last month's usage, cannot be replayed,
 * and cannot be argued with.
 *
 * ## The price ladder
 *
 * Progressive, the way a utility bill works. Ten thousand calls against a ladder whose first
 * step tops out at one thousand means one thousand at the first price and nine thousand at
 * the next, not ten thousand at the second price. Getting that backwards makes every bill
 * wrong in the customer's favour or in ours, and neither is acceptable.
 *
 * ## Where the fractions of a cent go
 *
 * A price can be given per thousand calls, so a bill for one call has a fraction in it. That
 * fraction is rounded UP, and the reason is worth stating: this agent pays rather than
 * charges. Rounding down would leave a sliver unpaid on every bill, and slivers left unpaid
 * on every bill for a year become a debt somebody has to chase. Rounding up costs at most
 * one hundred-millionth of a dollar per line, which is less than anyone can measure.
 *
 * ## Nothing used means no bill
 *
 * Not a bill for zero, and not a minimum charge either. An agent that pays without anybody
 * approving each payment has to have one rule that never bends: it does not pay for
 * something that did not happen. A seller who wants a standing fee can bill it as use.
 */
import { readingIsEmpty } from "./meter.js";
import {
  MeterError,
  type Invoice,
  type InvoiceLine,
  type Tariff,
  type TariffStep,
  type UsageReading,
  type Unit,
} from "./types.js";

/** Checks a price ladder before anything is priced against it. */
export function assertTariffIsSane(tariff: Tariff): void {
  if (tariff.steps.length === 0) {
    throw new MeterError(`The price ladder for ${tariff.unit} has no steps, so nothing has a price.`);
  }
  let previousTop: bigint | null = 0n;
  for (let i = 0; i < tariff.steps.length; i++) {
    const step = tariff.steps[i]!;
    if (step.priceUsd8 < 0n) {
      throw new MeterError(
        `Step ${i} of the ${tariff.unit} ladder costs ${step.priceUsd8}, which is below zero.`,
      );
    }
    if (step.perQuantity <= 0n) {
      throw new MeterError(
        `Step ${i} of the ${tariff.unit} ladder prices ${step.perQuantity} of them at a time, ` +
          "which is not a usable amount.",
      );
    }
    if (previousTop === null) {
      throw new MeterError(
        `Step ${i} of the ${tariff.unit} ladder comes after a step with no top, so it can ` +
          "never be reached. A step with no top has to be the last one.",
      );
    }
    if (step.upToQuantity !== null && step.upToQuantity <= previousTop) {
      throw new MeterError(
        `Step ${i} of the ${tariff.unit} ladder tops out at ${step.upToQuantity}, which is not ` +
          `above the ${previousTop} the step before it reached. The ladder has to climb.`,
      );
    }
    previousTop = step.upToQuantity;
  }
  if (previousTop !== null) {
    throw new MeterError(
      `The ${tariff.unit} ladder stops at ${previousTop} with no step above it. Use beyond ` +
        "that would have no price at all, and this agent will not guess one.",
    );
  }
}

/** Divides and rounds up, all in whole numbers. See the note at the top about which way. */
function divideRoundingUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MeterError("A price cannot be divided by zero or less.");
  }
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/** How much `quantity` of one unit costs on one ladder, climbing step by step. */
export function priceQuantity(quantity: bigint, tariff: Tariff): { amountUsd8: bigint; explanation: string } {
  assertTariffIsSane(tariff);
  if (quantity < 0n) {
    throw new MeterError(`A quantity of ${quantity} is below zero, so it has no price.`);
  }
  if (quantity === 0n) return { amountUsd8: 0n, explanation: "nothing was used" };

  let remaining = quantity;
  let floor = 0n;
  let total = 0n;
  const parts: string[] = [];

  for (const step of tariff.steps) {
    if (remaining <= 0n) break;
    const stepCapacity: bigint =
      step.upToQuantity === null ? remaining : (step.upToQuantity as bigint) - floor;
    const takenHere = remaining < stepCapacity ? remaining : stepCapacity;
    if (takenHere > 0n) {
      const amount = divideRoundingUp(takenHere * step.priceUsd8, step.perQuantity);
      total += amount;
      parts.push(
        `${takenHere} at ${step.priceUsd8} per ${step.perQuantity} comes to ${amount}`,
      );
      remaining -= takenHere;
    }
    if (step.upToQuantity !== null) floor = step.upToQuantity as bigint;
  }

  if (remaining > 0n) {
    // Cannot happen once `assertTariffIsSane` has passed, since the last step has no top.
    // Kept because a silent underpayment is worse than a loud refusal.
    throw new MeterError(
      `${remaining} of the ${quantity} ${tariff.unit} used fell off the end of the price ladder. ` +
        "Nothing is billed for use with no price.",
    );
  }

  return { amountUsd8: total, explanation: parts.join(", ") };
}

/**
 * Turns a reading into a bill.
 *
 * Lines come out in a fixed order, not the order the units happened to be used in, so two
 * readings of the same use produce the same bill down to the byte. That matters because the
 * bill is what the payment is checked against.
 */
const UNIT_ORDER: readonly Unit[] = ["CALL", "SECOND", "UNIT"];

export function rate(reading: UsageReading, tariffs: readonly Tariff[]): Invoice {
  const byUnit = new Map<Unit, Tariff>();
  for (const tariff of tariffs) {
    if (byUnit.has(tariff.unit)) {
      throw new MeterError(
        `There are two price ladders for ${tariff.unit}. Choosing between them would be ` +
          "inventing a price, so nothing is billed.",
      );
    }
    byUnit.set(tariff.unit, tariff);
  }

  if (readingIsEmpty(reading)) {
    // Nothing used means no bill at all. See the note at the top of this file.
    return { window: reading.window, lines: [], totalUsd8: 0n, empty: true };
  }

  const lines: InvoiceLine[] = [];
  let total = 0n;

  for (const unit of UNIT_ORDER) {
    const quantity = reading.totals.get(unit);
    if (quantity === undefined || quantity <= 0n) continue;
    const tariff = byUnit.get(unit);
    if (tariff === undefined) {
      throw new MeterError(
        `${quantity} ${unit} were used and there is no price ladder for them. This agent does ` +
          "not guess a price, so nothing at all is billed until one is set.",
      );
    }
    const { amountUsd8, explanation } = priceQuantity(quantity, tariff);
    lines.push({ unit, quantity, amountUsd8, explanation });
    total += amountUsd8;
  }

  return { window: reading.window, lines, totalUsd8: total, empty: false };
}
