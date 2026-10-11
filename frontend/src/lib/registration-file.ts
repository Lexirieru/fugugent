/**
 * An ERC-8004 registration file (`#registration-v1`), built in the browser for a
 * builder who registers their agent from /list instead of from a terminal.
 *
 * It is written inline as a `data:` URI, the same way our own agents' files are: an
 * `ipfs://` nobody pins resolves to nothing, and a data URI is the information itself.
 * The one endpoint the builder gives becomes the service a renter, our checklist and
 * BNB Chain's prober will call, so its name follows what it looks like: an agent card
 * is A2A, an `/mcp` path is MCP, anything else is a plain API.
 */

export interface RegistrationInput {
  name: string;
  description: string;
  endpoint: string;
  /** Optional, https only: it is shown in visitors' browsers. */
  image: string;
}

export function serviceName(endpoint: string): "A2A" | "MCP" | "API" {
  const url = endpoint.toLowerCase();
  if (url.includes("agent-card") || url.includes("agent.json") || url.includes("/a2a")) return "A2A";
  if (/\/mcp(\/|$|\?)/.test(url)) return "MCP";
  return "API";
}

export function registrationJson(input: RegistrationInput): string {
  const image = input.image.trim();
  return JSON.stringify({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.name.trim(),
    description: input.description.trim(),
    ...(image.startsWith("https://") ? { image } : {}),
    services: [{ name: serviceName(input.endpoint), endpoint: input.endpoint.trim() }],
    registrations: [],
    active: true,
    x402Support: false,
  });
}

export function registrationUri(input: RegistrationInput): string {
  const bytes = new TextEncoder().encode(registrationJson(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/json;base64,${btoa(binary)}`;
}

/** What is wrong with the form, field by field; empty when it can be signed. */
export function registrationErrors(input: RegistrationInput): Partial<Record<keyof RegistrationInput, string>> {
  const out: Partial<Record<keyof RegistrationInput, string>> = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) out.name = "Between 2 and 60 characters.";
  const description = input.description.trim();
  if (description.length < 20 || description.length > 600) out.description = "Between 20 and 600 characters. Say what it does and for whom.";
  try {
    const u = new URL(input.endpoint.trim());
    if (u.protocol !== "https:") out.endpoint = "Must start with https://";
  } catch {
    out.endpoint = "A full https:// address where your agent answers.";
  }
  const image = input.image.trim();
  if (image !== "" && !image.startsWith("https://")) out.image = "Leave empty, or an https:// image address.";
  return out;
}
