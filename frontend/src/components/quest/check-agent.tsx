"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Type an ERC-8004 id, land on that agent's Set and Earn checklist. */
export function CheckAgent() {
  const router = useRouter();
  const [id, setId] = useState("");
  const valid = /^\d{1,9}$/.test(id.trim());
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/agent/97%3A${id.trim()}#quest`);
      }}
    >
      <label htmlFor="agent-id" className="sr-only">
        Your agent&apos;s ERC-8004 id
      </label>
      <input
        id="agent-id"
        inputMode="numeric"
        placeholder="ERC-8004 id, e.g. 2545"
        value={id}
        onChange={(e) => setId(e.target.value)}
        className="w-56 rounded-full border border-line-strong bg-bg px-4 py-2 font-mono text-sm text-fg outline-none focus:border-fg"
      />
      <button
        type="submit"
        disabled={!valid}
        className="rounded-full border border-fg px-4 py-2 text-sm font-semibold text-fg transition hover:bg-fg hover:text-bg disabled:opacity-40"
      >
        Check my agent
      </button>
    </form>
  );
}
