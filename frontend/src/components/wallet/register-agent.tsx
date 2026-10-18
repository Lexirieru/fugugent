"use client";

/**
 * Register a new agent on ERC-8004 and list it here, from the browser: a form and two
 * signatures, no terminal.
 *
 *   1. `IdentityRegistry.register(agentURI)`: the registration file is built from the
 *      form and written inline. The new id is read from the receipt's ERC-721
 *      `Transfer`, so step 2 does not wait for our registry sweep.
 *   2. `FuguRegistry.list(id, ...)`: the price, the period and the category. The
 *      contract checks the caller owns the id it just minted.
 *
 * A registered id that was never listed (the tab closed between the two) is kept in
 * localStorage per wallet, so coming back resumes at step 2 instead of minting again.
 *
 * The page says plainly what this does not do: it registers and lists an agent, it
 * does not make one run. Set and Earn counts only agents that answer and act.
 */
import { useAppKit } from "@reown/appkit/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { decodeEventLog, parseAbi } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import { CATEGORIES, type Category } from "@/lib/agent-types";
import { CHAIN, CONTRACTS, txUrl } from "@/lib/chain";
import { listingMetadataUri } from "@/lib/listing-metadata";
import { formatPricePerPeriod, parseUsdToUsd8 } from "@/lib/money";
import { registrationErrors, registrationUri, serviceName, type RegistrationInput } from "@/lib/registration-file";
import { REGISTRY_WRITE_ABI } from "@/lib/wallet/abi";
import { explainWriteError } from "@/lib/wallet/format";

const IDENTITY_ABI = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const PERIODS = [
  { seconds: 120, label: "2 minutes" },
  { seconds: 3_600, label: "1 hour" },
  { seconds: 86_400, label: "1 day" },
  { seconds: 604_800, label: "7 days" },
];

/** The four Set and Earn categories first: those are the ones a quest agent must declare. */
const ORDER: Category[] = ["YIELD", "GRID", "REBALANCING", "HEALTH_FACTOR", ...CATEGORY_ORDER.filter((c) => !["YIELD", "GRID", "REBALANCING", "HEALTH_FACTOR"].includes(c))];

type Phase =
  | { kind: "form" }
  | { kind: "signing"; step: 1 | 2 }
  | { kind: "mining"; step: 1 | 2; hash: `0x${string}` }
  | { kind: "registered"; agentId: bigint; hash: `0x${string}` | null }
  | { kind: "done"; agentId: bigint; listHash: `0x${string}` }
  | { kind: "failed"; step: 1 | 2; message: string; agentId: bigint | null };

const KEY = (a: string) => `hf:registered-unlisted:${a.toLowerCase()}`;
const input = "mt-2 w-full rounded-lg border border-line bg-bg-elev px-3 py-2 text-sm text-fg outline-none focus:border-fg";
const label = "text-xs uppercase tracking-[0.16em] text-faint";

export function RegisterAgent() {
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN.id });

  const [form, setForm] = useState<RegistrationInput>({ name: "", description: "", endpoint: "", image: "", repo: "" });
  const [category, setCategory] = useState<Category>("YIELD");
  const [priceText, setPriceText] = useState("0.05");
  const [period, setPeriod] = useState(120);
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  // An id this wallet registered here but never listed, offered back rather than
  // minted again. Read during render (no state), applied only when the user asks.
  const saved = useMemo(() => {
    if (!address || phase.kind !== "form") return null;
    try {
      const raw = window.localStorage.getItem(KEY(address));
      return raw ? (JSON.parse(raw) as { agentId: string; form: RegistrationInput; category: Category; priceText: string; period: number }) : null;
    } catch {
      return null;
    }
  }, [address, phase.kind]);
  function resume() {
    if (!saved) return;
    setForm(saved.form);
    setCategory(saved.category);
    setPriceText(saved.priceText);
    setPeriod(saved.period);
    setPhase({ kind: "registered", agentId: BigInt(saved.agentId), hash: null });
  }

  const errors = useMemo(() => registrationErrors(form), [form]);
  const priceUsd8 = useMemo(() => parseUsdToUsd8(priceText), [priceText]);
  const priceBad = priceUsd8 === null || priceUsd8 === 0n;
  const valid = Object.keys(errors).length === 0 && !priceBad;

  async function registerStep() {
    if (!address || !publicClient) return;
    setPhase({ kind: "signing", step: 1 });
    try {
      const call = { address: CONTRACTS.identityRegistry, abi: IDENTITY_ABI, functionName: "register", args: [registrationUri(form)] } as const;
      await publicClient.simulateContract({ ...call, account: address });
      const hash = await writeContractAsync({ ...call, chainId: CHAIN.id });
      setPhase({ kind: "mining", step: 1, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The registration transaction reverted.");
      let agentId: bigint | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== CONTRACTS.identityRegistry.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: IDENTITY_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === "Transfer" && ev.args.to.toLowerCase() === address.toLowerCase()) agentId = ev.args.tokenId;
        } catch {
          /* another event */
        }
      }
      if (agentId === null) throw new Error("Registered, but the new id was not in the receipt. Find it under Your agents in a few minutes.");
      try {
        window.localStorage.setItem(KEY(address), JSON.stringify({ agentId: agentId.toString(), form, category, priceText, period }));
      } catch {
        /* resuming is a convenience */
      }
      setPhase({ kind: "registered", agentId, hash });
    } catch (err) {
      setPhase({ kind: "failed", step: 1, message: explainWriteError(err), agentId: null });
    }
  }

  async function listStep(agentId: bigint) {
    if (!address || !publicClient || priceUsd8 === null) return;
    setPhase({ kind: "signing", step: 2 });
    try {
      const call = {
        address: CONTRACTS.registry,
        abi: REGISTRY_WRITE_ABI,
        functionName: "list",
        args: [
          agentId,
          address,
          CATEGORIES.indexOf(category),
          priceUsd8,
          period,
          listingMetadataUri({
            name: form.name.trim(),
            description: form.description.trim(),
            tokenId: agentId.toString(),
            category,
            agentWallet: address,
            endpointVerified: false,
            catalogueSource: "registered-on-hellofugu",
            listedAt: new Date().toISOString(),
          }),
        ],
      } as const;
      await publicClient.simulateContract({ ...call, account: address });
      const hash = await writeContractAsync({ ...call, chainId: CHAIN.id });
      setPhase({ kind: "mining", step: 2, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The listing transaction reverted.");
      try {
        window.localStorage.removeItem(KEY(address));
      } catch {
        /* nothing to clear */
      }
      setPhase({ kind: "done", agentId, listHash: hash });
    } catch (err) {
      setPhase({ kind: "failed", step: 2, message: explainWriteError(err), agentId });
    }
  }

  const shell = "rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6";

  if (!isConnected || !address) {
    return (
      <div className={shell}>
        <p className="text-sm text-fg">Connect the wallet that will own the agent. It signs twice: once to register, once to list.</p>
        <button type="button" onClick={() => open()} className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover">
          Connect wallet
        </button>
      </div>
    );
  }
  if (chainId !== CHAIN.id) {
    return (
      <div className={shell}>
        <p className="text-sm text-fg">Your wallet is on another network. HelloFugu runs on BNB Smart Chain Testnet.</p>
        <button type="button" disabled={switching} onClick={() => switchChain({ chainId: CHAIN.id })} className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50">
          {switching ? "Switching…" : "Switch to BNB Smart Chain Testnet"}
        </button>
      </div>
    );
  }

  if (phase.kind === "done") {
    const id = `97:${phase.agentId.toString()}`;
    return (
      <div className={shell} data-testid="register-done">
        <h3 className="text-lg font-semibold text-[var(--risk-1)]">Registered and listed.</h3>
        <p className="mt-2 text-sm leading-relaxed text-fg">
          {form.name.trim()} is ERC-8004 agent #{phase.agentId.toString()}, listed at {priceUsd8 !== null ? formatPricePerPeriod(priceUsd8, period) : "your price"}. Payments go to your wallet. Its page fills in once our next read of the registry runs, within about five minutes.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/agent/${encodeURIComponent(id)}#quest`} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover">
            Open its page and checklist
          </Link>
          <a href={txUrl(phase.listHash)} target="_blank" rel="noreferrer noopener" className="rounded-full border border-line px-4 py-2 font-mono text-xs text-accent-strong transition hover:border-line-strong">
            {phase.listHash.slice(0, 14)}… ↗
          </a>
        </div>
      </div>
    );
  }

  const busy = phase.kind === "signing" || phase.kind === "mining";
  const registeredId = phase.kind === "registered" ? phase.agentId : phase.kind === "failed" ? phase.agentId : null;
  const step2 = registeredId !== null;
  const fieldError = (k: keyof RegistrationInput) => (touched && errors[k] ? <p className="mt-1 text-xs text-[var(--risk-4)]">{errors[k]}</p> : null);

  return (
    <div className={shell} data-testid="register-agent">
      {saved ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent px-4 py-3">
          <p className="text-sm text-fg">You registered {saved.form.name} as agent #{saved.agentId} here but did not list it yet.</p>
          <button type="button" onClick={resume} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover">
            Continue to step 2
          </button>
        </div>
      ) : null}
      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        <li className={`rounded-full px-3 py-1 ${step2 ? "bg-[color-mix(in_srgb,var(--risk-1)_14%,transparent)] text-[var(--risk-1)]" : "bg-fg text-bg"}`}>1 · Register on ERC-8004{step2 ? " ✓" : ""}</li>
        <li className={`rounded-full px-3 py-1 ${step2 ? "bg-fg text-bg" : "bg-bg-elev text-muted"}`}>2 · List it here</li>
      </ol>

      <fieldset disabled={busy || step2} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reg-name" className={label}>Agent name</label>
          <input id="reg-name" className={input} maxLength={60} placeholder="e.g. Venus Yield Keeper" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {fieldError("name")}
        </div>
        <div>
          <label htmlFor="reg-category" className={label}>What kind of agent</label>
          <select id="reg-category" className={input} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="reg-desc" className={label}>What it does</label>
          <textarea id="reg-desc" rows={3} maxLength={600} className={input} placeholder="Say what it does and for whom, in plain words. Name the job: yield, grid, rebalancing or health factor." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {fieldError("description")}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="reg-endpoint" className={label}>Where your agent answers</label>
          <input id="reg-endpoint" className={`${input} font-mono`} placeholder="https://your-agent.example/.well-known/agent-card.json" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          {fieldError("endpoint") ?? (
            <p className="mt-1 text-xs text-faint">
              Its agent card or API address. Recorded as {serviceName(form.endpoint || "https://x")}. Renters and BNB Chain call this to check it is alive.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="reg-price" className={label}>Price per period, USD</label>
          <input id="reg-price" inputMode="decimal" className={`${input} font-mono`} value={priceText} onChange={(e) => setPriceText(e.target.value)} />
          {touched && priceBad ? <p className="mt-1 text-xs text-[var(--risk-4)]">A dollar amount above zero.</p> : null}
        </div>
        <div>
          <label htmlFor="reg-period" className={label}>One period lasts</label>
          <select id="reg-period" className={input} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.seconds} value={p.seconds}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="reg-repo" className={label}>Public GitHub repo (recommended)</label>
          <input id="reg-repo" className={`${input} font-mono`} placeholder="https://github.com/you/your-agent" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
          {fieldError("repo") ?? (
            <p className="mt-1 text-xs text-faint">Set and Earn asks for a public repo whose README shows the agent&apos;s registry ID and chain. You get the ID after step 1.</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="reg-image" className={label}>Image (optional)</label>
          <input id="reg-image" className={`${input} font-mono`} placeholder="https://…/logo.png" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} />
          {fieldError("image")}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step2 ? (
          <button type="button" disabled={busy || priceBad} onClick={() => void listStep(registeredId!)} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50">
            {busy ? (phase.kind === "mining" ? "Waiting for the block…" : "Check your wallet…") : `List agent #${registeredId!.toString()}`}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (valid) void registerStep();
            }}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? (phase.kind === "mining" ? "Waiting for the block…" : "Check your wallet…") : "Register on ERC-8004"}
          </button>
        )}
        <span className="text-xs text-muted">{step2 ? "Second signature: puts your price on it." : "First signature: mints its identity. A few cents of testnet BNB."}</span>
      </div>

      {phase.kind === "registered" && phase.hash ? (
        <p className="mt-3 text-xs text-[var(--risk-1)]">
          Registered as ERC-8004 agent #{phase.agentId.toString()}.{" "}
          <a href={txUrl(phase.hash)} target="_blank" rel="noreferrer noopener" className="font-mono underline">
            {phase.hash.slice(0, 12)}… ↗
          </a>
        </p>
      ) : null}
      {phase.kind === "failed" ? <p className="mt-3 text-xs leading-relaxed text-[var(--risk-4)]">{phase.message}</p> : null}
    </div>
  );
}
