# Altana Network — In-Depth Technical Research

> For the **"Best Built with Altana"** partner track at the BNB Chain hackathon *Build the Era / The Smart Money Era*.
> Research as of **8 September 2026**. Every claim below has a source URL. If something is not in a source, it is written out explicitly as **"not found"** — nothing here is invented.

---

## 0. Executive Summary

**Altana Network** (formerly *Functor Network*, operated by Serendipity Global Inc., Delaware, dba Altana Network) is **noncustodial authorization infrastructure for agentic workflows** — "the stack for sovereign agentic finance". Sources: <https://www.altana.network/llms.txt>, <https://docs.altana.network/llms.txt>

The core of the product is not wallet-as-a-service, but an **inversion of where authorization state is stored**: instead of keeping "which key is allowed to act" in a vendor's backend, Altana puts it in the **Keystore — a public on-chain registry**. The consequence: anyone can verify an agent's authority with one free `eth_call`, with no API key and no integration with Altana. Source: <https://docs.altana.network/concepts/keystore>

### The four layers (Altana's official framing)

| Layer | Contents |
|---|---|
| **Account** | The Smart Agentic Wallet — a self-custodial smart account per agent, with the same address on every chain |
| **Permissions** | Scoped session keys + the **Keystore** (a public registry of who is live and until when) |
| **Execution** | The **intent relay** — turns an agent's intent into an executed transaction, simulated before it is signed, with gas handled |
| **Commerce** | **x402 / B402** (pay per HTTP request) and **ERC-8183** (agents hiring and being hired, with on-chain escrow). Both directions: an agent can *earn*, not only *spend* |

Source: <https://www.altana.network/llms.txt>

### Key numbers and facts

| Item | Value |
|---|---|
| npm SDK package | `@altananetwork/sdk` **v0.9.0** (Apache-2.0, ESM, deps: `viem ^2.21.0`, `porto 0.2.37`, `ox ^0.14.0`) |
| npm MCP package | `@altananetwork/mcp` **v0.9.0** (Apache-2.0, shipped as TypeScript — **`bunx` is mandatory, not `npx`**) |
| x402 seller package | `@altananetwork/x402-server` **v0.2.0** (**GPL-3.0-or-later** ⚠️ a different licence) |
| Live chains (mainnet) | BNB Chain (56), Ethereum (1), Base (8453, cache-only) |
| Full-stack testnet | **BNB Smart Chain Testnet (97)** — keystore + account contracts + relay all present |
| Audit | CertiK, completed **15 July 2026**, scope `KeyStore.sol` + `KeyStoreCacheOPStack.sol` + 6 other files |
| Skills registry | **10 production skills**, all fork-tested 2026-07-21 |
| Codebase | The SDK is forked/extended from **Porto** (<https://porto.sh>, MIT) for Keystore compatibility |

npm sources: <https://registry.npmjs.org/@altananetwork/sdk> · <https://registry.npmjs.org/@altananetwork/mcp> · <https://registry.npmjs.org/@altananetwork/x402-server>
Audit source: <https://docs.altana.network/security/audits> · <https://skynet.certik.com/projects/altana>
Acknowledgments source: <https://docs.altana.network/acknowledgments>

### URL map

| Surface | URL |
|---|---|
| Website | <https://altana.network> |
| Architecture (technical, the keystore layer) | <https://altana.network/architecture> |
| Docs | <https://docs.altana.network> |
| **Machine-readable docs (244 KB, every page)** | <https://docs.altana.network/llms-full.txt> |
| Keystore Explorer (mainnet) | <https://explorer.altana.network> |
| Keystore Explorer (testnet) | <https://testnet.altana.network> |
| Skills Registry | <https://skills.altana.network> · index: <https://skills.altana.network/index.json> |
| XP program | <https://xp.altana.network> |
| GitHub org | <https://github.com/altananetwork> |
| Desktop app | <https://altana.network/download> |
| Contact | founders@altana.network |

> ⚠️ **`https://docs.altana.network/sitemap.xml` → HTTP 404.** What does exist is `https://altana.network/sitemap.xml` (only 5 URLs: /, /download, /architecture, /privacy, /terms). To crawl the docs, use `llms.txt` / `llms-full.txt`.

### GitHub repos (the @altananetwork org — only 4 public repos)

| Repo | Language | Description |
|---|---|---|
| `altananetwork/altana-sdk` | TypeScript | A monorepo: `packages/wallet` (the SDK), `packages/mcp`, `packages/x402-server`, `docs/` |
| `altananetwork/skills` | TypeScript | The Skills Registry — 10 `SKILL.md` files + `index.json` + a fork-test harness |
| `altananetwork/altana-desktop-releases` | — | Desktop app release artefacts |
| `altananetwork/agentic-ecosystem-board` | TypeScript | Open data on ERC-8004 agents, wallets and holdings per chain, refreshed daily |

Source: <https://api.github.com/orgs/altananetwork/repos>

---

## 1. Architecture, the Agent Wallet Concept & Sovereign Agents

### 1.1 What a "sovereign agent" means to Altana

> "An agent is only sovereign when no third party can act for it or stop it, and that comes down to who holds the keys. Handing an agent the seed phrase lets it spend everything. MPC or co-signing puts a key share with a third party that can approve, delay, or refuse. A custodial platform holds the funds outright. **With Altana, the owner holds the admin key, the agent holds a scoped session key, and no one else holds anything.**"

Source: <https://www.altana.network/llms.txt>

The division of roles (two keys that are never shared):

| Role | Key type | Held by | Revocable? |
|---|---|---|---|
| Admin (you/the user) | A passkey (P-256) **or** a private key (secp256k1) | Your device / env / keychain | No — it is yours |
| Agent | A session key (secp256k1) | The agent process | **Yes — 1 transaction** |

Source: <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>

### 1.2 The Smart Agentic Wallet

- A **counterfactual** smart account: a deterministic address, **not deployed on-chain until the first `execute`**.
- **The same address on every** configured chain.
- Based on **EIP-7702**: the wallet is an EOA delegated to an account contract.
- The admin key is auto-registered to the Keystore through `initialRegisterKey`, **batched into the first userOp**.
- ⚠️ Browser wallets (MetaMask, Trust Wallet, Rabby) **cannot be the signer** — extension wallets hold back the EIP-7702 delegation authorization and refuse to sign the raw relay digest. The only official `SignerType` values are `"privateKey" | "passkey"`.

Sources: <https://docs.altana.network/sdk/create-wallet> · <https://docs.altana.network/concepts/keystore> · <https://docs.altana.network/changelog>

### 1.3 The Keystore — an on-chain authorization registry

> "**Keystore is a public onchain registry.** For every Altana wallet, it stores which keys are currently authorized to act on it."

The data model (from the Explorer's llms.txt): a **signature-scheme-agnostic** registry mapping
```
(user, keyId) → publicKey + metadata + lifecycle state
```
where `keyId` is, by convention, `keccak256(publicKey)` (the SEC1-encoded public key).

Sources: <https://explorer.altana.network/llms.txt> · <https://docs.altana.network/concepts/keystore>

**Writes versus reads:**

| Operation | Kind | Notes |
|---|---|---|
| Register a key | Write (through the **Controller**) | Admin: automatic on the first `execute`. Session: on `grantSession` (default `register: true`) |
| Revoke a key | Write (directly to the **KeyStore**) | Gated by `onlyKeyOwnerOrValidator` — only the wallet itself or a validator. **Monotonic**: once revoked it can never be brought back |
| `isValidKey(user, keyId)` | Read — **free, unlimited** | An `eth_call` from any RPC. It answers 3 questions at once: the key exists, it is not revoked, and it has not expired |
| `getKeys(user) → bytes32[]` | Read — free | ⚠️ **Revoking removes it from the list; expiry does NOT.** A key that expired long ago still shows up in `getKeys` |

Source: <https://docs.altana.network/concepts/keystore>

**What matters for privacy:** from Altana's main page —
> "only a hash of it is committed onchain, so the registry proves authority without publishing the details"

That means `permissions` is committed as a **permissions hash**, not as plaintext. This is what forces a `Session` to be restored *byte-exact* (see §2.6). Source: <https://www.altana.network/llms.txt>

**Event vocabulary (contracts v1.1)** — what the Explorer indexes:

| Event | Contract | Meaning |
|---|---|---|
| `KeyRegistered` | KeyStore (L1) | A new key was added to the account (root or session) |
| `KeyRevoked` | KeyStore (L1) | A key was revoked. Monotonic |
| `NonceUpdated` | KeyStore (L1) | A validator counter went up (e.g. the WebAuthn signCount) |
| `FeeCollected` | Controller (L1) | A registration fee was paid; correlated to `KeyRegistered` through the tx hash |
| `KeyPopulated` | Cache (L2) | An L1 key was proven into the L2 cache |
| `KeyRevokedInCache` | Cache (L2) | An L1 revocation was propagated into the cache |

Source: <https://explorer.altana.network/llms.txt>

### 1.4 The intent relay

`execute` does not send a transaction directly; it sends an **intent/bundle** to Altana's relay, which executes it. The relay answers status polls with EIP-5792-style numeric codes. This matters for error handling (§9).

- BNB mainnet relay: `https://relay.altana.network`
- BNB testnet relay: `https://testnet-relay.altana.network`
- **Base has no relay** → `BASE` cannot be passed to `createClient`; it is purely a verification target.

Sources: <https://docs.altana.network/concepts/networks> · <https://docs.altana.network/concepts/networks/testnet>

### 1.5 Cross-chain: how authorization crosses over without a bridge

Sessions are granted on L1 (Ethereum = the source of truth). The L2 cache on Base verifies the same session through a **storage proof (Merkle Patricia) against L1 state**, anchored to an L1 block hash exposed by the L2's `L1Block` predeploy — **with no bridge message, no oracle, and no committee**.

`ensureKeyCached` handles the process in 4 stages: `cache-hit` → `waiting-for-anchor` (1–3 minutes) → `submitting-proof` → `done`.

Sources: <https://docs.altana.network/use-cases/5-cross-chain-authorization> · <https://altana.network/architecture>

> ℹ️ For our BNB hackathon, **cross-chain is unnecessary**: BNB Chain has a standalone Keystore (not a cache). The `ensureKeyCached` path only matters for Ethereum→Base.

---

## 2. Sessions — structure, granting, limits, revoking, reading from the Keystore

This is the most important section for meeting the track's winning requirements.

### 2.1 Definition

> "A **session** is a scoped, time-bounded delegation from a wallet's admin key to another key. The session key can act on the wallet, but only within the granted permissions, and only until the expiry. **Permissions are enforced onchain.** A session that tries to call a contract outside its allowlist, or spend beyond its cap, reverts at validation time. There is no off-chain trust assumption."

Source: <https://docs.altana.network/concepts/sessions>

### 2.2 The data structure (verbatim from the docs)

```ts
type Session = {
  walletAddress: Address;       // the wallet this session can act on
  signer: Signer;               // the session key (agent signs with this)
  publicKey: Hex;               // identifier onchain
  permissions: SessionPermissions;
  expiry: number;               // unix epoch seconds
};

type SessionPermissions = {
  calls?: readonly CallPermission[];   // allowed contracts / signatures
  spend?: readonly SpendPermission[];  // per-token rolling caps
};
```

Source: <https://docs.altana.network/concepts/sessions>

### 2.3 The shape of a permission — contract & selector allowlists

```ts
calls: [
  { to: "0xUniswapRouter..." },               // any method on this contract
  { signature: "transfer(address,uint256)" }, // any contract, this method
  { signature: "swap(...)", to: "0xPool" },   // both, AND semantics
]
```

**Three allowlist forms:** per contract (`to`), per selector (`signature`), or both, with **AND semantics**.

> ⚠️ **Omitting `permissions.calls` = UNRESTRICTED.** If `calls` is not passed, the session can call any contract at all, within the spend cap. The docs say it outright: "Set both unless that's truly what you want."

Source: <https://docs.altana.network/concepts/sessions>

### 2.4 Spend caps

```ts
spend: [
  { limit: 100_000_000n, period: "day", token: "0xUSDC..." }, // 100 USDC/day on Ethereum (6 decimals)
  { limit: 10n ** 16n, period: "hour" },                       // 0.01 ETH/hour (native)
]
```

- `limit` is in the token's **smallest unit**, and `period` is a **rolling period** (`"day"` and `"hour"` appear in the docs examples; the full enum of periods was **not found** in the docs).
- Omit `token` → the cap applies to the **native token**.

**Two traps documented as warnings:**

1. **Decimals differ per chain.** USDT and USDC use **18 decimals on BNB Chain**, 6 on Ethereum. Writing `100_000_000n` for "100 USDT" on BNB gives you a cap of 0.0000000001 USDT.
2. **The native spend cap also pays the relay fee.** A native cap covers the fee, not just what the agent sends. A native cap near zero (e.g. 1 wei) = a session that will never be able to execute a single transaction — the relay rejects every bundle before inclusion (`FAILED`, `statusCode` **300**).

Source: <https://docs.altana.network/sdk/grant-session>

### 2.5 `grantSession` — the full signature

```ts
client.grantSession(opts: ClientGrantSessionOptions): Promise<GrantSessionResult>;

type ClientGrantSessionOptions = {
  wallet: Wallet;
  signer: Signer;                  // the wallet's admin signer
  permissions: SessionPermissions;
  /** Unix epoch seconds. Most apps use Date.now()/1000 + N. */
  expiry: number;
  /** Bring your own session signer, or omit to let the SDK generate one. */
  sessionSigner?: Signer;
  /** Register the key in Keystore (default true). */
  register?: boolean;
  /** Fee token (default: native token). */
  feeToken?: Address;
  /** Target chain. Defaults to the client's default chain. */
  chainId?: number;
};

type GrantSessionResult = Session & {
  /** The transaction that carried the grant, when the relay reported one. */
  transactionHash?: Hex;
};
```

**A complete example (verbatim from the docs):**

```ts
import { createClient, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const admin = signerFromPrivateKey("0x...");
const wallet = await client.createWallet({ signer: admin });

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: [{ to: "0xUniswapRouter..." }],
    spend: [{
      limit: 50n * 10n ** 18n,    // 50 USDT. Note: 18 decimals on BNB Chain.
      period: "day",
      token: "0xUSDT...",
    }],
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
});
```

**What lands on-chain — in ONE userOp, atomically:**
1. The session's public key is registered in the Keystore (through the Controller) → **making its authority provable to anyone**.
2. The session is authorized on the wallet's smart account with its **permissions hash**.

> "There is no intermediate state where one exists without the other."

⚠️ **This call costs the user money.** There is a one-time Keystore registration fee; on a wallet's first admin action the fee is paid **twice**, because `initialRegisterKey` for the admin is prepended to the same userOp. `register: false` skips the fee (but then `verify_authorization` / a Keystore reader will not see that session → **do not use `register: false` for this hackathon**; the winning requirements demand a session registered in the Keystore).

Registering later: `await client.registerSessionKey({ wallet, signer: admin, session });`

⚠️ **A TypeScript gotcha:** an explicit annotation `const session: Session = await client.grantSession(...)` **strips** the `transactionHash` field. Let the type be inferred, or annotate it as `GrantSessionResult`.

Source: <https://docs.altana.network/sdk/grant-session>

### 2.6 Persisting a session — you MUST use `serializeSession` / `deserializeSession`

> "A `Session` embeds the session's private key and bigint spend limits, so **never `JSON.stringify` it**."

Since SDK **0.9.0** (2026-09-02) the internal key fields are **non-enumerable**, so `JSON.stringify`/`Object.keys` never see them. Anyone who used to rely on that leak for persistence **has to migrate**.

```ts
import { generatePrivateKey } from "viem/accounts";
import { signerFromPrivateKey, serializeSession, deserializeSession } from "@altananetwork/sdk";

// Grant: bring your own key, and store it where you keep secrets.
const sessionKey = generatePrivateKey();
await secrets.save("agent-1.key", sessionKey);                 // keychain, KMS, env — yours

const session = await client.grantSession({
  wallet, signer: admin,
  sessionSigner: signerFromPrivateKey(sessionKey),
  permissions, expiry,
});
await db.save("agent-1.session", serializeSession(session));   // JSON-safe, contains NO secret

// Restore — any process, any time:
const restored = deserializeSession(
  await db.load("agent-1.session"),
  signerFromPrivateKey(await secrets.load("agent-1.key")),
);
```

- `serializeSession` stores `walletAddress`, `publicKey`, `permissions` (with spend limits as **decimal strings**), and `expiry`.
- `deserializeSession` restores the bigints and **rejects a key that does not match** the registered session's `publicKey` → it fails loudly at restore time rather than silently at execute time.
- ⚠️ If `sessionSigner` is omitted, the SDK generates a key that **exists only in the process's memory** and prints a console warning. If it is lost (a crash, or the script finishing), the on-chain authorization backed by that key is **permanently unusable** — the only way out is revoke-and-regrant.

**For our product: ALWAYS pass your own `sessionSigner`.**

Sources: <https://docs.altana.network/sdk/grant-session#persisting-a-session> · <https://docs.altana.network/changelog>

### 2.7 `execute` — using the session key

```ts
client.execute(opts: ClientExecuteOptions): Promise<ExecuteResult>;

// Admin path (first-party operations)
{ wallet: Wallet; signer: Signer; calls: Call | readonly Call[];
  feeToken?: Address; noWait?: boolean; chainId?: number; }

// Session path (agent-driven operations)
{ session: Session; calls: Call | readonly Call[];
  feeToken?: Address; noWait?: boolean; chainId?: number; }

type Call = { to: Address; data?: Hex; value?: bigint };

type ExecuteResult = {
  callsId: Hex;
  status: "CONFIRMED" | "FAILED" | "PENDING";
  transactionHash?: Hex;
  statusCode?: number;   // the relay's raw numeric status, when observed
};
```

```ts
const result = await client.execute({
  session,
  calls: [{ to: "0xYourContract", data: "0x", value: 0n }],
});
console.log(result.status, result.transactionHash);
```

**Keystore impact:**

| Scenario | Touches the Keystore? |
|---|---|
| The first admin `execute` on a new wallet | Yes (the admin key gets registered) |
| Subsequent admin `execute`s | No |
| **Every session `execute`** | **No** (the session was already registered at grant time) |

⚠️ **A failed `execute` DOES NOT throw.** It returns `status: "FAILED"`. If you only `try/catch`, you will never notice.

Sources: <https://docs.altana.network/sdk/execute> · <https://docs.altana.network/sdk/errors>

### 2.8 `revokeSession`

```ts
client.revokeSession(opts: ClientRevokeSessionOptions): Promise<ExecuteResult>;

type ClientRevokeSessionOptions = {
  wallet: Wallet;
  signer: Signer;                 // the wallet's admin signer
  session: Session | Hex;         // the Session object or its public key
  feeToken?: Address;
  chainId?: number;
};
```

```ts
// The shortest form
await client.revokeSession({ wallet, signer: admin, session });

// When you only have the public key (the common UI case: the user clicks "revoke" from a list in the DB)
const sessionPublicKey = "0x04..." as `0x${string}`;
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```

- Once confirmed, **the next `execute` from that session reverts at the validation stage**.
- The effect is **immediate** on the chain where the key is registered; no off-chain coordination is needed.
- **Monotonic** — once revoked, it can never be reactivated. To grant access again: grant a new session with a new keypair.
- Only the wallet's **admin signer** can revoke (`onlyKeyOwnerOrValidator`).
- A failed revoke **returns** `status: 'FAILED'`; it does not throw.

**Cross-chain revocation (only if you use Ethereum→Base):**

```ts
import { syncKeyToL2, ETHEREUM, BASE } from "@altananetwork/sdk";

await client.revokeSession({ wallet, signer: admin, session });
await syncKeyToL2({
  l1Client, l2Client, l2WalletClient,
  l1KeyStore: ETHEREUM.keyStore,
  l2Cache: BASE.keyStoreCache,
  user: session.walletAddress,
  publicKey: session.publicKey,
});
```

Source: <https://docs.altana.network/sdk/revoke-session>

### 2.9 Reading a session from the on-chain Keystore (third-party verification)

This is what the judges will do. **Free, no API key, no admin key, no session, nothing from Altana at all.**

```ts
import { createPublicClient, http, keccak256 } from "viem";
import { BNB } from "@altananetwork/sdk";

const client = createPublicClient({
  chain: BNB.chain,
  transport: http(BNB.publicRpcUrl),
});

// Keystore identifies a key by its key id: keccak256 of the SEC1-encoded public key.
const keyId = keccak256(sessionPublicKey);

const KEYSTORE_ABI = [{
  name: "isValidKey", type: "function", stateMutability: "view",
  inputs: [
    { name: "user", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ type: "bool" }],
}] as const;

// One eth_call answers: is this key allowed to act on this wallet right now?
const authorized = await client.readContract({
  address: BNB.keyStore,
  abi: KEYSTORE_ABI,
  functionName: "isValidKey",
  args: [walletAddress, keyId],
});
```

- `isValidKey` returns `true` **only if** the key exists, has not been revoked, and has not expired.
- For a wallet's whole key set: `getKeys(walletAddress)` → `bytes32[]`, then check each one with `isValidKey`.
- ⚠️ Remember: revoking removes it from `getKeys` immediately, **expiry does not**.

**A note on sub-delegation (verbatim from the docs):**
> "Only the wallet admin grants sessions. Do not read this as one agent minting a sub-key for another. It is the admin authorizing both agents, and the agents verifying each other. If session-to-session sub-delegation lands later, the docs will be updated."

Sources: <https://docs.altana.network/use-cases/4-verify-agent-authority> · <https://docs.altana.network/concepts/keystore>

### 2.10 The lifecycle in brief

| Stage | Function | Keystore impact |
|---|---|---|
| Grant | `grantSession` | **A write.** The session public key is registered by default |
| Use | `execute({ session, calls })` | None |
| Verify | Anyone reads `isValidKey` | None. Free, unlimited |
| Revoke | `revokeSession` | **A write** (gated by `onlyKeyOwnerOrValidator`). Monotonic |
| Expire | Automatic at `expiry` | None. **No transaction** |

Source: <https://docs.altana.network/concepts/sessions>

---

## 3. Contract Addresses — BNB Mainnet & Testnet

### 3.1 BNB Smart Chain — the SDK's `BNB` export

| Item | Value |
|---|---|
| Chain id | **56** |
| Public RPC | `https://bsc-rpc.publicnode.com` |
| Explorer | <https://bscscan.com> |
| Relay | `https://relay.altana.network` |
| **KeyStore** | `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` |
| **KeyStoreController** | `0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555` |

Source code verification: <https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> (source-verified, exact match)

### 3.2 BNB Smart Chain Testnet — the SDK's `BNB_TESTNET` export

| Item | Value |
|---|---|
| Chain id | **97** |
| Public RPC | `https://bsc-testnet-rpc.publicnode.com` |
| Explorer | <https://testnet.bscscan.com> |
| **Faucet** | <https://testnet.bnbchain.org/faucet-smart> |
| Relay | `https://testnet-relay.altana.network` |
| **KeyStore** | `0x6b8361C29d05D498b1a12B54A37310f94171E94A` |
| **KeyStoreController** | `0xb530D1971f5453F3359518343F05D0AedFfF7e12` |

**The account stack (used by the relay) — testnet:**

| Contract | Address |
|---|---|
| Orchestrator | `0xcb5CEf3C54aa90e9A7ad602A258D3d360cC862B9` |
| Delegation proxy | `0x4F4ddE38Da9F8AbBb96C48cA520b992D4bADc3D6` |
| Account implementation | `0x33aD2F49ab9f122f5F0FDF579f575724EfF353DE` |
| Simulator | `0x3006de101E96e85272d5B5Ad07A9738fa7678008` |
| Funder | `0xb248602EAadd9c3e2Db4575C4e4d58003b7a2740` |
| Escrow | `0xCd075ceb5Cd463a9233a8085fc915767139F655c` |

**Testnet tokens:**

| Token | Address | Function |
|---|---|---|
| EXP | `0xa8071DA5e994cB8e3eB56CaD0FBB6ca424dD8dc0` | A fee token (pay the relay fee with a test token instead of tBNB) |
| EXP2 | `0x61727778216127D0843A99A3e91e99C27e9f3BC7` | A fee token |
| **$U token** | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | The agent economy token, ERC-8183 escrow |
| **$U faucet** | `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3` | `requestTokens()` → 10 $U per address every 30 minutes |

> ⚠️ The account-stack addresses above **only exist for testnet** on the docs page. Their BNB mainnet equivalents were **not found** in the public documentation (the `/concepts/networks` page for BNB lists only the KeyStore + KeyStoreController).

### 3.3 Ethereum & Base (for reference, not used for this track)

| Network | Chain id | Contracts |
|---|---|---|
| Ethereum (`ETHEREUM`) | 1 | KeyStore `0xb70fDa90C1d576Ba8399946a0c10ECD9d9Ea923b` · Controller `0x30a188Eecf14F4142B0d828ce838C9E1134e7FaA` · RPC `https://ethereum-rpc.publicnode.com` · Relay `https://relay.altana.network` |
| Base (`BASE`) | 8453 | KeyStoreCache `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` · RPC `https://base-rpc.publicnode.com` · **no relay, read-only** |

### 3.4 ERC-8183 / ERC-8004 — the address registry (from the SDK source code)

Taken verbatim from `packages/wallet/src/erc8183.ts`, the `ERC8183_ADDRESSES` export:

| Contract | BSC Mainnet (56) | BSC Testnet (97) |
|---|---|---|
| `commerce` (the AgenticCommerce kernel) | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` |
| `router` (EvaluatorRouter) | `0x51895229E12F9876011789B04f8698af06cCD6DA` | `0xD7d36D66d2F1B608A0F943f722D27e3744f66F25` |
| `policy` (OptimisticPolicy) | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` |
| `registry` (ERC-8004 identity, ERC-721) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| `paymentToken` (**$U** / United Stables) | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |

Source: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>
The source of truth for all network addresses: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/config.ts>

### 3.5 BNB mainnet protocol addresses (from the Skills Registry — for building the allowlist)

| Protocol | Contract | Address |
|---|---|---|
| PancakeSwap | V2 Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| PancakeSwap | V2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| PancakeSwap | USDT/WBNB pair (LP) | `0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE` |
| — | WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| — | USDT (BSC-USD) | `0x55d398326f99059fF775485246999027B3197955` |
| — | USDC (BNB) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| Four.meme | TokenManager2 (curve V2) | `0x5c952063c7fc8610FFDB798152D69F0B9550762b` |
| Four.meme | TokenManagerHelper3 (reads) | `0xF251F83e40a78868FcfA3FA4599Dad6494E46034` |
| Venus | vUSDT (core pool) | `0xfD5840Cd36d94D7229439859C0112a4185BC0255` |
| Lista | ListaStakeManager | `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` |
| Lista | slisBNB | `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` |
| Aave V3 | Pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` |
| Aave V3 | aBnbUSDT (aToken) | `0xa9251ca9DE909CB71783723713B21E4233fbf1B1` |
| Permit2 | canonical | `PERMIT2_ADDRESS` is exported from `@altananetwork/sdk` (the docs mention the prefix `0x0000…78BA3`) |

Sources: <https://skills.altana.network/llms-full.txt> · <https://docs.altana.network/use-cases/6-agent-pays-api-x402> · <https://docs.altana.network/concepts/off-chain-signatures>

---

## 4. The SDK & MCP Server

### 4.1 `@altananetwork/sdk` — v0.9.0

```bash
npm install @altananetwork/sdk viem
```

| Metadata | Value |
|---|---|
| Latest version | `0.9.0` (released 2026-09-02) |
| Version history | 0.3.2 → 0.3.3 → 0.4.0 → 0.5.0 → 0.5.1 → 0.6.0 → 0.7.0 → 0.7.1 → 0.8.0 → **0.9.0** |
| Licence | Apache-2.0 |
| Module type | ESM (`"type": "module"`) |
| Dependencies | `viem ^2.21.0`, `porto 0.2.37`, `ox ^0.14.0` |
| Repo | `github.com/altananetwork/altana-sdk`, directory `packages/wallet` |
| Unpacked size | ~440 KB |

> ⚠️ **Pre-1.0. A minor version can contain breaking changes.** (From the docs: "These packages are pre-1.0. Minor versions may contain breaking changes.") **Pin the exact version in `package.json`.**

Sources: <https://registry.npmjs.org/@altananetwork/sdk> · <https://docs.altana.network/changelog>

#### The API surface (from the docs + llms.txt)

**Client & chains**
- `createClient({ chains, defaultChainId? })`
- Chain config exports: `BNB`, `BNB_TESTNET`, `ETHEREUM`, `BASE`
- The chain config properties used in the docs examples: `.chain`, `.publicRpcUrl`, `.keyStore`, `.keyStoreCache`

**Signers**
- `signerFromPrivateKey(pk)` — from a hex private key
- `createPrivateKeySigner()` — generate a new one
- `createPasskey()` — a passkey (browser, WebAuthn)
- `createHeadlessPasskey()` — an in-memory P-256 passkey for Node/test scripts, with no biometric prompt
- `SignerType` = `"privateKey" | "passkey"` (since 0.9.0, `"injected"` has been removed from the union)

**Wallets**
- `client.createWallet({ signer? })` → `{ address, signer }`
- `client.createPasskeyWallet({ name, rpId })`
- `client.recoverFromPasskey({ rpId, webAuthn? })`

**Sessions & execution**
- `client.grantSession(opts)` → `GrantSessionResult`
- `client.execute(opts)` → `ExecuteResult`
- `client.revokeSession(opts)` → `ExecuteResult`
- `client.registerSessionKey({ wallet, signer, session })`
- `serializeSession(session)` / `deserializeSession(stored, signer)`

**Reads**
- `client.balances({ wallet, tokens?, chainId? })` → `{ native: bigint, tokens?: TokenBalance[] }`
  - Batched multicall; per token `{ ok, display, symbol, raw, scaled? }`
  - Handles **BEP-677** scaled UI amounts automatically (ERC-165 id `0xa60bf13d`)

**Cross-chain**
- `ensureKeyCached(...)`, `syncKeyToL2({ l1Client, l2Client, l2WalletClient, l1KeyStore, l2Cache, user, publicKey })`

**Off-chain signatures & payments**
- `signOrder` / `signOrderTypedData` — an ERC-1271 nested envelope
- `client.fetchWithX402({ session, url, init?, chainId?, preferRail? })`
- `client.approveTokenForPermit2({ wallet, signer, token })`
- `client.approveSignatureChecker({ wallet, signer, session, checker })`
- `PERMIT2_ADDRESS`
- Low-level: `fetchWithX402`, `selectX402Requirement`, `signX402Payment`, `buildPermit2TypedData`, `buildPermit2WitnessTypedData`, `buildEip3009TypedData`, `encodeXPaymentHeader`, `networkToChainId`, `normalizeResource`

**ERC-8183**
- `hireErc8183Agent`, `buildHireCalls`, `getErc8183Job`, `getErc8183DeliverableUrl`, `verifyErc8183ManifestText`, `submitErc8183Deliverable`, `buildSubmitCall`, `erc8183SubmitPermissions(chainId)`, `settleErc8183Job`, `buildClaimRefundCall`, `encodeErc8183Manifest`, `erc8183ManifestHash`, `ERC8183_ADDRESSES`, `JOB_STATUS`

**ERC-8004**
- `registerErc8004Agent`, `setErc8004AgentUri`, `getErc8004Agent`, `encodeErc8004AgentUri`, `decodeErc8004AgentUri`, `withErc8004Registration`, `erc8004RegisterPermissions(chainId)`

Sources: <https://docs.altana.network/sdk> and all the `/sdk/*` pages via <https://docs.altana.network/llms-full.txt>

### 4.2 A complete code example — grant → execute → revoke (verbatim from the docs)

**Step 1: Create your wallet**
```ts
import { createClient, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const signer = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);

const wallet = await client.createWallet({ signer });
console.log(wallet.address);
```
> **Fund `wallet.address` with BNB before step 2.**

**Step 2: Grant the agent a session**
```ts
import { createPrivateKeySigner } from "@altananetwork/sdk";
import { parseEther } from "viem";

const session = await client.grantSession({
  wallet,
  signer,
  sessionSigner: createPrivateKeySigner(),                  // the agent's key — SDK generates it
  permissions: {
    calls: [{ to: "0xYourContract" }],                      // only this contract
    spend: [{ limit: parseEther("0.1"), period: "day" }],   // 0.1 BNB per day
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
});
```

**Step 3: The agent executes**
```ts
const result = await client.execute({
  session,
  calls: [{ to: "0xYourContract", data: "0x", value: 0n }],
});

console.log(result.status, result.transactionHash);
```

**Step 4: Revoke the session**
```ts
await client.revokeSession({ wallet, signer, session });
```

Source: <https://docs.altana.network/use-cases/1-agent-wallet-policy>

### 4.3 Example: an agent trading on a DEX with a cap (PancakeSwap)

```ts
// wallet from the "Give an agent a wallet and a policy" guide
const session = await client.grantSession({
  wallet,
  signer,
  permissions: {
    calls: [{ to: "0xPancakeRouter..." }],                          // only this router
    spend: [{ limit: 100_000_000_000_000_000_000n, period: "day", token: "0xStable..." }],
  },
  expiry: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
});

// The agent builds swap calldata and executes within the cap.
await client.execute({
  session,
  calls: [{ to: "0xPancakeRouter...", data: "0xSwapCalldata...", value: 0n }],
});
```

Source: <https://docs.altana.network/use-cases/2-agent-trades-dex>

### 4.4 Example: multiple agents on one wallet (relevant to our marketplace)

```ts
// Agent A: swaps on PancakeSwap, cap X.
const sessionA = await client.grantSession({
  wallet, signer,
  permissions: {
    calls: [{ to: "0xPancakeRouter..." }],
    spend: [{ limit: capX, period: "day", token: "0xStable..." }],
  },
  expiry,
});

// Agent B: lending / rebalance, cap Y.
const sessionB = await client.grantSession({
  wallet, signer,
  permissions: {
    calls: [{ to: "0xLendingPool..." }],
    spend: [{ limit: capY, period: "day", token: "0xStable..." }],
  },
  expiry,
});

// Revoke Agent A without touching Agent B:
await client.revokeSession({ wallet, signer, session: sessionA });
// Agent B keeps working.
```

Source: <https://docs.altana.network/use-cases/3-portfolio-multiple-agents>

### 4.5 The passkey path (for a consumer UI — the user is the admin via Face ID / Touch ID)

```ts
import { createClient, BNB } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });

const wallet = await client.createPasskeyWallet({
  name: "MyApp",
  rpId: "myapp.example", // your app's domain
});

const session = await client.grantSession({
  wallet,
  signer: wallet.signer,          // your passkey signs this
  permissions: {
    calls: [{ to: "0xSomeContract..." }],
    spend: [{ limit: 50_000_000_000_000_000n, period: "day" }], // 0.05 BNB/day cap
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 1 day
});

// recovery on any device
const recovered = await client.recoverFromPasskey({ rpId: "myapp.example" });

// revoke
await client.revokeSession({ wallet, signer: wallet.signer, session });
```

For testing in Node/scripts without a biometric prompt:
```ts
import { createClient, BNB, createHeadlessPasskey } from "@altananetwork/sdk";
const client = createClient({ chains: [BNB] });
const wallet = await client.createWallet({ signer: createHeadlessPasskey() });
```

There is an **interactive live demo** of this flow on the docs page (the `<PasskeyAgentDemo />` component) — buttons that call the SDK directly against BNB. Useful for a quick check before writing code.

Source: <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>

⚠️ `recoverFromPasskey` needs at least one active key in the Keystore → **the wallet must have executed at least once**. A wallet that was created but never used has nothing to recover.

### 4.6 `@altananetwork/mcp` — v0.9.0

**Bun ≥ 1.1 is MANDATORY.** This package is shipped as TypeScript and runs under Bun. **`npx` fails with a TypeScript syntax error**, not with a useful message.

```bash
claude mcp add altana -- bunx @altananetwork/mcp
# to remove:
claude mcp remove altana
```

Pick the chain through the `ALTANA_CHAIN` env var (one server process = one chain):

| `ALTANA_CHAIN` | Chain |
|---|---|
| `bnb` (default) | BNB Smart Chain (56) |
| `ethereum` | Ethereum (1) |
| `bnb-testnet` | BNB Smart Chain Testnet (97) |

```bash
claude mcp add altana -e ALTANA_CHAIN=bnb-testnet -- bunx @altananetwork/mcp
```

Cursor / Continue / other hosts:
```json
{
  "mcpServers": {
    "altana": {
      "command": "bunx",
      "args": ["@altananetwork/mcp"]
    }
  }
}
```

> ℹ️ A note on source inconsistency: `https://altana.network/llms.txt` shows the MCP snippet with `"command": "npx"`, while the docs page `/mcp/install` says explicitly that **npx fails** and every example there uses `bunx`. **Follow the docs: use `bunx`.**

**Key storage (separate namespaces, they never collide):**

| Kind | Lookup order |
|---|---|
| Wallet admin key | 1. The OS keychain service `altana-wallet` → 2. `~/.altana/keys.json` → `wallets[]` (mode 0600) → 3. the env var `ALTANA_WALLET_<NAME>_PRIVATE_KEY` (default: `ALTANA_WALLET_DEFAULT_PRIVATE_KEY`) |
| Session key | 1. The OS keychain service `altana-session` → 2. `~/.altana/keys.json` → `sessions[]` → 3. the env var `ALTANA_SESSION_<NAME>_PRIVATE_KEY` |

> "Altana never sees these keys. They stay on your machine."

Sources: <https://docs.altana.network/mcp/install> · <https://registry.npmjs.org/@altananetwork/mcp>

### 4.7 MCP tools — 20 tools

> ⚠️ An inconsistency inside their own documentation: the `/mcp` page says "**18 tools** … **12 prompts**", while `/mcp/tools` says "**20 tools** … **Eleven** of them also have a slash command" and then lists 12 slash commands (11 tools + `demos`, which does not map to a tool). The actual list on `/mcp/tools` contains **20 tools**; that is the one used below.

| Category | Tools |
|---|---|
| Discovery | `about_altana` |
| Wallet lifecycle | `create_wallet`, `list_wallets`, `wallet_balance`, `wallet_execute` |
| **Verification** | `wallet_verification` (lists every active key on a wallet from the Keystore), **`verify_authorization`** (is this key/session authorized on this wallet right now?) |
| **Session lifecycle** | **`grant_session`** (generates a key, registers it in the Keystore, authorizes it with permissions; returns the session details, the **keyId**, and the **grant tx hash**), `list_sessions`, **`session_execute`**, **`revoke_session`** |
| Agent commerce | `x402_request`, `erc8183_create_job`, `erc8183_job_status`, `erc8183_settle`, `erc8183_submit` |
| Agent identity | `erc8004_register`, `erc8004_set_agent_uri`, `erc8004_show` |
| Skills | `search_skills`, `get_skill` |

**Slash commands (11 tools + `demos`):**

| Slash command | Calls |
|---|---|
| `/altana-agentic-wallet:about` | `about_altana` |
| `/altana-agentic-wallet:create-wallet` | `create_wallet` |
| `/altana-agentic-wallet:list-wallets` | `list_wallets` |
| `/altana-agentic-wallet:wallet-balance` | `wallet_balance` |
| `/altana-agentic-wallet:wallet-info` | `wallet_verification` |
| `/altana-agentic-wallet:verify-session` | `verify_authorization` |
| `/altana-agentic-wallet:grant-session` | `grant_session` |
| `/altana-agentic-wallet:list-sessions` | `list_sessions` |
| `/altana-agentic-wallet:session-execute` | `session_execute` |
| `/altana-agentic-wallet:revoke-session` | `revoke_session` |
| `/altana-agentic-wallet:send-tx` | `wallet_execute` |
| `/altana-agentic-wallet:demos` | (lists the demo flows, not a tool) |

**The 10 tools with NO slash command** (host-callable only; ask the host to call them by name): `x402_request`, `erc8183_create_job`, `erc8183_job_status`, `erc8183_settle`, `erc8183_submit`, `erc8004_register`, `erc8004_set_agent_uri`, `erc8004_show`, `search_skills`, `get_skill`. Typing `/altana-agentic-wallet:x402-request` **will not resolve**.

Source: <https://docs.altana.network/mcp/tools>

### 4.8 The Claude Code Skill (for writing correct SDK code)

```bash
mkdir -p .claude/skills/altana-agentic-wallet
curl -fsSL https://docs.altana.network/skill.md \
  -o .claude/skills/altana-agentic-wallet/SKILL.md
```

For Codex: `curl -fsSL https://docs.altana.network/skill.md >> AGENTS.md`
For Cursor: put it in `.cursor/rules/` · Windsurf: `.windsurfrules` · Gemini CLI: `GEMINI.md`

The full skill source: <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/SKILL.md>

> ℹ️ **Do not mix these up:** this Claude Skill teaches a coding agent how to **write code** with the SDK. The **Skills Registry** (§7) teaches a *running* agent how to **use the protocols**. Different audiences, different files, the same `SKILL.md` format.

Sources: <https://docs.altana.network/mcp/skill> · <https://docs.altana.network/getting-started/build-with-claude>

---

## 5. ERC-8183 — Hire & Get Hired

### 5.1 What the spec is

**ERC-8183 is a job escrow** for agent commerce:

1. The **buyer** funds a **Job** in **$U** against a **seller** address.
2. The **seller** submits a **deliverable**.
3. The escrow **releases** after an **optimistic dispute window**.
4. If the seller never delivers, the buyer **reclaims** the whole escrow after expiry.

Job statuses (order-locked with the AgenticCommerce kernel):
```ts
export const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
```

The Job structure (from the SDK source):
```ts
export type Erc8183Job = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  statusName: JobStatusName;
  hook: Address;
  submittedAt: bigint;
  /** 32 zero-bytes until the seller submits. */
  deliverable: Hex;
};
```

Sources: <https://docs.altana.network/sdk/erc8183> · <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>

**How it relates to ERC-8004:** ERC-8004 = **identity/discoverability** (an ERC-721 token in the identity registry, whose `tokenURI` is the registration record: name, description, endpoint). The buyer finds the seller through ERC-8004, and then **the ERC-8183 job escrow is what they do next**. Source: <https://docs.altana.network/sdk/erc8004>

### 5.2 Buyer side — `hireErc8183Agent`

```ts
import { hireErc8183Agent, BNB } from "@altananetwork/sdk";

const { jobId } = await hireErc8183Agent(wallet, signer, {
  provider: "0xSellerAgentAddress",
  task: "Audit wallet 0x…'s Venus position and recommend an action.",
  budget: 100_000_000_000_000_000n, // 0.1 $U (18 decimals)
}, { network: BNB });
```

> "One call runs the whole buyer flow — `createJob`, `registerJob` (binds the dispute policy), `setBudget`, `approve $U`, `fund` — as **one atomic relay intent**."

**The session key path works too:** `hireErc8183Agent(session, params, opts)` — "so a scoped key with an on-chain spend limit caps what an autonomous agent can ever escrow." **This is the strongest part of the bonus track: an autonomous agent hiring another agent, bounded by an on-chain spend cap.**

The low-level builder: `buildHireCalls({ addresses, jobId, provider, description, budget, expiredAt })`.
The `jobId` is predicted from `jobCounter() + 1` (job ids are 1-indexed); if another job is created in the same block, the batch reverts with no side effects (`registerJob` is client-only) — re-read the counter and retry.

`description` must be ≤ 4096 bytes. `expiredAt` is absolute unix seconds and **must be later than now + disputeWindow**.

### 5.3 Tracking a job and fetching the deliverable

```ts
import { getErc8183Job, getErc8183DeliverableUrl } from "@altananetwork/sdk";

const job = await getErc8183Job(BNB, jobId);       // OPEN → FUNDED → SUBMITTED → COMPLETED
if (job.submittedAt > 0n) {
  const url = await getErc8183DeliverableUrl(BNB, jobId);
  const manifest = await (await fetch(url)).json(); // manifest.response.content
}
```

**Integrity verification (MANDATORY):** the on-chain `job.deliverable` is the keccak256 of the canonical manifest.

```ts
import { verifyErc8183ManifestText } from "@altananetwork/sdk";

const text = await (await fetch(url)).text();
if (!verifyErc8183ManifestText(text, job.deliverable)) throw new Error("tampered deliverable");
const manifest = JSON.parse(text); // manifest.response.content
```

### 5.4 Seller side — `submitErc8183Deliverable`

Grant the seller's session with `erc8183SubmitPermissions(chainId)` — a capability scoped **exactly to `submit()` on the commerce kernel**.

```ts
import { submitErc8183Deliverable, erc8183SubmitPermissions } from "@altananetwork/sdk";

const result = await submitErc8183Deliverable(
  session,                      // or (wallet, signer, …) for the admin path
  {
    jobId,
    manifest: {
      version: 1,
      job_id: Number(jobId),
      chain_id: 56,
      contracts: { commerce: A.commerce, router: A.router, policy: A.policy },
      response: { content: "…the work…", content_type: "text/plain" },
      metadata: {},
    },
    deliverableUrl: "https://your-agent.example/manifests/123.json",
  },
  { network: BNB },
);

// Serve result.manifestText VERBATIM at deliverableUrl — byte-for-byte.
```

**Two things that are easy to get wrong if you do it by hand:**

1. **Canonical hashing across languages.** The on-chain hash is computed over *canonical JSON*: sorted keys, compact, and **every non-ASCII character escaped as `\uXXXX`** — exactly like the Python reference (`json.dumps(…, sort_keys=True, separators=(",", ":"))` with the default `ensure_ascii`). A plain `JSON.stringify` produces different bytes for any content containing an em-dash, an accent, or an emoji, and its hash will not verify across ecosystems. Use `encodeErc8183Manifest` / `erc8183ManifestHash`.
2. **Serve the exact bytes that were hashed.** The buyer verifies the *raw* fetched text against the on-chain hash — re-serializing when you serve it breaks verification. `result.manifestText` is the string you have to serve.

Pre-flight checks throw actionable errors before submitting: wrong provider, the job is not FUNDED yet (or is already SUBMITTED), or the deadline has passed.
Low-level: `buildSubmitCall({ addresses, jobId, deliverable, optParams })`.

### 5.5 Settle / dispute / reclaim

```ts
import { settleErc8183Job, buildClaimRefundCall } from "@altananetwork/sdk";

await settleErc8183Job(wallet, signer, { jobId }, { network: BNB });          // release escrow (after the window)
await settleErc8183Job(wallet, signer, { jobId, action: "dispute" }, opts);   // contest (inside the window)
await execute(wallet, signer, buildClaimRefundCall(56, jobId), opts);         // full refund after expiry
```

### 5.6 Getting testnet $U

There is a public faucet on BSC testnet (97): `requestTokens()` pays **10 $U** to the caller, once per address every **30 minutes**. Claim it straight from an Altana wallet through the relay — the smart account is `msg.sender`, so the payout lands in the wallet:

```ts
import { encodeFunctionData } from "viem";
import { createClient, BNB_TESTNET } from "@altananetwork/sdk";

const U_FAUCET = "0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3";

const client = createClient({ chains: [BNB_TESTNET] });
await client.execute({
  wallet,
  signer,
  chainId: 97,
  calls: [{
    to: U_FAUCET,
    data: encodeFunctionData({
      abi: [{ name: "requestTokens", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
      functionName: "requestTokens",
    }),
  }],
});
```

Or from an ordinary EOA with test BNB for gas:
```bash
cast send 0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3 "requestTokens()" \
  --rpc-url https://bsc-testnet-rpc.publicnode.com --private-key $AGENT_KEY
```

The read-only `allowedToWithdraw(address)` reports whether a claim is currently allowed.

### 5.7 ⚠️ A testnet bug that IS ALREADY FIXED in 0.9.0

From the 0.9.0 changelog:
> "**BSC testnet (chain 97) hire flow no longer reverts.** The bundled `ERC8183_ADDRESSES[97].policy` pointed at an address that is not whitelisted on the testnet EvaluatorRouter, so every `hireErc8183Agent()` / `buildHireCalls()` run on BSC testnet reverted at `registerJob` with `PolicyNotWhitelisted()`."

**The practical consequence: if we use ERC-8183 on BSC testnet, `@altananetwork/sdk` ≥ 0.9.0 is MANDATORY.** Version 0.8.0 and below will revert.

Source: <https://docs.altana.network/changelog>

### 5.8 ERC-8004 — granting the capability safely

```ts
import { createClient, erc8004RegisterPermissions, BNB, signerFromPrivateKey } from "@altananetwork/sdk";

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: erc8004RegisterPermissions(56),
    // A small native cap covers gas; nothing else can leave the wallet.
    spend: [{ limit: 20_000_000_000_000_000n, period: "day" }], // 0.02 BNB
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
});
```

`erc8004RegisterPermissions(chainId)` returns two `{ to, signature }` rules with **AND semantics**:
```ts
[
  { to: "0x8004A169…", signature: "register(string,(string,bytes)[])" },
  { to: "0x8004A169…", signature: "setAgentURI(uint256,string)" },
]
```

> 🚨 **NEVER grant the whole registry.** The docs mark this `:::danger`: a session executes **as the wallet**, and the wallet is the owner of the identity token. Granting `{ to: registry }` with no `signature` also authorizes `transferFrom`/`safeTransferFrom` (the agent could give its identity away), `approve`/`setApprovalForAll` (**an operator approval that OUTLIVES the session revocation**), and `setAgentWallet`/`setMetadata` (identity poisoning).
>
> **This is a perfect example for our demo/pitch: why selector-level allowlists matter, not just contract-level ones.**

Registration is 2-phase (because the record embeds the id assigned by the mint):

```ts
import {
  registerErc8004Agent, setErc8004AgentUri, encodeErc8004AgentUri,
  withErc8004Registration, BNB,
} from "@altananetwork/sdk";

// Phase 1: registrations is empty — the id does not exist yet.
const record = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Vault Sentinel",
  description: "Watches Venus positions and alerts on liquidation risk.",
  image: "",
  services: [{ name: "A2A", endpoint: "https://sentinel.example/.well-known/agent-card.json" }],
  registrations: [],
} as const;

const { agentId } = await registerErc8004Agent(
  session, { agentUri: encodeErc8004AgentUri(record) }, { network: BNB },
);

// Phase 2: bind the assigned id to this registry and publish the finished record.
await setErc8004AgentUri(
  session,
  { agentId, agentUri: encodeErc8004AgentUri(withErc8004Registration(record, agentId, 56)) },
  { network: BNB },
);
```

⚠️ `registerErc8004Agent` **rejects `opts.noWait`** — the `agentId` only exists in the `Registered` event on a confirmed receipt. If the relay wait times out, the error carries the `callsId` — recover the id from that bundle's receipt, **do not register again** (that would mint a SECOND identity for the same agent).

`register` and `setAgentURI` are `nonpayable`: **there is no protocol fee, only gas.**

`encodeErc8004AgentUri` produces `data:application/json;base64,<canonical JSON>` — byte-identical to what the TypeScript SDK and the Python `@bnbagent` SDK produce for the same record.

Source: <https://docs.altana.network/sdk/erc8004>

---

## 6. x402 / B402

### 6.1 The difference between x402 and B402 on BNB Chain

| Aspect | x402 (the standard) | B402 (Binance/BNB) |
|---|---|---|
| Wire | HTTP 402 + an `X-PAYMENT` header (base64) | The same, but some merchants read `PAYMENT-SIGNATURE` |
| Primary rail | `exact` / **EIP-3009** `TransferWithAuthorization` | **permit2-exact** — `PermitWitnessTransferFrom` with the recipient bound through a Permit2 **witness** |
| Checker (ERC-1271) | the token contract | the canonical **Permit2** |
| Compatible tokens | only tokens whose EIP-3009 is ERC-1271-aware (Circle FiatTokenV2_2 — USDC on Base/Ethereum) | any token approved to Permit2 |
| Envelope | `payload.permit` + a sibling `payload.from` (the Altana dialect) | `payload.permit2Authorization` with a nested `from` (the b402 dialect) |
| `resource` | may be a URL string | usually an object `{ url, description?, mimeType? }` — merchants reject an envelope without it (CoinMarketCap answers `payment header resource is null`) |

**The practical conclusion for BNB Chain: use the `permit2-exact` rail.** It is "the reliable rail" according to the docs. The EIP-3009 rail on BNB only matters for **$U** (which BNB Agent Studio buyers use).

Sources: <https://docs.altana.network/sdk/x402> · <https://docs.altana.network/concepts/off-chain-signatures>

### 6.2 Buyer side — `fetchWithX402`

**One-time provisioning (admin):**
```ts
import { createClient, BNB, PERMIT2_ADDRESS, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB] });
const admin = signerFromPrivateKey("0x...");
const wallet = await client.createWallet({ signer: admin });
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // BNB USDC

const session = await client.grantSession({
  wallet, signer: admin,
  permissions: {
    calls: [{ to: USDC }],
    spend: [{ limit: 1_000_000_000_000_000_000n, period: "day", token: USDC }],
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
});

await client.approveTokenForPermit2({ wallet, signer: admin, token: USDC });
await client.approveSignatureChecker({ wallet, signer: admin, session, checker: PERMIT2_ADDRESS });
```

**The agent pays and fetches:**
```ts
const res = await client.fetchWithX402({
  session,
  url: "https://api.example.com/paid-endpoint",
});
// 402 → sign payment → retry → 200 + content, transparently.
console.log(res.status, await res.text());
```

The parameters:
```ts
type ClientFetchWithX402Options = {
  session: Session;
  url: string;
  init?: RequestInit;
  /** Only pay options on this chain when any match. Defaults to the client's chain. */
  chainId?: number;
  /** Preferred rail when a chain offers several. Defaults to "permit2". */
  preferRail?: "permit2" | "eip3009";
};
```

⚠️ **Run `fetchWithX402` server-side.** Third-party x402 endpoints commonly leave `X-PAYMENT` out of the CORS `Access-Control-Allow-Headers`, so a browser cannot POST the payment.

⚠️ **The signature is not an EOA signature** — it is a 98-byte ERC-1271 envelope (`innerSig ‖ keyHash ‖ prehash`). A facilitator **has to** verify it through `isValidSignature`, not `ecrecover`. A payment can be valid and settleable on-chain and still be rejected by a facilitator that assumes an EOA.

Sources: <https://docs.altana.network/use-cases/6-agent-pays-api-x402> · <https://docs.altana.network/sdk/x402>

### 6.3 Why `approveSignatureChecker` is mandatory

An Altana account does not verify a signature against the raw application digest. It re-wraps that digest in a **nested EIP-712 envelope** locked to the account's address:

```
nested = keccak256(0x1901 ‖ domainSeparator ‖ structHash)
  domainSeparator = keccak256(abi.encode(
                      keccak256("EIP712Domain(address verifyingContract)"), wallet))
  structHash      = keccak256(abi.encode(
                      keccak256("ERC1271Sign(bytes32 digest)"), appDigest))
```

The account's EIP-712 domain is deliberately **trimmed down to `verifyingContract` alone** (no name/version/chainId).

And: a session key's `isValidSignature` returns the magic value **only if `msg.sender` is an approved checker** for that key (super-admin keys bypass this gate). Without `approveSignatureChecker`, verification returns `0xffffffff` even for a perfectly valid signature.

| Rail | The checker that must be approved |
|---|---|
| Permit2 / permit2-exact | the canonical Permit2 (`0x0000…78BA3`) |
| EIP-3009 | the token contract itself (e.g. USDC) |

Run it **once per session, per rail**.

Sources: <https://docs.altana.network/concepts/off-chain-signatures> · <https://docs.altana.network/sdk/approve-signature-checker>

### 6.4 Seller side — `@altananetwork/x402-server`

```bash
npm install @altananetwork/x402-server viem
```

> "`@altananetwork/x402-server` is the seller side of x402/B402: put one guard in front of any HTTP route and it becomes a paid capability with instant on-chain settlement."

**Payable out of the box by:**
- **BNB Agent Studio agents** (`bag x402 trust <your-url>` → `bag x402 buy`) — they sign an EIP-3009 `TransferWithAuthorization` in **$U (United Stables)**
- **Altana wallets** (`fetchWithX402` / the MCP `x402_request`) — a smart-account session key signs the B402 permit2-exact rail (ERC-1271)
- Anything that speaks the **B402 v2 wire** (CAIP-2 networks, `scheme:"exact"`, `extra.assetTransferMethod`)

**A complete example (verbatim from the repo README):**

```ts
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { createX402Merchant, U_TOKEN, USDT_BSC } from "@altananetwork/x402-server";

const merchant = createX402Merchant({
  chainId: 56,
  payTo: "0xYourAltanaSmartAccount",          // where earnings land
  price: 200_000_000_000_000_000n,            // 0.2 per call (18 dec)
  minPrice: 50_000_000_000_000_000n,          // clamp floor
  maxPrice: 2_000_000_000_000_000_000n,       // clamp ceiling
  rails: [
    { rail: "eip3009", token: U_TOKEN[56] },  // Studio buyers
    { rail: "permit2-exact", token: USDT_BSC, spender: facilitator.address }, // Altana/B402 buyers
  ],
  resource: "https://api.example.com/audit",
  facilitator: privateKeyToAccount(process.env.FACILITATOR_KEY),  // settler EOA (gas only)
  rpcUrl: "https://bsc-dataseed.binance.org",
  chain: bsc,
});

Bun.serve({
  port: 8080,
  async fetch(req) {
    const { response, receipt } = await merchant.guard(req);
    if (response) return response;             // 402 (challenge or rejection)
    return Response.json({ data: await doTheWork(), tx: receipt.txHash });
  },
});
```

**The exports that exist:** `createX402Merchant`, `U_TOKEN` (a chainId → $U address map), `USDT_BSC`.

**The per-call payment flow:**
1. A request with no payment → `merchant.guard(req)` returns `{ response }` containing a **402 challenge** with the payment requirements (`accepts[]`: scheme, network, asset, amount, receiver).
2. The buyer signs the authorization, base64-encodes it into the `X-PAYMENT` header, and retries.
3. `guard()` runs off-chain checks first (token, amount within `[minPrice, maxPrice]`, recipient, expiry, signature).
4. On-chain settlement happens **immediately** through the facilitator EOA (which only broadcasts and pays gas).
5. `guard()` returns `{ response: undefined, receipt }` → your route runs, with `receipt.txHash` available.

| Rail | Buyer signs | Settled via | Verified by |
|---|---|---|---|
| `eip3009` | `TransferWithAuthorization` ($U) | `token.transferWithAuthorization(bytes)` | the token contract |
| `permit2-exact` | `PermitWitnessTransferFrom` | `Permit2.permitWitnessTransferFrom` | Permit2 |

**Security properties:**
- Funds move **directly from the payer to `payTo`**. The recipient is **bound into the buyer's signature** (the EIP-3009 `to` / the permit2 Witness) → **a compromised facilitator key cannot redirect the earnings**.
- **Replay is impossible**: the EIP-3009 nonce and the Permit2 nonce bitmap are burned on-chain.
- A checker-restricted smart-account signature (an Altana session key) is verified by **the settling contract itself**; an invalid payment reverts and the request is rejected.

**Compatibility rules for BNB Agent Studio buyers:**
- Offer `maxTimeoutSeconds ≤ 480` (the default is 300). The Studio signer refuses an authorization window > 600s and **backdates `validAfter` by 120 seconds**.
- Studio buyers pay in **$U over eip3009 ONLY** — include that rail if you want them to be able to pay you.
- `bag x402 trust` **requires an https URL in production**.

**Buyer envelope dialects** the decoder accepts, so it need not know which client is paying: `payload.permit` + `payload.from` (Altana) **or** `payload.permit2Authorization` with a nested `from` (b402); the header is read from `X-PAYMENT` with a `PAYMENT-SIGNATURE` fallback; `resource` may be a URL string or an object, and is always emitted as an object.

**Verified end-to-end:** `tests/e2e/fork-x402-server.ts` runs both buyer families against a real BNB mainnet fork (real $U, USDT, and Permit2 bytecode): settlement of a Studio eip3009 envelope, settlement of an Altana session-key permit2-witness, and replay rejection. Run `bun run fork:x402-server` from `tests/e2e`.

> ⚠️ **A different licence:** `@altananetwork/x402-server` is **GPL-3.0-or-later**, while `@altananetwork/sdk` and `@altananetwork/mcp` are Apache-2.0. Consider the implications if we want our server code to be closed-source. (Source: each package's npm registry entry.)

> ⚠️ **The `repository.url` in the npm manifest for `x402-server` points at `github.com/altananetwork/sdk`, which does not exist** (the real repo is `altana-sdk`). A typo in their package.json; the actual README is at `altana-sdk/packages/x402-server/README.md`.

Sources: <https://docs.altana.network/sdk/x402-server> · <https://github.com/altananetwork/altana-sdk/blob/main/packages/x402-server/README.md> · <https://registry.npmjs.org/@altananetwork/x402-server>

---

## 7. The Skills Registry — 10 Production Skills

<https://skills.altana.network> · index JSON: <https://skills.altana.network/index.json> · the full catalogue: <https://skills.altana.network/llms-full.txt> · raw canonical: <https://raw.githubusercontent.com/altananetwork/skills/main/index.json>

### 7.1 The concept

> "A session gives your agent authority. A skill gives it competence."

A skill is **a single `SKILL.md` file** that teaches an agent how a protocol actually works: the right contracts, the quirks that break a naive integration, and the exact call order for every common action. Altana tests each skill with a **real agent on a private mainnet fork** before it goes live. They are **free to use**, and agents find them on their own.

**The critical separation (this is what makes a skill safe to share):**
> "A skill is public, readable text. It cannot grant anything… An agent holding the PancakeSwap skill and no session can do exactly nothing."

The "may not" column in each catalogue entry is **not a promise from the skill's author** — it is what **your session enforces on-chain**, and what anyone can verify from the Keystore.

**The house rule that must never be broken:** plays **never sign**. Every on-chain write goes through the Altana session executor — `client.execute({ session, calls })` (SDK) or the MCP `session_execute` tool. Reads go straight to the RPC. "That one rule is what keeps a skill from being able to widen its own scope."

Sources: <https://docs.altana.network/skills> · <https://skills.altana.network/llms.txt>

### 7.2 The anatomy of a skill (4 parts)

1. **Frontmatter** — `name` (= the directory name, the skill id), `description` (one sentence starting with a verb, naming the protocol + chain). This is the text an agent matches against when searching the registry.
2. **Reference** — a table of checksummed addresses (only the contracts the plays actually touch) + **Quirks**: 3–6 protocol facts that break a naive integration, one line each plus the function signature.
3. **Playbook** — 2–5 **plays** per skill, each naming its parameters and a **Typical time**, with numbered steps so an agent can run a whole play in one script.
4. **Guards (do not remove)** — the safety decisions: output floors, on-chain balance verification after every state change, retry limits, and what to do on failure ("stop and report, never improvise outside the session scope"). **Certification verifies the guards, so a submission cannot trim them.**

> **The address table serves double duty: the suggested session scope is derived from it.**

Sources: <https://docs.altana.network/skills> · <https://docs.altana.network/skills/submit>

### 7.3 How to call them

**Through MCP (the intended path):**
```bash
claude mcp add altana -- bunx @altananetwork/mcp
```
- `search_skills({ query })` → the matching skills + their scope + a certification scorecard, ranked by how many query words match
- `get_skill({ id })` → the full `SKILL.md`. **The content is integrity-checked against the registry `sha256` before it is returned** — a tampered playbook is rejected, not followed. It also returns the scope (allowed contracts, suggested spend cap) and the scorecard.

The registry URL defaults to the public repo's main branch; **override it with the `ALTANA_SKILLS_INDEX_URL` env var**.

**Over plain HTTPS (without MCP):**
- `https://skills.altana.network/index.json`
- `https://skills.altana.network/llms-full.txt` (all 10 SKILL.md files in one fetch)
- `https://skills.altana.network/skills/<id>/SKILL.md`

Sources: <https://skills.altana.network/llms.txt> · <https://docs.altana.network/mcp/tools>

### 7.4 The full catalogue — 10 skills

All are `verified: fork-tested by Altana` on **2026-07-21**. All have `publisher: Altana`.
`askAt` says when the input is requested: **`grant`** = when the session is created (it goes into the policy), **`run`** = when the play is run.

---

#### 1. PancakeSwap Trading — `pancakeswap-trading` v1.0.0
- **Chain:** bnb · **Category:** Trading · **Suggested cap:** 50 USDT
- **sha256:** `8721c5294ac8e3475ab7b14c41f397061e9c4de550f86c5ec17a51da8db1f4d5`
- **Description:** Buy and sell tokens on PancakeSwap on BNB Chain through an Altana session. In and out of positions fast, with quotes, slippage protection, and full-balance exits.
- **Scope contracts:** PancakeSwap V2 Router `0x10ED43C718714eb63d5aA57B78B54704E256024E` · WBNB `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` · USDT `0x55d398326f99059fF775485246999027B3197955`
- **Inputs:** `token` (address, run) · `amountUsdt` (usd, run) · `slippagePct` (percent, run, default 1) · `takeProfitPct` (percent, run) · `stopLossPct` (percent, run)
- **Plays:** `enter-position`, `exit-position`, `round-trip`, `tp-sl-watch`
- **May:** Trade on PancakeSwap; Spend up to the cap you set
- **May not:** Send funds anywhere else; Touch any other app or token
- **Example ask:** *"ape $20 into $TOKEN, sell at 30% profit"*
- **Important quirks:** USDT on BNB has **18 decimals**, not 6 → $20 = `20n * 10n**18n`. Route selection: quote the direct pair **AND** the WBNB hop with `getAmountsOut`, and use whichever is better. Approve before each swap direction. Fee-on-transfer tokens need `swapExactTokensForTokensSupportingFeeOnTransferTokens`.

#### 2. Four.meme Trading — `four-meme` v1.0.0
- **Chain:** bnb · **Category:** Trading · **Suggested cap:** 0.1 BNB
- **sha256:** `c39a51afa14cee0ff6dac9803547641f07f3c58efc8bae9dc6ad5c3353e0070b`
- **Description:** Snipe and trade memecoin launchpad curves on Four.meme, and hand off to PancakeSwap after graduation.
- **Scope contracts:** TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b` · TokenManagerHelper3 (reads) `0xF251F83e40a78868FcfA3FA4599Dad6494E46034` · PancakeSwap V2 Router (post-graduation) · WBNB
- **Inputs:** `token` (address, run) · `amountBnb` (bnb, run) · `amountToken` (amount, run — also accepts `"all"`) · `slippagePct` (percent, run, default 3)
- **Plays:** `buy-on-curve`, `sell-on-curve`, `check-curve-status`, `round-trip`, `graduation-handoff`
- **May:** Buy and sell on Four.meme curves; Spend BNB up to the cap you set
- **May not:** Send funds anywhere else; Touch any other app or token
- **Example ask:** *"snipe 0.05 BNB into this four.meme launch, sell at 2x"*

#### 3. PancakeSwap Liquidity — `pancakeswap-liquidity` v1.0.0
- **Chain:** bnb · **Category:** Liquidity · **Suggested cap:** 50 USDT
- **sha256:** `80d8bb4435689a2a696b22ebbf295c7f805c43f6287d1cd0c6e97951c3548b0f`
- **Description:** Provide and withdraw PancakeSwap V2 liquidity to earn trading fees on your token pairs.
- **Scope contracts:** V2 Router · V2 Factory `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` · WBNB · USDT · the USDT/WBNB pair (LP) `0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE` — *pair tokens are approved to the router only*
- **Inputs:** `tokenA`, `tokenB` (address, run) · `amount` (amount, run — the other side is derived from the pool ratio) · `lpAmount` (amount, run — also `"all"`) · `slippagePct` (default 1)
- **Plays:** `add-liquidity`, `remove-liquidity`, `position-check`
- **May:** Add and remove PancakeSwap liquidity; Spend up to the cap you set
- **Example ask:** *"put $50 into the USDT/WBNB pool and show my share"*

#### 4. Copy Trade — `copy-trade` **v1.1.0** (the only one that is not 1.0.0)
- **Chain:** bnb · **Category:** Trading · **Suggested cap:** 50 USDT
- **sha256:** `d5458abd494a096f4ba208e7e534259fffdd1b5351a37130ec634514e18d1e37`
- **Description:** Mirror a wallet you name on PancakeSwap under hard per-trade and total caps.
- **Scope contracts:** PancakeSwap V2 Router · V2 Factory · WBNB · USDT — *traded tokens are approved to the router only*
- **Inputs (all `askAt: grant` — they go into the policy!):** `leaderWallet` (address) · `perTradeMaxUsd` (usd, default 10) · `totalBudgetUsd` (usd, default 50) · `screenTokens` (boolean, default true)
- **Plays:** `follow`, `mirror-exit`, `stop`
- **May:** Mirror the PancakeSwap trades of the wallet you name; Spend up to the caps you set
- **May not:** Follow any wallet you did not give it; Exceed per-trade or total caps; Send funds anywhere else; Touch any other app
- **Example ask:** *"copy 0xab...'s trades, $10 max each, stop at $50"*
- 💡 **The most interesting skill for our UI demo** — every input is asked for at the *grant* stage, so the "set the agent's permissions" UI has a rich form that maps directly onto the session policy.

#### 5. Venus Lending — `venus-lending` v1.0.0
- **Chain:** bnb · **Category:** Lending · **Suggested cap:** 100 USDT
- **sha256:** `69bcf2a17ffe4624dcb9d98321299f166e045787a6ffad1219f0f5d331f77bf7`
- **Description:** Lend stablecoins on Venus Protocol on BNB Chain through an Altana session.
- **Scope contracts:** vUSDT (core pool) `0xfD5840Cd36d94D7229439859C0112a4185BC0255` · USDT
- **Inputs:** `amountUsdt` (usd, run — withdraw also accepts `"all"`)
- **Plays:** `supply`, `withdraw`, `position-check`, `pay-once`, `auto-refill`
- **May:** Supply and withdraw stablecoins on Venus; Spend up to the cap you set
- **Example ask:** *"lend $100 USDT on venus"*
- 🚨 **A CRITICAL WARNING (from the docs Errors page):** the Venus core-pool **vBNB `redeem` REVERTS** from an Altana wallet. The reason: an Altana wallet is a delegated EOA (EIP-7702); paying a wallet native coin through `.transfer()`/`.send()` only forwards the 2300-gas stipend, which is not enough to run the delegated account code. **ERC-20 payouts are unaffected.** Workarounds: use the wrapped-token path (WBNB), a gateway that pays with a full-gas `call{value:}` (the Venus NativeTokenGateway where it is deployed), or receive into a plain EOA. **There is no SDK-side fix** — the root cause is in the paying contract. → **For the demo, use vUSDT (ERC-20), NOT vBNB.**

#### 6. x402 API Payments — `x402-payments` v1.0.0
- **Chain:** **multi** · **Category:** Payments · **Suggested cap:** 25 USDT
- **sha256:** `8250aae2d2ba2ce1320e5fc1b48e6389e5751b197e787c3e65199143b9fb75b7`
- **Description:** Pay for APIs and services over HTTP with the x402 protocol from an Altana session. Per-use payments in stablecoins, no accounts or cards, spend-capped and revocable.
- **Scope contracts:** Permit2 · USDT (BSC-USD)
- **Inputs:** `maxPricePerPaymentUsd` (usd, **grant**, default 1) · `totalBudgetUsd` (usd, **grant**, default 25) · `resourceUrl` (url, run)
- **Plays:** `pay-once` (~10s), `auto-refill` (loops until the budget runs out)
- **May:** Pay x402 invoices per request; Spend up to the cap you set
- **Guards:** Always enforce the max price; never sign an authorization above it. Track cumulative spend and stop at the budget. **Only pay the endpoint the user named — do not follow a 402 from a redirect to a different host without reporting first.**
- **Quirks:** Amounts are in the smallest unit (USDT on BNB = 18 decimals). **The session signs via ERC-1271 through the smart account: the wallet that pays is the smart account address, NOT the session key address.** The BNB rail uses Permit2 with USDT; the USDT→Permit2 approval happens once and is handled by the SDK on the first payment. Payments count against the session's spend cap like any other outflow.

#### 7. Lista Liquid Staking — `lista-staking` v1.0.0
- **Chain:** bnb · **Category:** Staking · **Suggested cap:** 0.5 BNB
- **sha256:** `67f15a40d3b2cf09a7317ca0a9e3a07dab083001cc17a999c46764cf1406e5ac`
- **Description:** Stake BNB for slisBNB on Lista and earn staking yield while staying liquid.
- **Scope contracts:** ListaStakeManager `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` · slisBNB `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` (approved to the manager only)
- **Inputs:** `amountBnb` (bnb, run) · `amountSlisBnb` (amount, run) · `requestIndex` (integer, run, default 0)
- **Plays:** `stake`, `unstake-request`, `claim` (after the unbonding period), `position-check`
- **May:** Stake BNB on Lista; Request withdrawals back to BNB; Spend BNB up to the cap you set
- **Example ask:** *"stake 0.2 BNB on lista and show me the yield"*

#### 8. Aave V3 Lending — `aave-v3-lending` v1.0.0
- **Chain:** bnb · **Category:** Lending · **Suggested cap:** 50 USDT
- **sha256:** `20416c8f288207d32abc6217b5cf7ef239d4fa80e1cbbe8184e5d4c892a82f81`
- **Description:** Supply USDT to Aave V3 on BNB Chain to earn yield, and withdraw on command.
- **Scope contracts:** Aave V3 Pool `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` · aBnbUSDT `0xa9251ca9DE909CB71783723713B21E4233fbf1B1` · USDT (approved to the Pool only)
- **Inputs:** `amountUsdt` (usd, run)
- **Plays:** `supply`, `withdraw`, `position-check`
- **May:** Supply USDT to Aave V3; Withdraw your position; Spend up to the cap you set
- **May not:** **Borrow** ← explicitly out of scope on purpose; Send funds anywhere else; Touch any other app or token
- **Example ask:** *"park 30 USDT in aave and tell me the APY"*

#### 9. Token Radar — `dexscreener-token-radar` v1.0.0
- **Chain:** bnb · **Category:** **Research** · **Suggested cap:** **none, research only**
- **sha256:** `dc541956a847e00c2793da679b8a4121a5b9f46f08f07d852b88f86681c39a0b`
- **Description:** Find trending BNB Chain tokens and screen them for liquidity and risk before trading.
- **Scope contracts:** `[]` (empty)
- **Inputs:** `token` (address, run) · `condition` (text, run) · `count` (integer, run, default 10) · `intervalSeconds` (integer, run, default 30)
- **Plays:** `trending-scan`, `token-screen`, `watch`
- **May:** Read public market data; Screen tokens and report risks
- **May not:** **Submit any transaction; Touch any contract or token**
- **Example ask:** *"what's pumping on BNB right now? screen the top one"*

#### 10. Wallet Tracker — `wallet-tracker` v1.0.0
- **Chain:** bnb · **Category:** **Research** · **Suggested cap:** **none, research only**
- **sha256:** `271ce8f1bae98c3c943a2d48c454d762ac85000f9067bcaa25d11c9aed7525f9`
- **Description:** Watch any BNB Chain wallet's trades live, profile its recent activity, and find a token's early buyers.
- **Scope contracts:** `[]` (empty)
- **Inputs:** `wallet` (address, run) · `token` (address, run) · `intervalSeconds` (default 30) · `windowBlocks` (default 20000) · `count` (default 10)
- **Plays:** `watch-wallet`, `profile-wallet`, `find-early-buyers`
- **May:** Read public on-chain activity; Watch and profile wallets
- **May not:** Submit any transaction; Touch any contract or token
- **Example ask:** *"watch what 0xab... is buying and tell me when they move"*

> 💡 **A design point worth using in the pitch:** the two Research skills have an empty scope contracts list. The docs say: *"a read-only skill paired with a zero-scope session is a genuinely safe way to let an agent look around before you give it anything to spend."* That is a good onboarding flow for our marketplace: **the agent looks around first with a zero-scope session, and only then does the user raise its permissions.**

### 7.5 Composability

**Yes, skills compose.** Direct evidence from the registry:

1. **`four-meme` has a `graduation-handoff` play** that explicitly hands off to **PancakeSwap** once a token graduates from the bonding curve → two protocols, one flow.
2. **`copy-trade` has a `screenTokens` input** (default `true`) that "skip anything that fails the liquidity and honeypot check" → it consumes a **Token Radar**-style capability inside a trading flow.
3. **`venus-lending` has `pay-once` and `auto-refill` plays** — names identical to the plays in the **x402 API Payments** skill → shared play patterns across skills.

**The composition mechanism:** because a skill is just text and all writes flow through `client.execute({ session, calls })`, composing two skills = giving the agent both `SKILL.md` files **and one session whose `calls` allowlist is the union of both address tables**, with a spend cap covering both. `execute` accepts an **array of calls** in one atomic userOp, so a single play can `approve` + `swap` in one transaction:

```ts
await client.execute({
  session,
  calls: [
    { to: USDT, data: approveCalldata },
    { to: PANCAKE_ROUTER, data: swapCalldata },
  ],
});
```

**A composite scope example (verbatim from the Skills docs):**
```ts
// Scope taken straight from the PancakeSwap Trading skill's address table.
const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const USDT = "0x55d398326f99059fF775485246999027B3197955";

const session = await client.grantSession({
  wallet,
  signer: admin,
  permissions: {
    calls: [{ to: PANCAKE_ROUTER }, { to: USDT }],
    spend: [{
      limit: 50n * 10n ** 18n,   // 50 USDT. Note: 18 decimals on BNB Chain.
      period: "day",
      token: USDT,
    }],
  },
  expiry: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
});
```

> "Anything outside `calls` or over the spend cap reverts onchain, **whatever the skill says**."

Sources: <https://docs.altana.network/skills> · <https://skills.altana.network/llms-full.txt>

### 7.6 Submitting your own skill (a hackathon differentiation option)

A PR to <https://github.com/altananetwork/skills>. Three steps: **(1)** write one `SKILL.md` in `skills/<your-skill-id>/` · **(2)** Altana tests it with a real agent on a private copy of the chain · **(3)** it goes live for every agent.

The official prompt you can paste into Claude Code / Cursor (verbatim from the docs):
> "Read the Altana skill template at https://github.com/altananetwork/skills/blob/main/skills/_template/SKILL.md and the example at https://github.com/altananetwork/skills/blob/main/skills/pancakeswap-trading/SKILL.md. Write a SKILL.md for \<protocol\> following the template exactly: one capability, checksummed addresses in a table, plays with parameters and Typical time lines, and explicit guards. Then write the test scenario described in tools/skill-test/scenarios and self-test with the harness."

The self-test harness lives in `tools/skill-test/` (`skill-test.ts`, `harness/altana.ts`, `harness/fork.ts`, `scenarios/*.ts`).

Sources: <https://docs.altana.network/skills/submit> · <https://github.com/altananetwork/skills>

---

## 8. The Altana Explorer — How the Judges Will Verify Us

| Network | URL |
|---|---|
| **Mainnet** | <https://explorer.altana.network> |
| **Testnet** | <https://testnet.altana.network> |

Both link to each other in the header. **No account, API key, or wallet connection is needed.**

### 8.1 Pages & routes

| Route | Contents |
|---|---|
| `/` | Homepage: a global activity feed, totals, chain status |
| `/account/<address>` | Everything the registry knows about one wallet: **the number of active keys, total keys, chains touched**, and a key table with **type, state, chain, nonce, last update**. Below it: the wallet's event history |
| `/key/<keyId>` | One key in plain language: **active / revoked / expired**, admin or session key, the owning account, the chain, the **expiry**, and when it was registered |

The search box accepts a **wallet address, a key id, or a public key hash** — a public key hash is auto-derived into a key id, so you can paste whatever is in your code without hashing it by hand.

The homepage's `WebSite` JSON-LD declares `/account/{search_term}` as the canonical `SearchAction`.

**The Networks panel:** mainnet indexes BNB Smart Chain and Ethereum as sources, with Base as an L2 cache. **Testnet indexes BNB Smart Chain Testnet and Ethereum Sepolia, with Base Sepolia as the cache.**

### 8.2 How to use it for judge verification — in their own words

> **"Share a link as evidence.** Account and key pages are plain URLs, so `explorer.altana.network/account/<your wallet>` is a self-contained, third-party-verifiable record of what your agent was authorized to do and when. **That link is the right thing to hand a counterparty, a reviewer, or a hackathon judge who asks to see your onchain activity.** It reads from the same public registry they could read themselves, so nothing about it depends on trusting you or Altana."

**That is an explicit instruction from Altana for the hackathon judging scenario.** Source: <https://docs.altana.network/explorer>

**A verification checklist a judge can run:**
1. **Confirm the grant landed** → open our wallet's account page. The new session key must appear in the keys table **with its expiry**. If it is not there, the grant never reached the chain they are looking at.
2. **Confirm the revoke took effect** → the key page flips to **revoked**. It is monotonic, so it never comes back. "This is the fastest way to prove to yourself, or to someone else, that authority is actually gone."
3. **Tell revoked apart from expired** → both fail the same way in code but mean very different things. Expired = it ran out of time and can be granted again. Revoked = it was deliberately withdrawn. The key page says which.
4. **The live activity feed** → filter to registrations / revocations / L2 cache syncs, with the transaction fee and chain per event.

### 8.3 Explorer limitations (important for our code)

> "The explorer is an indexed view built for humans. **It is not the authority, and it is not an API.**"

For anything your code depends on, **read the Keystore contract directly**: one free `isValidKey` answers whether a key is authorized right now, from any RPC, **with no indexing lag**. If a live node read is unavailable, the key page will say so and fall back to indexed history — treat that state as informational and confirm it with a contract read.

**The implication for our product's architecture:** the "view & revoke agent permissions" UI **must** read `isValidKey` / `getKeys` directly on-chain (not scrape the Explorer), and then **link out** to the Explorer as third-party proof.

Sources: <https://docs.altana.network/explorer> · <https://explorer.altana.network/llms.txt>

---

## 9. Error Handling — Read This Before Writing Code

### 9.1 Two classes of failure

| Class | Behaviour |
|---|---|
| **Before submission** | **Throws** a JavaScript `Error` with a message string. Bad config, an unsupported signer, a chain with no relay. Catch it with `try/catch`. |
| **At or after submission** | **DOES NOT throw.** `execute` and `revokeSession` return an `ExecuteResult` with `status: "FAILED"`. **If you only `try/catch`, you will never notice.** |

The exception: **`grantSession` DOES THROW** `Session grant did not confirm: status=<status>` (with the relay code appended when observed, e.g. `status=FAILED (relay code 300)`) — because there is no useful `Session` object to return.

```ts
const result = await client.execute({ wallet, signer, calls });
if (result.status !== "CONFIRMED") {
  // Handle it here. No exception was thrown.
}
```

### 9.2 Relay status codes (EIP-5792 bands)

| `statusCode` | Band | Meaning |
|---|---|---|
| `100`–`199` | still in flight | The SDK keeps polling |
| `200`–`299` | success | Surfaces as `CONFIRMED` |
| **`300`–`499`** | **rejected before inclusion** | Terminal, `FAILED` immediately. **Nothing reached the chain.** The most common cause of `300`: **the session's spend cap cannot cover the relay fee** (the cap pays the fee too), or the relay policy rejected the bundle |
| `500`–`699` | failed on-chain | Terminal, `FAILED`. `500` = a revert; `600` = a partial failure |
| anything else | unknown | The SDK keeps polling rather than guessing. On timeout → `PENDING` with the odd code in `statusCode` |

A `PENDING` without `noWait` means 240 seconds of polling (every 2 seconds) ended with no terminal answer. `PENDING` + `statusCode: 100` = the relay is reachable and the bundle really is still in flight. `PENDING` with no `statusCode` = the relay never answered. **Treat a genuine `PENDING` as UNKNOWN, not as a failure** — the bundle may still land. Poll the `callsId` before retrying, or you risk submitting the same intent twice.

### 9.3 Failure classes and how to recognise them

| What went wrong | How to recognise it | The fix |
|---|---|---|
| **A policy revert** — the session exceeded its spend cap, called a contract outside `permissions.calls`, or passed its `expiry` | The session used to work and then stopped, or it fails only for a particular call/amount. Read the key on-chain with `isValidKey`; check the `spend` limits against the token's decimals | **Grant a new session with the right scope. Permissions are fixed at grant time and CANNOT be widened** |
| **Wrong decimals in the spend cap** | Small payments revert against a limit that looks large. **Very common on BNB Chain** (stablecoins have 18 decimals, not 6) | See the decimals warning under `grantSession` |
| **The counterfactual wallet is unfunded** | It happens on the first `execute` for a new wallet. `createWallet` never touches the chain | Send native tokens to `wallet.address` first |
| **The session does not match the grant** | **Every** `execute` fails, including ones that used to work. Usually after a lossy JSON round-trip | Persist with `serializeSession`, restore with `deserializeSession` |
| **A relay rejection** | `FAILED` within seconds, with `statusCode` 300–499 | Raise the cap (or fix the input) and resubmit; nothing reached the chain |
| **A contract paying the wallet native coin via `.transfer()`/`.send()`** | The call works from a plain EOA but reverts from the wallet; the trace shows out-of-gas or an empty revert inside the native-coin send to the wallet address | **There is no wallet-side fix.** Use the wrapped-token path, a full-gas `call{value:}` gateway, or receive into a plain EOA. The known case: **the Venus core-pool vBNB `redeem`** |

A `FAILED` **carries no revert string and no receipt**. For the on-chain reason: look up the wallet address on BscScan, inspect the last transaction to the account, and the revert reason is in the trace. You have the `callsId`, the wallet address, and the chain.

Source: <https://docs.altana.network/sdk/errors>

---

## 10. Quickstart: "Build an Agent Marketplace on BNB with Altana"

### 10.1 Hackathon context

**Build the Era / The Smart Money Era** — <https://www.bnbchain.org/en/hackathons/smart-money-era>

| Item | Value |
|---|---|
| Build period | 5 August – 9 September 2026 |
| Judging | 9 – 23 September 2026 |
| Winner announcement | 5 November 2026 |
| Total prize pool | > $40,000 |
| Breakdown | BNB Chain $30,000 USDT · TermiX $10,000 USDT · PancakeSwap 1,000 CAKE · AltLayer 8004scan Pro + AltLLM credits · **Altana 50,000 XP** |
| Main challenge | "the best AI agent marketplace on BNB Smart Chain: one venue to browse agents, see what they do and how they've performed, and put them to work." The winner is **adopted as the official BNB Agent Studio marketplace as a standalone product** |
| Reference agent categories | Monitoring · Grid trading · Health factor · Yield |

Sources: <https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace> · <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes>

### 10.2 The "Best Built with Altana" track — the official text

**The challenge:** *"create an agent marketplace on BNB Chain where the agents transact for themselves, inside limits their users set."*

**Winning criteria (4, all mandatory):**
1. **Agents on independent Altana wallets** with **real onchain transactions**
2. **Session keys with genuine constraints**: call allowlists, spend caps, and expiry dates
3. **Sessions registered in Keystore** for verifiable onchain integration
4. **User-facing controls** allowing users to **view and revoke** agent permissions

**Bonus:**
- **ERC-8183 agent hiring** through the Altana SDK
- **x402/B402 micropayments** through the x402 server SDK

**Suggested build ideas:** agent-to-agent commerce · autonomous DeFi operations with spending limits · micropayment streaming · treasury management that distributes different permissions to several agents.

**Official track resources:**
| Resource | URL |
|---|---|
| Docs | <https://docs.altana.network/> |
| The SDK and MCP | <https://github.com/altananetwork/altana-sdk> |
| ERC-8183 SDK | <https://docs.altana.network/sdk/erc8183> |
| x402 Server SDK | <https://docs.altana.network/sdk/x402-server> |
| Sessions guide | <https://docs.altana.network/concepts/sessions> |
| Testnet faucet | <https://testnet.bnbchain.org/faucet-smart> |

**Support:** a live workshop and office hours throughout the build period.

Source: <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes>

### 10.3 Quickstart steps — a full reconstruction

> ⚠️ **An honesty note:** a separate quickstart document titled exactly *"build an agent marketplace on BNB with Altana"* was **not found as a standalone page** on `docs.altana.network` (it is not in `llms.txt`, `llms-full.txt`, or the sitemap). What does exist is the **track description on the BNB Chain hackathon prizes page** (quoted in full in §10.2). The steps below are a **source-based reconstruction** from: the track criteria + the `/use-cases/1-agent-wallet-policy` guide + `/sdk/bnb-testnet` + `/sdk/erc8183` + `/sdk/x402-server`. Every step has a source.

**Step 0 — Set up the toolchain** (§11)

**Step 1 — Client & admin signer (a wallet per agent)**
```ts
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB_TESTNET] });
const admin = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = await client.createWallet({ signer: admin });
console.log(wallet.address);
```
→ Satisfies criterion #1 (the "own Altana wallet" part). Source: <https://docs.altana.network/sdk/bnb-testnet>

**Step 2 — Fund the wallet**
Send test BNB from <https://testnet.bnbchain.org/faucet-smart> to `wallet.address`. **Mandatory before the first `execute`** — the wallet is counterfactual and does not exist on-chain yet.

**Step 3 — Grant a session with REAL limits** (criteria #2 + #3)
```ts
import { signerFromPrivateKey, serializeSession } from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";

const sessionKey = generatePrivateKey();
await secrets.save(`agent-${id}.key`, sessionKey);

const session = await client.grantSession({
  wallet,
  signer: admin,
  sessionSigner: signerFromPrivateKey(sessionKey),
  permissions: {
    calls: [                                  // ← A REAL ALLOWLIST
      { to: PANCAKE_ROUTER },
      { to: USDT, signature: "approve(address,uint256)" },  // selector-scoped
    ],
    spend: [                                  // ← A REAL SPEND CAP
      { limit: 50n * 10n ** 18n, period: "day", token: USDT },
      { limit: 20_000_000_000_000_000n, period: "day" },     // native, MUST be enough for the relay fee
    ],
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,  // ← A REAL EXPIRY
  register: true,                             // ← the default; DO NOT set false, this is what puts it in the Keystore
});

await db.save(`agent-${id}.session`, serializeSession(session));
console.log("grant tx:", session.transactionHash);   // ← keep this as evidence for the judges
```

**Step 4 — The agent executes a real on-chain transaction** (criterion #1)
```ts
const result = await client.execute({
  session,
  calls: [{ to: PANCAKE_ROUTER, data: swapCalldata, value: 0n }],
});
if (result.status !== "CONFIRMED") { /* handle — no throw! */ }
console.log(result.transactionHash);          // ← keep this as evidence for the judges
```

**Step 5 — UI: the user views and revokes** (criterion #4)
Read on-chain (not from the DB!) to show the real state:
```ts
const keyIds = await pub.readContract({ address: BNB_TESTNET.keyStore, abi: KEYSTORE_ABI, functionName: "getKeys", args: [wallet.address] });
const live   = await Promise.all(keyIds.map(id =>
  pub.readContract({ address: BNB_TESTNET.keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet.address, id] })));
```
The revoke button:
```ts
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```
Also show an evidence deep-link: `https://testnet.altana.network/account/${wallet.address}`

**Step 6 (bonus) — ERC-8183 hiring** (§5): buyer `hireErc8183Agent(session, …)` + seller `submitErc8183Deliverable(session, …)`. **Requires SDK ≥ 0.9.0 for testnet.** Fund the budget from the $U faucet.

**Step 7 (bonus) — x402/B402 selling** (§6.4): `createX402Merchant` + `merchant.guard(req)` in front of our agent's API route.

---

## 11. Installation & Setup for macOS arm64

**Verified on this machine (2026-09-08):** `uname -m` → `arm64` · `node -v` → **v24.10.0** · `npm -v` → **11.6.1** · `bun --version` → **1.3.9** ✅ All prerequisites are already installed.

> ℹ️ `@altananetwork/sdk@0.9.0` **declares no `engines` field** in its package.json — there is no officially published minimum Node version. The only explicitly declared requirement is **Bun ≥ 1.1 for `@altananetwork/mcp`**.

### 11.1 Prerequisites

```bash
# Node (via Homebrew arm64, or nvm/fnm)
brew install node          # → node + npm
node -v && npm -v

# Bun — MANDATORY for the MCP server (npx FAILS: the package ships as TypeScript)
curl -fsSL https://bun.sh/install | bash
bun --version              # needs >= 1.1

# Foundry — optional, for `cast send` to the $U faucet
curl -L https://foundry.paradigm.xyz | bash && foundryup
```
Bun source: <https://bun.sh> (referenced from <https://docs.altana.network/mcp/install>)

### 11.2 Installing the SDK

```bash
mkdir -p altana-agent && cd altana-agent
npm init -y
npm pkg set type=module          # the SDK is ESM-only
npm install @altananetwork/sdk@0.9.0 viem
npm install -D typescript tsx @types/node
```
> **Pin the exact version** — the packages are pre-1.0 and a minor version can be breaking.

For the x402 seller:
```bash
npm install @altananetwork/x402-server@0.2.0 viem   # ⚠️ GPL-3.0-or-later
```

Sources: <https://docs.altana.network/sdk/bnb-testnet> · <https://docs.altana.network/sdk/x402-server>

### 11.3 The MCP server in Claude Code

```bash
# BNB testnet (for the hackathon)
claude mcp add altana -e ALTANA_CHAIN=bnb-testnet -- bunx @altananetwork/mcp

# or BNB mainnet (the default)
claude mcp add altana -- bunx @altananetwork/mcp

# remove
claude mcp remove altana
```
Restart Claude Code → the tools and slash commands become available. **One server process = one chain**; restart with a different `ALTANA_CHAIN` to switch.

Keys are stored in the **macOS Keychain** (service `altana-wallet` / `altana-session`), falling back to `~/.altana/keys.json` (mode 0600), then to env vars.

Source: <https://docs.altana.network/mcp/install>

### 11.4 The Claude Code Skill (for writing correct SDK code)

```bash
mkdir -p .claude/skills/altana-agentic-wallet
curl -fsSL https://docs.altana.network/skill.md \
  -o .claude/skills/altana-agentic-wallet/SKILL.md
```

### 11.5 Env & smoke test

`.env`:
```
PRIVATE_KEY=0x...
ALTANA_CHAIN=bnb-testnet
```

`smoke.ts`:
```ts
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";

const client = createClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = await client.createWallet({ signer });

console.log("wallet:", wallet.address);
const { native } = await client.balances({ wallet });
console.log("tBNB:", native);
```
```bash
npx tsx --env-file=.env smoke.ts
```
Then fund `wallet.address` from <https://testnet.bnbchain.org/faucet-smart> and check it at <https://testnet.altana.network/account/<address>>.

### 11.6 The desktop app (optional, for the demo)

```
https://altana.network/api/download/mac-arm64
```
A 302 redirect to the latest GitHub release asset. The macOS builds are **signed with Altana's Developer ID and notarised by Apple**. The app auto-updates (downloading in the background, installing on restart).

Source: <https://www.altana.network/llms.txt>

---

## 12. Checklist: The Altana Track's Winning Requirements → How We Meet Them

### MANDATORY requirements

#### ☐ 1. Each agent has its own Altana wallet, with real on-chain transactions

**Technical implementation:**
- One `client.createWallet({ signer: adminSignerPerAgent })` per agent listed in the marketplace. The address is deterministic and counterfactual until the first `execute`.
- Fund each wallet with tBNB from the faucet **before** its first `execute` (otherwise: the "Unfunded counterfactual wallet" failure).
- Every agent runs at least one real transaction through its session key (e.g. a PancakeSwap approve + swap, or an Aave V3 supply).

**Evidence for the judges:** `result.transactionHash` on BscScan testnet + the `testnet.altana.network/account/<wallet>` page showing the admin key + the session key.

**The trap:** do not use one shared wallet for all the agents — the criterion says "agents on **independent** Altana wallets". If you want a shared-wallet demo, use the `/use-cases/3-portfolio-multiple-agents` pattern as an **additional** feature (treasury management), not as a substitute.

**Evidence of mainnet readiness (extra credit):** repeat the flow on `BNB` (56) with small amounts. All the contracts are live and CertiK-audited on mainnet.

---

#### ☐ 2. A session with real limits: call allowlist + spend cap + expiry

**Technical implementation:**
```ts
permissions: {
  calls: [
    { to: PANCAKE_ROUTER },                                  // contract-level
    { to: USDT, signature: "approve(address,uint256)" },     // selector-level (AND semantics)
  ],
  spend: [
    { limit: 50n * 10n ** 18n, period: "day", token: USDT }, // ⚠️ 18 decimals on BNB
    { limit: 20_000_000_000_000_000n, period: "day" },       // native — MUST cover the relay fee
  ],
},
expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
```

**Three traps you MUST avoid:**
1. **DO NOT omit `calls`** — that means unrestricted, and the judges will see it. Always set `calls` AND `spend`.
2. **Decimals:** USDT/USDC have **18 decimals on BNB Chain**. `100_000_000n` is not 100 USDT, it is 0.0000000001 USDT.
3. **The native cap pays the relay fee.** A native cap that is too small = a session that will never be able to execute, `FAILED` with `statusCode` 300.

**Extra credit:** use **selector-scoped** permissions (`{ to, signature }`), not just `{ to }`. Altana's own docs give a danger example for ERC-8004 (§5.8): a contract-level grant on the registry also authorizes `setApprovalForAll`, which **outlives the session revocation**. Showing you understand this in the demo is a strong point.

**A demo that sells:** show a transaction that **reverts** because it falls outside the policy (a contract that is not allowlisted, or an amount above the cap) — "reverts at the onchain validator, not at Altana's backend, at the contract itself."

---

#### ☐ 3. The session is registered in the on-chain Keystore

**Technical implementation:**
- **`register: true` (the default) — DO NOT set it to `false`.** That is what writes the session public key into the Keystore through the Controller, batched atomically with the authorization on the smart account.
- Keep `session.transactionHash` from the `GrantSessionResult` as evidence.
- ⚠️ **Do not annotate `const session: Session = ...`** — that strips the `transactionHash` field. Let it be inferred, or annotate `GrantSessionResult`.
- Cost: a one-time Keystore registration fee; on the first admin action it is paid **twice** (the admin's `initialRegisterKey` is prepended).

**Evidence for the judges:**
- The Explorer: `https://testnet.altana.network/account/<wallet>` → the session key appears in the keys table **with its expiry**.
- Programmatically: `isValidKey(walletAddress, keccak256(sessionPublicKey))` on `0x6b8361C29d05D498b1a12B54A37310f94171E94A` (the testnet KeyStore) → `true`.

---

#### ☐ 4. Real on-chain transactions through the session key (testnet is enough, mainnet is stronger)

**Technical implementation:**
- `client.execute({ session, calls })` — **not** the admin path. The session path never touches the Keystore again (it was registered at grant time).
- Check `result.status !== "CONFIRMED"` explicitly. **A failed `execute` DOES NOT throw.**
- Persist the session with `serializeSession` plus a separately stored key, and restore it with `deserializeSession` — otherwise every execute fails with "session doesn't match the grant".

**Mainnet strategy:** run at least one complete flow (grant → execute → revoke) on **BNB mainnet (56)** with small amounts (e.g. a 1 USDT swap), then link `explorer.altana.network/account/<wallet>` in the submission. The track says "testnet is enough, mainnet is stronger" — one real mainnet tx is a cheap, large differentiator.

---

#### ☐ 5. The user can view and revoke the agent's permissions INSIDE the product

**Technical implementation — the "Agent Permissions" panel:**

*Reads (must be directly on-chain, NOT from the DB, NOT by scraping the Explorer):*
```ts
const keyIds = await pub.readContract({ address: NET.keyStore, abi: KEYSTORE_ABI,
  functionName: "getKeys", args: [walletAddress] });          // bytes32[]
const live = await Promise.all(keyIds.map(id =>
  pub.readContract({ address: NET.keyStore, abi: KEYSTORE_ABI,
    functionName: "isValidKey", args: [walletAddress, id] }))); // bool
```
⚠️ **You must use `isValidKey`, not just `getKeys`.** Revoking removes a key from `getKeys` immediately, **expiry does not** — a key that expired long ago still shows up in `getKeys`. A UI that only reads `getKeys` will display dead permissions as active.

*Show per session:* the agent name, the contract allowlist (human-readable: "PancakeSwap Router"), the spend cap + period, the expiry (as a countdown), the status (**Active / Expired / Revoked** — tell them apart!), the grant tx hash, and a link to `explorer.altana.network/account/<wallet>` as third-party evidence.

*Revoke (one button):*
```ts
await client.revokeSession({ wallet, signer: admin, session: sessionPublicKey });
```
It accepts `Session | Hex` — so the UI only needs to store the public key, not the full session object.
⚠️ A failed revoke **returns** `FAILED`; it does not throw. Check the status.
⚠️ **It is monotonic** — put a confirmation in the UI: "Once revoked, this key can never be reactivated. Granting access again requires a new session key."

**The killer demo:** show the agent running → the user clicks Revoke → refreshing the panel (read on-chain) shows **Revoked** → run the agent action again → it fails, reverting at validation. All of it verifiable by the judges in the Explorer.

---

### BONUS requirements

#### ☐ 6. Hiring a BNB Agent Studio agent through ERC-8183 (buyer + seller side)

**Buyer side:**
```ts
const { jobId } = await hireErc8183Agent(session, {   // ← the session path: the spend cap bounds the escrow!
  provider: sellerAgentAddress,
  task: "…",
  budget: 100_000_000_000_000_000n,                   // 0.1 $U (18 dec)
}, { network: BNB_TESTNET });
```
One call = `createJob` + `registerJob` + `setBudget` + `approve $U` + `fund` as **one atomic relay intent**.

**Seller side:**
```ts
const session = await client.grantSession({ wallet, signer: admin,
  permissions: { calls: erc8183SubmitPermissions(97), spend: [{ limit: gasCap, period: "day" }] },
  expiry });

const result = await submitErc8183Deliverable(session, { jobId, manifest, deliverableUrl }, { network: BNB_TESTNET });
// serve result.manifestText VERBATIM at deliverableUrl
```

**Verify & settle:** `getErc8183Job` → `getErc8183DeliverableUrl` → `verifyErc8183ManifestText(text, job.deliverable)` → `settleErc8183Job`.

**🚨 A blocker to check:** SDK **≥ 0.9.0 is MANDATORY** for testnet. On ≤0.8.0, `ERC8183_ADDRESSES[97].policy` points at an address that is not whitelisted on the testnet EvaluatorRouter → every `hireErc8183Agent()` reverts with `PolicyNotWhitelisted()`.

**Funding:** claim $U from the faucet `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3` (`requestTokens()`, 10 $U per 30 minutes per address).

**Maximum extra credit:** demo **both sides** — agent A in our marketplace hires agent B, B submits a deliverable, the buyer verifies the hash, the escrow releases. Using the session key path on **both** sides proves "an autonomous agent bounded on-chain", which is exactly this track's thesis.

**Plus:** register our agents with **ERC-8004** (`erc8004RegisterPermissions(chainId)`) so they are discoverable by buyers in the BNB agent economy. Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (testnet 97).

---

#### ☐ 7. Selling through x402/B402 with the x402 server SDK

**Implementation:**
```ts
const merchant = createX402Merchant({
  chainId: 97,                                 // or 56
  payTo: agentSmartAccountAddress,             // earnings land in the agent's Altana wallet
  price: 200_000_000_000_000_000n,
  minPrice, maxPrice,
  rails: [
    { rail: "eip3009", token: U_TOKEN[chainId] },                        // ← MANDATORY for Studio buyers
    { rail: "permit2-exact", token: USDT_BSC, spender: facilitator.address }, // ← for Altana/B402 buyers
  ],
  resource: "https://our-marketplace.example/api/agent/<id>/run",
  facilitator: privateKeyToAccount(process.env.FACILITATOR_KEY),
  rpcUrl, chain,
});
// in the route handler:
const { response, receipt } = await merchant.guard(req);
if (response) return response;
return Response.json({ data: await runAgentTask(), tx: receipt.txHash });
```

**Compatibility checklist for BNB Agent Studio buyers:**
- ☐ Include the **`eip3009` rail with $U** — Studio buyers pay **only** in $U over eip3009
- ☐ `maxTimeoutSeconds ≤ 480` (default 300) — the Studio signer refuses a window > 600s and backdates `validAfter` by 120s
- ☐ An **https** URL in production — `bag x402 trust` requires it

**The buyer side (our agent paying another API):** `approveTokenForPermit2` + `approveSignatureChecker({ checker: PERMIT2_ADDRESS })` once, then `client.fetchWithX402({ session, url })`. **Run it server-side** (CORS blocks `X-PAYMENT` in the browser).

**A strong two-way story:** our marketplace is both a **seller** (our agents sell capabilities per call, with earnings going to their own smart accounts) **and** a **buyer** (our agents pay for data feeds per call, bounded by a spend cap). That is exactly the "Both directions, so an agent can earn as well as spend" of Altana's Commerce layer.

---

### Extras nobody asked for that raise the score

| Idea | Why |
|---|---|
| **Skills Registry integration** (`search_skills` + `get_skill`, or fetching `index.json` directly) | Our agent catalogue gets populated with 10 production protocols, each with an already-validated scope and suggested cap. `get_skill` does a sha256 integrity check. Instant depth without writing our own protocol integrations. |
| **Derive the session policy automatically from a skill's address table** | The docs say explicitly that "the suggested session scope is derived from it". The UI: the user picks a skill → the allowlist + suggested cap fill in automatically → the user only adjusts the numbers. Very demo-able. |
| **Zero-scope onboarding** | The Research skills (Token Radar, Wallet Tracker) have `scope.contracts: []`. Give a new agent a zero-scope session first so the user can watch its behaviour before granting spending permissions. |
| **Submit a new skill to the registry** | A PR to `altananetwork/skills`. A real contribution to a partner's ecosystem. |
| **Show the CertiK audit badge** | The Keystore contracts were audited by CertiK on 15 July 2026, source-verified as an exact match on BscScan. A trust signal for the judges. |
| **A public "Verify this agent" page** | Reads are free and unlimited. A page anyone (with no account) can open to `isValidKey` an agent = Altana's thesis made literal. |

---

## 13. Risk & Gotcha Summary (for implementation)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **An empty `permissions.calls` = unrestricted** | Always set `calls` AND `spend`. A lint check in code review. |
| 2 | **18 versus 6 decimals on BNB** | A centralised `toBnbUnits(amount)` helper. Assert it in tests. |
| 3 | **The native cap pays the relay fee** | Leave headroom in the native cap, do not cut it fine. A `FAILED` 300 is the symptom. |
| 4 | **`execute`/`revokeSession` fail WITHOUT throwing** | An `assertConfirmed(result)` wrapper at every call site. |
| 5 | **`JSON.stringify(session)` breaks it** | Only `serializeSession`/`deserializeSession`. The key lives in a separate secret store. |
| 6 | **Omitting `sessionSigner` = an in-memory key lost forever** | Always pass your own `sessionSigner`. |
| 7 | **A `: Session` annotation strips `transactionHash`** | Infer it, or annotate `GrantSessionResult`. |
| 8 | **`getKeys` does not remove expired keys** | Always cross-check with `isValidKey`. |
| 9 | **ERC-8183 reverts on testnet with SDK ≤0.8.0** | Pin `@altananetwork/sdk@0.9.0`. |
| 10 | **Venus vBNB `redeem` reverts (EIP-7702 / the 2300 gas stipend)** | Use vUSDT (ERC-20). Avoid native payouts via `.transfer()`. |
| 11 | **`npx @altananetwork/mcp` fails** | `bunx` is mandatory, Bun ≥ 1.1. |
| 12 | **`fetchWithX402` is blocked by CORS in the browser** | Run it server-side. |
| 13 | **An `ecrecover`-based facilitator rejects our payment** | The signature is a 98-byte ERC-1271 one, not an EOA signature. The facilitator has to use `isValidSignature`. Use our own `@altananetwork/x402-server` to avoid the problem. |
| 14 | **Forgetting `approveSignatureChecker` → `0xffffffff`** | Once per session, per rail. Put it in the provisioning script. |
| 15 | **A contract-level ERC-8004 grant → `setApprovalForAll` leaks past the revoke** | Always `erc8004RegisterPermissions(chainId)`, never `{ to: registry }`. |
| 16 | **The SDK is pre-1.0; a minor can be breaking** | Pin the exact version. Read the changelog before bumping. |
| 17 | **`x402-server` is GPL-3.0** | Check the licence implications if the server code is meant to be closed-source. |
| 18 | **A browser wallet cannot be the signer** | The onboarding pattern: connect MetaMask as usual → create the account with `createPasskeyWallet` → fund it in one click through the connected provider wallet. See `/use-cases/7-onboard-from-browser-wallets`. |
| 19 | **Revoking is monotonic** | Confirm in the UI before revoking. |
| 20 | **The BNB mainnet account-stack addresses are not publicly documented** | If you need them, ask at office hours or read `packages/wallet/src/config.ts`. |

---

## 14. Source List

**Altana documentation**
1. <https://docs.altana.network> — the docs root
2. <https://docs.altana.network/llms.txt> — the machine-readable index
3. <https://docs.altana.network/llms-full.txt> — **the entire docs, 244 KB** (the main source for this research)
4. <https://docs.altana.network/changelog> — the release history 0.7.0 → 0.9.0
5. <https://docs.altana.network/acknowledgments> — the Porto basis (MIT)
6. <https://docs.altana.network/why-altana>
7. <https://docs.altana.network/concepts/keystore>
8. <https://docs.altana.network/concepts/sessions>
9. <https://docs.altana.network/concepts/networks>
10. <https://docs.altana.network/concepts/networks/testnet>
11. <https://docs.altana.network/concepts/comparison>
12. <https://docs.altana.network/concepts/off-chain-signatures>
13. <https://docs.altana.network/sdk> — the SDK reference overview
14. <https://docs.altana.network/sdk/bnb>
15. <https://docs.altana.network/sdk/bnb-testnet>
16. <https://docs.altana.network/sdk/create-wallet>
17. <https://docs.altana.network/sdk/create-passkey-wallet>
18. <https://docs.altana.network/sdk/recover-from-passkey>
19. <https://docs.altana.network/sdk/grant-session>
20. <https://docs.altana.network/sdk/execute>
21. <https://docs.altana.network/sdk/revoke-session>
22. <https://docs.altana.network/sdk/errors>
23. <https://docs.altana.network/sdk/balances>
24. <https://docs.altana.network/sdk/sync-to-l2>
25. <https://docs.altana.network/sdk/x402>
26. <https://docs.altana.network/sdk/x402-server>
27. <https://docs.altana.network/sdk/erc8183>
28. <https://docs.altana.network/sdk/erc8004>
29. <https://docs.altana.network/sdk/sign-order>
30. <https://docs.altana.network/sdk/approve-permit2>
31. <https://docs.altana.network/sdk/approve-signature-checker>
32. <https://docs.altana.network/mcp>
33. <https://docs.altana.network/mcp/install>
34. <https://docs.altana.network/mcp/tools>
35. <https://docs.altana.network/mcp/skill>
36. <https://docs.altana.network/explorer>
37. <https://docs.altana.network/skills>
38. <https://docs.altana.network/skills/submit>
39. <https://docs.altana.network/security/audits>
40. <https://docs.altana.network/use-cases/1-agent-wallet-policy>
41. <https://docs.altana.network/use-cases/1b-passkey-delegates-to-agent>
42. <https://docs.altana.network/use-cases/2-agent-trades-dex>
43. <https://docs.altana.network/use-cases/3-portfolio-multiple-agents>
44. <https://docs.altana.network/use-cases/4-verify-agent-authority>
45. <https://docs.altana.network/use-cases/5-cross-chain-authorization>
46. <https://docs.altana.network/use-cases/6-agent-pays-api-x402>
47. <https://docs.altana.network/use-cases/7-onboard-from-browser-wallets>
48. <https://docs.altana.network/use-cases/8-mobile-app>
49. <https://docs.altana.network/getting-started/build-with-claude>
50. <https://docs.altana.network/getting-started/create-agentic-wallet>

**Altana website & surfaces**
51. <https://altana.network> · <https://www.altana.network/llms.txt>
52. <https://altana.network/architecture>
53. <https://altana.network/sitemap.xml>
54. <https://explorer.altana.network/llms.txt>
55. <https://testnet.altana.network>
56. <https://skills.altana.network/llms.txt>
57. <https://skills.altana.network/llms-full.txt>
58. <https://skills.altana.network/index.json>
59. <https://xp.altana.network>

**GitHub**
60. <https://api.github.com/orgs/altananetwork/repos>
61. <https://github.com/altananetwork/altana-sdk>
62. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/erc8183.ts>
63. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/src/config.ts>
64. <https://github.com/altananetwork/altana-sdk/blob/main/packages/x402-server/README.md>
65. <https://github.com/altananetwork/altana-sdk/blob/main/packages/wallet/SKILL.md>
66. <https://github.com/altananetwork/skills> · <https://raw.githubusercontent.com/altananetwork/skills/main/index.json>

**npm**
67. <https://registry.npmjs.org/@altananetwork/sdk>
68. <https://registry.npmjs.org/@altananetwork/mcp>
69. <https://registry.npmjs.org/@altananetwork/x402-server>

**Hackathon & ecosystem**
70. <https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes> — **the "Best Built with Altana" track text**
71. <https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace>
72. <https://www.bnbchain.org/en/bnb-agent-studio>
73. <https://chainwire.org/2026/08/18/bnb-chain-launches-bnb-agent-studio-v2-giving-ai-agents-the-ability-to-earn/>
74. <https://cryptobriefing.com/bnb-agent-studio-altana-network-wallet/>
75. <https://skynet.certik.com/projects/altana> — the CertiK audit report

**On-chain contract verification**
76. <https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> — the BNB KeyStore
77. <https://etherscan.io/address/0xb70fDa90C1d576Ba8399946a0c10ECD9d9Ea923b#code> — the Ethereum KeyStore
78. <https://basescan.org/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a#code> — the Base KeyStoreCacheOPStack

---

## 15. What Was NOT Found

Recorded so nobody invents it later:

| Item | Status |
|---|---|
| A standalone quickstart document titled **"build an agent marketplace on BNB with Altana"** | **Not found** as a separate page on docs.altana.network (not in llms.txt, llms-full.txt, or the sitemap). What exists: the track description on the BNB Chain hackathon prizes page (§10.2), and the use-case guides that make it up (§10.3) |
| `https://docs.altana.network/sitemap.xml` | **HTTP 404** |
| The complete enum of `period` values for a spend permission | **Not found.** The docs only show `"day"` and `"hour"` in examples |
| The account-stack addresses (Orchestrator/Delegation proxy/Account implementation/Simulator/Funder/Escrow) for **BNB mainnet (56)** | **Not found** in the public docs. Only the testnet (97) versions are published. The `/concepts/networks` page for BNB lists only the KeyStore + KeyStoreController |
| The full canonical Permit2 address | The docs only mention the prefix `0x0000…78BA3`; the full address is accessed through the SDK's `PERMIT2_ADDRESS` export |
| The official EIP specification for **ERC-8183** on eips.ethereum.org | **Not verified in this research.** Every ERC-8183 detail in this document comes from the Altana docs + the SDK source code. ERC-8004 does have an official EIP URL that the docs reference: <https://eips.ethereum.org/EIPS/eip-8004> |
| The `engines` field (minimum Node version) in `@altananetwork/sdk` | **Not declared** in package.json |
| `github.com/altananetwork/sdk` (referenced by the x402-server npm `repository.url`) | **The repo does not exist** — a typo in package.json. The real repo: `altananetwork/altana-sdk` |
| Details of the XP program (how the 50,000 XP is computed/distributed) | **Not researched** — `xp.altana.network` is a Next.js SPA with no llms.txt |
