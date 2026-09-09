import { CONTRACTS, addressUrl, shorten, txUrl } from "@/lib/chain";
import { formatUsd8 } from "@/lib/money";
import { SEVERITY_COLOR, formatDate, linkability, shortDigest } from "@/lib/skills/format";
import type { AuditRecord, AuditStage, Finding } from "@/lib/skills/types";

/**
 * One audit, in full — every stage, every finding, the money, and the evidence.
 *
 * The whole history is shown, in whatever state each audit is in, because an audit that
 * was abandoned or that reached no verdict is part of what is known about a skill. Only
 * showing the newest completed one would let a bad result be buried under a rerun.
 */
export function AuditReport({ audit }: { audit: AuditRecord }) {
  const evidence = linkability(audit.evidence.uri);
  const digest = shortDigest(audit.auditedSha256);

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold tracking-tight text-fg">
          {audit.tier.toLowerCase()} audit of v{audit.skillVersion}
        </h3>
        <p className="font-mono text-xs text-faint">{audit.id}</p>
      </header>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row label="State">
          <span className="font-medium text-fg">{audit.state.toLowerCase()}</span>
          {audit.verdict ? (
            <span className="text-muted">
              {" "}
              · verdict {audit.verdict.toLowerCase()}
              {audit.risk ? ` · risk ${audit.risk}` : ""}
            </span>
          ) : (
            <span className="text-muted"> · no verdict yet</span>
          )}
        </Row>
        <Row label="Auditor">
          {audit.auditorId ? (
            <a
              href={`/auditors#${audit.auditorId}`}
              className="text-accent-strong underline decoration-dotted underline-offset-4"
            >
              {audit.auditorId}
            </a>
          ) : (
            <span className="text-muted">
              none selected yet — the job is funded and unassigned
            </span>
          )}
        </Row>
        <Row label="Build examined">
          <span className="font-mono text-xs text-fg">{digest ?? "not recorded"}</span>
        </Row>
        <Row label="Dates">
          <span className="tnum text-muted">
            requested {formatDate(audit.requestedAt) ?? "unknown"}
            {audit.completedAt ? ` · completed ${formatDate(audit.completedAt)}` : " · not finished"}
          </span>
        </Row>
        <Row label="Fee">
          <span className="tnum font-mono text-fg">{formatUsd8(audit.feeUsd8)}</span>
          <span className="text-muted"> paid to the auditor when the verdict stands</span>
        </Row>
        <Row label="Bond">
          <span className="tnum font-mono text-fg">{formatUsd8(audit.bondUsd8)}</span>
          <span className="text-muted">
            {audit.bondUsd8 === 0n
              ? " — no bond has been posted on this job yet"
              : " lost by the auditor if the verdict is overturned"}
          </span>
        </Row>
      </dl>

      {audit.summary ? (
        <p className="mt-4 border-l-2 border-line pl-3 text-sm leading-relaxed text-fg">
          {audit.summary}
        </p>
      ) : null}

      {audit.scope.length > 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          <span className="font-medium text-fg">Scope:</span> {audit.scope.join(" · ")}. Anything
          outside it was not examined.
        </p>
      ) : null}

      {audit.observedCapabilities.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
            What it was observed doing
          </h4>
          <ul className="mt-2 space-y-1">
            {audit.observedCapabilities.map((cap) => (
              <li key={cap} className="text-sm leading-relaxed text-fg">
                {cap}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {audit.stages.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Pipeline</h4>
          <ol className="mt-2 space-y-2">
            {audit.stages.map((stage) => (
              <StageRow key={stage.stage} stage={stage} />
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-faint">
          No pipeline stage has run yet, so there is nothing to report from one.
        </p>
      )}

      {audit.findings.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Findings</h4>
          <FindingList findings={audit.findings} />
        </div>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Evidence</h4>
        {evidence.linkable ? (
          <p className="mt-2 text-sm leading-relaxed">
            <a
              href={evidence.href}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-accent-strong underline decoration-dotted underline-offset-4"
            >
              {evidence.href} ↗
            </a>
            {audit.evidence.sha256 ? (
              <span className="mt-1 block font-mono text-xs text-faint">
                sha256 {shortDigest(audit.evidence.sha256, 24)}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The report is not openable from here — {evidence.reason}.
            {audit.evidence.sha256 ? (
              <span className="mt-1 block font-mono text-xs text-faint">
                its digest is on record: sha256 {shortDigest(audit.evidence.sha256, 24)}
              </span>
            ) : (
              " Without a report and its digest, a verdict is a rumour, which is why a SAFE" +
              " verdict in this state is reported as inconclusive rather than as a pass."
            )}
          </p>
        )}
      </div>

      <EscrowBlock audit={audit} />
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{children}</dd>
    </div>
  );
}

/**
 * A stage's outcome, said in a word and drawn with a marker whose shape differs per
 * outcome. `pass` next to `fail` must never be a hue apart and nothing else.
 */
const STAGE_MARK: Record<string, { mark: string; word: string; color: string }> = {
  pass: { mark: "✓", word: "passed", color: "var(--risk-1)" },
  warn: { mark: "!", word: "inconclusive", color: "var(--risk-3)" },
  fail: { mark: "✕", word: "failed", color: "var(--risk-5)" },
  running: { mark: "◐", word: "running", color: "var(--fg-muted)" },
  pending: { mark: "·", word: "not started", color: "var(--fg-faint)" },
};

function StageRow({ stage }: { stage: AuditStage }) {
  const mark = STAGE_MARK[stage.status] ?? {
    mark: "?",
    word: stage.status,
    color: "var(--fg-faint)",
  };
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
        style={{ color: mark.color, borderColor: mark.color }}
      >
        {mark.mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium text-fg">
          {stage.stage} — {mark.word}
        </span>
        {stage.summary ? (
          <span className="block text-sm leading-relaxed text-muted">{stage.summary}</span>
        ) : null}
        {stage.findings.length > 0 ? <FindingList findings={stage.findings} /> : null}
      </span>
    </li>
  );
}

export function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {findings.map((finding, i) => (
        <li
          key={`${finding.title}-${i}`}
          className="rounded-xl border border-line bg-bg-elev px-3 py-2.5"
        >
          <p className="flex flex-wrap items-baseline gap-2">
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                color: SEVERITY_COLOR[finding.severity] ?? "var(--fg-faint)",
                borderColor: SEVERITY_COLOR[finding.severity] ?? "var(--fg-faint)",
              }}
            >
              {finding.severity}
            </span>
            <span className="text-sm font-medium text-fg">{finding.title}</span>
          </p>
          {finding.detail ? (
            <p className="mt-1 text-sm leading-relaxed text-muted">{finding.detail}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where the fee and the bond are.
 *
 * When the backend is not pointed at an escrow it says `NOT_WIRED`, and this says so
 * plainly rather than drawing an empty progress bar. The contract itself is deployed and
 * verified, and the link goes there — a reader can see the code, and can see that this
 * particular job is not in it.
 */
function EscrowBlock({ audit }: { audit: AuditRecord }) {
  const { escrow } = audit;
  const rows: Array<[string, string | null]> = [
    ["fee funded", escrow.feeTxHash],
    ["bond posted", escrow.bondTxHash],
    ["settled", escrow.settlementTxHash],
  ];
  const anyHash = rows.some(([, hash]) => hash !== null);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Escrow</h4>
      {escrow.contract === null || !anyHash ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This job is not on chain: the backend reports{" "}
          <span className="font-mono text-xs text-fg">{escrow.status}</span>, with no job id and no
          transactions. The escrow contract itself is deployed and verified —{" "}
          <a
            href={addressUrl(CONTRACTS.auditEscrow)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
          >
            {shorten(CONTRACTS.auditEscrow)} ↗
          </a>{" "}
          — and its fee/bond/release cycle has been run end to end; those transactions are at
          the foot of this page. What has not happened is this audit being settled through it.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          <li className="text-sm text-muted">
            job{" "}
            <span className="font-mono text-xs text-fg">{escrow.jobId ?? "unnumbered"}</span> ·{" "}
            <a
              href={addressUrl(escrow.contract)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
            >
              {shorten(escrow.contract)} ↗
            </a>
          </li>
          {rows.map(([label, hash]) => (
            <li key={label} className="text-sm text-muted">
              {label}:{" "}
              {hash ? (
                <a
                  href={txUrl(hash)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
                >
                  {shorten(hash)} ↗
                </a>
              ) : (
                <span className="text-faint">not yet</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
