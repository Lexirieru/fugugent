/**
 * Lapisan penjelasan. Modul ini berada DI LUAR JALUR KRITIS Guardian:
 * keputusan (`Decision`) sudah diambil secara deterministik oleh `decide()`
 * sebelum fungsi di sini dipanggil sama sekali. `explainDecision` tidak
 * pernah mengubah, menunda, atau memblokir keputusan itu — ia hanya
 * mencoba menyusun kalimat yang lebih ramah dibaca lewat LLM di dGrid.
 *
 * Bila pemanggilan LLM gagal, lambat (>20 detik), atau mengembalikan teks
 * kosong, fungsi ini WAJIB mengembalikan `decision.reason` apa adanya —
 * tidak pernah melempar. Latensi dGrid terukur 3–46 detik dan bisa saja
 * timeout atau error; posisi user tidak boleh menunggu atau gagal
 * terlindungi hanya karena kalimat penjelasan gagal disusun.
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
  // `suggestedRepayBase` adalah USD dalam basis 8 desimal Aave. Menyodorkannya
  // mentah ke prompt (dan lewat prompt, ke mata user) pernah membuat 12345678
  // — yang artinya $0,12 — terbaca sebagai belasan juta dolar. Selalu lewat
  // `formatUsd8`, dan satuannya disebut eksplisit supaya model tidak menebak.
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
 * Timer timeout dikembalikan bersama handle-nya supaya pemanggil bisa
 * `clearTimeout` begitu race selesai — menang ataupun kalah. Tanpa ini,
 * pada jalur paling umum (dGrid menjawab duluan, di bawah 20 detik), timer
 * ini tetap hidup di event loop sampai waktunya habis meski hasilnya sudah
 * tidak dipakai lagi. Guardian memanggil explainDecision berulang dalam
 * loop pemantauan posisi — timer yang tidak dibersihkan menumpuk di siklus
 * yang saling tumpang tindih dan menahan proses berumur pendek tetap hidup
 * tanpa alasan.
 *
 * Sengaja TIDAK di-unref(): timer ini adalah satu-satunya jaminan bahwa
 * explainDecision benar-benar kembali dalam 20 detik. Meng-unref timer
 * membuat Node bebas membiarkannya tidak pernah berbunyi bila tidak ada
 * pekerjaan lain yang menahan event loop — melanggar batas waktu yang
 * dijanjikan ke pemanggil (yang sedang melindungi posisi user).
 */
function timeout(ms: number): { promise: Promise<never>; handle: ReturnType<typeof setTimeout> } {
  let handle!: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`explainDecision timeout setelah ${ms}ms`)), ms);
  });
  return { promise, handle };
}

/**
 * Menjelaskan `decision` yang sudah final dalam kalimat bahasa Indonesia.
 * TIDAK PERNAH mengubah `decision` atau `pos`, dan TIDAK PERNAH melempar —
 * kegagalan apa pun (pembuatan prompt, network, timeout, teks kosong) jatuh
 * kembali ke `decision.reason` apa adanya.
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
