"use client";

import { useEffect, useState } from "react";

/** Menyalin teks apa adanya. Perintah verifikasi tidak ada gunanya kalau harus diketik ulang. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
