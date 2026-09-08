/**
 * The explanation layer. This module sits OFF Guardian's CRITICAL PATH: the decision
 * (`Decision`) has already been taken deterministically by `decide()` before any function
 * here is called at all. `explainDecision` never changes, delays, or blocks that decision
 * — it only tries to compose a friendlier sentence via an LLM on dGrid.
 *
 * If the LLM call fails, is slow (>20 seconds), or returns empty text, this function MUST
 * return `decision.reason` as-is — it never throws. dGrid latency measures 3–46 seconds
 * and may time out or error; a user's position must not wait, or fail to be protected,
 * just because an explanation sentence could not be written.
 */
import { generateText } from "ai";
import { buildModel } from "../model.js";
import { formatHf, formatPercentFromBps, formatUsd8 } from "./format.js";
import { type Decision, type Position } from "./types.js";

export type GenerateFn = (prompt: string) => Promise<string>;

const TIMEOUT_MS = 20_000;

function buildPrompt(pos: Position, decision: Decision): string {
  const hfStr = decision.healthFactor === null ? "tidak ada (tanpa hutang)" : formatHf(decision.healthFactor);
  const dropStr =
    decision.dropToLiquidationBps === null
      ? "tidak berlaku"
      : `${formatPercentFromBps(decision.dropToLiquidationBps)}%`;
  // `suggestedRepayBase` is USD on Aave's 8-decimal basis. Handing it to the prompt raw
  // (and through the prompt, to the user's eyes) once made 12345678 — which means $0.12 —
  // read as tens of millions of dollars. Always go through `formatUsd8`, and name the unit
  // explicitly so the model does not guess.
  const repayLine =
    decision.suggestedRepayBase > 0n
      ? `Jumlah yang disarankan dibayar: ${formatUsd8(decision.suggestedRepayBase)} (dalam dolar AS).`
      : "Tidak ada pembayaran yang disarankan saat ini.";

  return [
    "Kamu membantu menjelaskan keputusan yang SUDAH diambil oleh sistem manajemen risiko posisi pinjaman crypto.",
    `Protokol: ${pos.protocol}.`,
    `Health factor saat ini: ${hfStr}.`,
    `Jarak ke likuidasi: ${dropStr} penurunan agunan sebelum HF mencapai 1,0.`,
    `Aksi yang diambil sistem: ${decision.action}.`,
    repayLine,
    "Tulis satu atau dua kalimat penjelasan singkat dalam bahasa Indonesia untuk pemilik posisi, berdasarkan angka-angka di atas.",
    "Jangan pernah mengarang angka, persentase, atau jumlah lain di luar yang sudah diberikan di atas.",
  ].join("\n");
}

async function defaultGenerate(prompt: string): Promise<string> {
  const { text } = await generateText({ model: buildModel(), prompt });
  return text;
}

/**
 * The timeout timer is returned together with its handle so the caller can `clearTimeout`
 * as soon as the race settles — whether it won or lost. Without this, on the most common
 * path (dGrid answers first, under 20 seconds) the timer stays alive in the event loop
 * until it expires even though its result is no longer used. Guardian calls
 * explainDecision repeatedly in its position-monitoring loop — uncleaned timers pile up
 * across overlapping cycles and keep a short-lived process alive for no reason.
 *
 * Deliberately NOT unref()'d: this timer is the only guarantee that explainDecision really
 * returns within 20 seconds. Unref'ing it would let Node leave it to never fire if nothing
 * else is holding the event loop — breaking the deadline promised to the caller (which is
 * busy protecting a user's position).
 */
function timeout(ms: number): { promise: Promise<never>; handle: ReturnType<typeof setTimeout> } {
  let handle!: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`explainDecision timeout setelah ${ms}ms`)), ms);
  });
  return { promise, handle };
}

/**
 * Explains an already-final `decision` in an Indonesian sentence.
 * NEVER modifies `decision` or `pos`, and NEVER throws — any failure (building the prompt,
 * the network, a timeout, empty text) falls back to `decision.reason` as-is.
 */
export async function explainDecision(
  pos: Position,
  decision: Decision,
  deps?: { generate?: GenerateFn },
): Promise<string> {
  const generate = deps?.generate ?? defaultGenerate;
  const { promise: timeoutPromise, handle } = timeout(TIMEOUT_MS);

  try {
    const prompt = buildPrompt(pos, decision);
    const teks = await Promise.race([generate(prompt), timeoutPromise]);
    if (typeof teks === "string" && teks.trim().length > 0) {
      return teks;
    }
    return decision.reason;
  } catch {
    return decision.reason;
  } finally {
    clearTimeout(handle);
  }
}
