/**
 * The record of what has been paid, and of what is being paid right now.
 *
 * This is the part that survives a restart, and it is the reason this agent can be killed in
 * the middle of a payment without the money going out twice.
 *
 * ## Why "paid" is not enough on its own
 *
 * A record with only "paid" in it is safe only while nothing goes wrong. The dangerous
 * moment is the gap between deciding to pay and knowing whether the payment landed: the
 * process can die there, the connection can drop there, and waiting for the result can time
 * out there AFTER the transaction already went into a block. A record that only knows about
 * completed payments says nothing at all about that gap, so the next start sees an unpaid
 * period and pays it again.
 *
 * So there are two states, and both of them block a second attempt:
 *
 *   - `IN_FLIGHT`: we decided, we wrote it down, and we may or may not have sent it.
 *   - `PAID`: we have a transaction hash back.
 *
 * Only a person moves something out of `IN_FLIGHT` when it turns out never to have been
 * sent. Not a timer. A timer that clears an in flight record is a timer that eventually pays
 * twice, and it does so at exactly the moment the network is already unreliable.
 *
 * ## Why the key is the subscription and the period
 *
 * Not the amount, not the date the agent noticed, not a counter. A period of a subscription
 * is the only thing that is the same fact seen from any run of the agent, on any machine,
 * at any later time. Anything else changes between runs, and a key that changes between runs
 * is not a key.
 */

export type LedgerStatus = "IN_FLIGHT" | "PAID";

export interface LedgerEntry {
  readonly subscriptionId: string;
  readonly periodIndex: number;
  readonly status: LedgerStatus;
  readonly amountUsd8: bigint;
  /** Which of the agents on this wallet did it. Kept so the record can be read back per agent. */
  readonly agentId: string;
  /** The second the attempt started. */
  readonly startedAt: number;
  readonly txHash: `0x${string}` | null;
}

/** Everything recorded, looked up by `chargeKey`. */
export type Ledger = Readonly<Record<string, LedgerEntry>>;

/**
 * The key for one period of one subscription.
 *
 * The separator is a character a subscription name may not contain, and that is checked
 * rather than hoped for: two different periods sharing a key would mean one of them is never
 * paid, and the other might be paid twice.
 */
export const KEY_SEPARATOR = "#";

export class LedgerError extends Error {
  readonly neverSent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export function chargeKey(subscriptionId: string, periodIndex: number): string {
  if (subscriptionId.length === 0) {
    throw new LedgerError("A repeating payment with no name has no record to keep.");
  }
  if (subscriptionId.includes(KEY_SEPARATOR)) {
    throw new LedgerError(
      `The repeating payment "${subscriptionId}" has a "${KEY_SEPARATOR}" in its name, which is ` +
        "the character that separates a name from a period. Two different periods could end up " +
        "sharing one record, so the name is refused.",
    );
  }
  if (!Number.isInteger(periodIndex) || periodIndex < 0) {
    throw new LedgerError(`Period ${periodIndex} is not a whole count from zero.`);
  }
  return `${subscriptionId}${KEY_SEPARATOR}${periodIndex}`;
}

/**
 * Has this period been dealt with already, in either sense?
 *
 * True for `PAID` and true for `IN_FLIGHT`. Answering false for something in flight is the
 * double payment bug, arriving through the quietest door there is.
 */
export function isSettled(ledger: Ledger, subscriptionId: string, periodIndex: number): boolean {
  return ledger[chargeKey(subscriptionId, periodIndex)] !== undefined;
}

export function entryFor(
  ledger: Ledger,
  subscriptionId: string,
  periodIndex: number,
): LedgerEntry | undefined {
  return ledger[chargeKey(subscriptionId, periodIndex)];
}

/**
 * Writes down that a payment is about to be attempted. Called BEFORE the payment goes out,
 * never after.
 *
 * Refuses to overwrite an existing record. If there is already something there, either it was
 * paid or it may be in the air, and in both cases the right answer is to do nothing rather
 * than to try again.
 */
export function markInFlight(
  ledger: Ledger,
  entry: Omit<LedgerEntry, "status" | "txHash">,
): Ledger {
  const key = chargeKey(entry.subscriptionId, entry.periodIndex);
  const existing = ledger[key];
  if (existing !== undefined) {
    throw new LedgerError(
      `Period ${entry.periodIndex} of "${entry.subscriptionId}" is already recorded as ` +
        `${existing.status}. Starting it again is how one bill gets paid twice.`,
    );
  }
  return { ...ledger, [key]: { ...entry, status: "IN_FLIGHT", txHash: null } };
}

/** Writes down that the payment came back with a transaction hash. */
export function markPaid(
  ledger: Ledger,
  subscriptionId: string,
  periodIndex: number,
  txHash: `0x${string}`,
): Ledger {
  const key = chargeKey(subscriptionId, periodIndex);
  const existing = ledger[key];
  if (existing === undefined) {
    throw new LedgerError(
      `Period ${periodIndex} of "${subscriptionId}" cannot be marked paid, because there is no ` +
        "record that it was ever started. A payment that was never written down first is a " +
        "payment nothing could have held back.",
    );
  }
  return { ...ledger, [key]: { ...existing, status: "PAID", txHash } };
}

/**
 * A person says "I looked at the blockchain, that payment does not exist". Explicit,
 * deliberate, and never on a timer.
 *
 * Refuses to touch anything already marked paid: undoing a completed payment is the one edit
 * that would let it happen a second time.
 */
export function clearInFlight(
  ledger: Ledger,
  subscriptionId: string,
  periodIndex: number,
): Ledger {
  const key = chargeKey(subscriptionId, periodIndex);
  const existing = ledger[key];
  if (existing === undefined) return ledger;
  if (existing.status === "PAID") {
    throw new LedgerError(
      `Period ${periodIndex} of "${subscriptionId}" is recorded as paid, with transaction ` +
        `${existing.txHash}. Removing that record would let it be paid a second time, so it ` +
        "stays.",
    );
  }
  const next = { ...ledger };
  delete next[key];
  return next;
}

/** Everything still waiting to be resolved, so an operator can see what needs looking at. */
export function inFlightEntries(ledger: Ledger): readonly LedgerEntry[] {
  return Object.values(ledger)
    .filter((e) => e.status === "IN_FLIGHT")
    .sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Drops records old enough that nothing will ever ask about them again, so the file does not
 * grow without end.
 *
 * The guard here is the important part. Pruning a record that could still be considered due
 * would let that period be paid a second time, which is the exact bug this whole file exists
 * to prevent, arriving by way of tidiness. So the caller has to say how far back the
 * schedule will ever look, and this refuses to prune anything inside that reach. It also
 * never drops anything still in flight, because those are precisely the ones a person still
 * has to resolve.
 */
export function pruneLedger(
  ledger: Ledger,
  currentPeriodIndexFor: (subscriptionId: string) => number | null,
  keepPeriods: number,
  maxBacklogPeriods: number,
): Ledger {
  if (!Number.isInteger(keepPeriods) || keepPeriods < 0) {
    throw new LedgerError(`Keeping ${keepPeriods} periods is not a whole count.`);
  }
  if (keepPeriods < maxBacklogPeriods) {
    throw new LedgerError(
      `Keeping only ${keepPeriods} periods while the schedule still looks back ` +
        `${maxBacklogPeriods} would throw away records for periods that can still come up as ` +
        "due, and each one of those would then be paid a second time.",
    );
  }
  const next: Record<string, LedgerEntry> = {};
  for (const [key, entry] of Object.entries(ledger)) {
    if (entry.status === "IN_FLIGHT") {
      next[key] = entry;
      continue;
    }
    const current = currentPeriodIndexFor(entry.subscriptionId);
    if (current === null) {
      // Nothing is known about this subscription any more, so nothing can be proven about
      // whether its records are still needed. Keeping them costs a few bytes; dropping them
      // could cost a payment.
      next[key] = entry;
      continue;
    }
    if (entry.periodIndex > current - keepPeriods) next[key] = entry;
  }
  return next;
}
