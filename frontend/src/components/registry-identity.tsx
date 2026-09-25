/**
 * An agent's ERC-8004 identity, as the registry contract itself holds it.
 *
 * Everything the Phase 2 brief asks a hire page to prove about an agent's origin lives
 * here: the contract it was read from, its registry id, the transaction that minted it,
 * when we read it, and whether the owner's description could be read at all. Every row
 * opens on BscScan or says why it cannot.
 *
 * The metadata line is deliberately blunt. An agent whose owner's server is down is
 * still a real agent in the registry; hiding it would make the catalogue look tidier and
 * less true. So it stays, and the page says what is wrong with it in words.
 */

import { Card } from "@/components/ui";
import type { AgentRecord, MetadataStatus } from "@/lib/agent-types";
import { CHAIN, addressUrl, shorten, txUrl } from "@/lib/chain";
import { formatUtc } from "@/lib/provenance";

function nftUrl(registry: string, tokenId: string): string {
  return `${CHAIN.explorer}/nft/${registry}/${tokenId}`;
}

/** What each resolution outcome means for someone deciding whether to hire. */
function metadataSentence(status: MetadataStatus, reason: string | null): { text: string; warn: boolean } {
  switch (status) {
    case "inline":
      return { text: "Published inside the registry entry itself, so it cannot go missing.", warn: false };
    case "fetched":
      return { text: "Fetched from the link the owner registered.", warn: false };
    case "empty":
      return { text: "The owner registered this agent with no description at all.", warn: true };
    case "unsupported":
      return {
        text: "The registry entry is not a link or a file we can read, so there is no description from the owner.",
        warn: true,
      };
    case "refused":
      return {
        text: `The owner's link points somewhere we will not fetch from a server${reason ? ` (${reason})` : ""}.`,
        warn: true,
      };
    case "unreachable":
      return {
        text: `The owner's description is not responding${reason ? `: ${reason}` : ""}. The agent is shown as the registry has it rather than hidden.`,
        warn: true,
      };
    case "invalid":
      return {
        text: `The owner's description could not be read${reason ? `: ${reason}` : ""}.`,
        warn: true,
      };
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="mt-1 min-w-0 break-words text-sm text-fg">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4"
    >
      {children} ↗
    </a>
  );
}

export function RegistryIdentity({ record }: { record: AgentRecord }) {
  const evidence = record.evidence;

  if (evidence === null) {
    return (
      <Card>
        <p className="text-pretty text-sm leading-relaxed text-fg">
          This record was not read from the ERC-8004 registry on this request.
        </p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
          It came from {record.fuguListing ? "our FuguRegistry listing" : "a stored copy"}, so there is
          no registry read to show here. The banner at the top of the page says where it came from
          and how old it is.
        </p>
      </Card>
    );
  }

  const registration = evidence.registration;
  const readAt = formatUtc(evidence.readAt);
  const registeredAt = registration?.registeredAt ? formatUtc(registration.registeredAt) : null;
  const metadata = metadataSentence(evidence.metadataStatus, evidence.metadataReason);

  return (
    <Card>
      <dl className="grid gap-5 sm:grid-cols-2">
        <Row label="Registry contract">
          <ExternalLink href={addressUrl(evidence.registryAddress)}>
            {shorten(evidence.registryAddress)}
          </ExternalLink>
          <span className="mt-1 block text-xs text-faint">ERC-8004 IdentityRegistry, {CHAIN.name}</span>
        </Row>

        <Row label="Registry id">
          <ExternalLink href={nftUrl(evidence.registryAddress, record.tokenId)}>
            #{record.tokenId}
          </ExternalLink>
        </Row>

        <Row label="Registered in">
          {registration ? (
            <>
              <ExternalLink href={txUrl(registration.txHash)}>{shorten(registration.txHash, 14, 8)}</ExternalLink>
              <span className="mt-1 block text-xs text-faint">
                Block {registration.blockNumber}
                {registeredAt ? `, ${registeredAt}` : ""}. Checked against the transaction receipt.
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">
              Not proved yet. We only show a minting transaction after reading its receipt and
              finding this id in it; open the registry id above to see the mint on BscScan.
            </span>
          )}
        </Row>

        <Row label="Owner">
          {record.ownerAddress ? (
            <ExternalLink href={addressUrl(record.ownerAddress)}>{shorten(record.ownerAddress)}</ExternalLink>
          ) : (
            <span className="text-muted">Not read</span>
          )}
        </Row>

        <Row label="Agent wallet">
          {record.agentWallet ? (
            <ExternalLink href={addressUrl(record.agentWallet)}>{shorten(record.agentWallet)}</ExternalLink>
          ) : (
            <span className="text-muted">None set in the registry</span>
          )}
        </Row>

        <Row label="Last read">
          Block {evidence.blockNumber}
          {readAt ? <span className="mt-1 block text-xs text-faint">{readAt}. The whole registry is re-read every few minutes.</span> : null}
        </Row>
      </dl>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-faint">How to reach it</p>
        {evidence.endpoints.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {evidence.endpoints.map((e) => (
              <li key={`${e.name}-${e.endpoint}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-mono text-xs text-fg">{e.name}</span>
                <span className="min-w-0 break-all font-mono text-xs text-muted">{e.endpoint}</span>
                {e.version ? <span className="text-xs text-faint">v{e.version}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">The owner declared no endpoint for this agent.</p>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Owner&apos;s description</p>
        <p className={`mt-2 text-pretty text-sm leading-relaxed ${metadata.warn ? "text-fg" : "text-muted"}`}>
          {metadata.warn ? "⚠ " : ""}
          {metadata.text}
        </p>
      </div>
    </Card>
  );
}
