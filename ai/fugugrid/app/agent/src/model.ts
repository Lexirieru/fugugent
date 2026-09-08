import { loadStudioToml, type TomlTable } from "@bnbagent/studio-runtime/config";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Otak Fugu Grid berjalan di dGrid — gateway OpenAI-compatible ke 200+ model.
 *
 * Tiga hal di bawah ini WAJIB dan masing-masing sudah memakan waktu untuk ditemukan;
 * jangan disederhanakan tanpa mengujinya lebih dulu (lihat docs/research/07-gate-teknis.md):
 *
 * 1. `.chat()` — tanpa ini @ai-sdk/openai memakai Responses API, dan dGrid menjawab
 *    dengan benar tetapi dalam format lebih ramping sehingga SDK melempar AI_APICallError.
 * 2. Header User-Agent browser — tanpa ini dGrid membalas HTTP 403.
 * 3. `@ai-sdk/openai` harus jadi dependency eksplisit; ia cuma transitif milik `ai`,
 *    dan pnpm strict menolak import langsung.
 *
 * Model ini TIDAK PERNAH mengambil keputusan finansial. Seluruh keputusan agent ini —
 * menempatkan dan mengelola order grid, memantau slot0() pool karena PancakeSwap tidak punya order-book on-chain — adalah kode deterministik di
 * src/strategy/ yang bisa di-backtest. LLM hanya menjelaskan keputusan yang sudah
 * diambil, secara asinkron. Latensi dGrid terukur 3–46 detik; menempatkannya di jalur
 * kritis berarti posisi user bisa rusak sambil menunggu kalimat penjelasan.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_BASE_URL = "https://api.dgrid.ai/v1";
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

export function buildModel(): LanguageModel {
  const cfg = loadStudioToml();
  const llmCfg = (cfg.llm ?? {}) as TomlTable;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY belum diisi di .studio/.env.local. " +
        "Isi dengan API key dGrid — nama variabelnya mengikuti konvensi provider 'openai' " +
        "di studio.toml, tetapi endpoint-nya diarahkan ke dGrid.",
    );
  }

  const dgrid = createOpenAI({
    baseURL: String(llmCfg.base_url ?? DEFAULT_BASE_URL),
    apiKey,
    headers: { "User-Agent": BROWSER_UA },
  });

  return dgrid.chat(String(llmCfg.model ?? DEFAULT_MODEL));
}
