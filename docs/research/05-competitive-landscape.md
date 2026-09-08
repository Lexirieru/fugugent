# Research 05 — Competitive Landscape: Crypto & AI Agent Marketplaces/Registries

Date: 2026-09-08
Status: secondary research (web), to feed the Fugugent marketplace design decisions.
Note: **HelloMinds** has already been researched in depth in `docs/research/02-hellominds-benchmark.md` —
it is only mentioned in passing here as a UX comparison, not repeated.

The judging criteria used as the analysis lens:
1. **Functionality** — the journey from landing → finding an agent by category → understanding what
   it does → activation, with no dead ends, for someone with zero prior knowledge.
2. **Data Quality** — accurate real-time data that goes beyond basic counts, enough to decide which
   agent to hire.
3. **Agent Diversity** — 4 categories (LP rebalancing, grid trading, yield optimisation,
   health factor monitoring) with equal depth.

---

## 1. Virtuals Protocol (Base, agent commerce)

- **Sources**: [whitepaper.virtuals.io/acp/acp-changelogs](https://whitepaper.virtuals.io/acp/acp-changelogs), [rockawayx.com](https://www.rockawayx.com/insights/virtuals-agent-commerce-protocol-in-public-beta), [messari.io](https://messari.io/report/understanding-virtuals-protocol-a-comprehensive-overview), [datawallet.com](https://www.datawallet.com/crypto/what-is-virtuals-protocol)
- **Discovery**: the Agent Commerce Protocol (ACP) marketplace has a visual tag per service, with
  separate **Hire** and **Trade** buttons visible directly on the card. Filters cover
  graduated/sandbox status and online/offline. No evidence of granular DeFi categories
  (rebalancing/grid/health factor) — the categorisation is closer to general agent service types
  (trading, content, and so on).
- **Data on the card/detail page**: aGDP (agent GDP) ranking, job volume & success rate, weekly
  metrics (aGDP output, interactions, unique users), active status (green if connected in the last
  10 minutes), star rating + written post-job reviews, and an "Agent Examples" module (real sample
  output before you hire).
- **Activation/hire**: the **Hire** button on the agent profile immediately starts a chat with a
  hire intent; a job dashboard tracks status; failed jobs automatically retry with the next-best
  agent. Economic model: each agent has its own token (bonding curve), not just a subscription fee.
- **Trust signals**: post-job ratings, real-time online status, job history. No per-agent contract
  audit is publicly visible at the marketplace level.
- **Real weaknesses**: most of the 18,000+ tokenised agents have a small market cap and have fallen
  sharply from the January 2025 peak; protocol revenue is down significantly from its $3.9M/month
  peak; the long tail is dominated by projects with no real product or audience — the classic
  "quantity without quality" problem of an open marketplace. There are also phishing sites
  impersonating Virtuals (not a flaw in the real product, but it signals brand trust risk in this
  space).
  Sources: [ventureburn.com](https://ventureburn.com/virtuals-protocol-explained-the-ai-agent-launchpad-taking-crypto-by-storm/), [pcrisk.com](https://www.pcrisk.com/removal-guides/31469-fake-virtuals-protocol-website-scam)

## 2. Olas / Pearl (Autonolas)

- **Sources**: [olas.network/blog/introducing-pearl-v1](https://olas.network/blog/introducing-pearl-v1-the-ai-agent-app-store-powered-by-olas), [olas.network/blog/pearl](https://olas.network/blog/pearl), [ownyourmind.ai](https://ownyourmind.ai/projects/autonolas/), marketplace.olas.network
- **Discovery**: Pearl is positioned as a desktop "AI Agent App Store" (Mac/Windows) — install the
  app, then browse the built-in agents (e.g. Optimus Agent = adaptive portfolio manager, Prediction
  Agent = forecaster). A separate on-chain marketplace lives at `marketplace.olas.network` — agents
  rent skills from other agents, with open/transparent transactions ("AI Agent Bazaar"). The public
  documentation does not spell out a clear filter/category/search UI.
- **Data**: users monitor their own agent's parameters and actions in real time, like a personal
  portfolio. Public network numbers: ~3,670 agents deployed, 614 Daily Active Agents, 4.4M OLAS
  staked (as of 29 Jun 2026). No evidence of a standardised per-agent APR/PnL display on the
  marketplace card.
- **Activation**: install Pearl → set up the agent (a few-minute wizard) → stake an initial amount
  of OLAS → click "Start Agent". Funds are secured through a **Safe smart wallet** (non-custodial),
  and can be topped up with a debit/credit card via automatic bridging. Staking rewards are not
  guaranteed; they depend on the agent meeting performance targets.
- **Trust signals**: staking as skin in the game, on-chain marketplace transparency.
- **Real weaknesses**: the public documentation says very little about comparable per-agent
  performance metrics you could look at before staking (you have to trust first and see the results
  afterwards).

## 3. Almanak

- **Sources**: [almanak.co](https://almanak.co/), [docs.almanak.co/docs/wallets](https://docs.almanak.co/docs/wallets/), [docs.almanak.co/docs/set-permissions](https://docs.almanak.co/docs/set-permissions/), [github.com/almanak-co/sdk](https://github.com/almanak-co/sdk), [blocmates.com](https://www.blocmates.com/articles/almanak-your-personal-ai-quant)
- **Discovery**: a "Strategy Marketplace" — users can publish strategies and invest in other
  people's; there is also a repository of strategies from third-party protocols for their own
  ecosystems.
- **Data**: before deployment, a strategy can be **backtested and paper-traded on a mainnet fork**
  (agent-based simulation) — so a prospective "hire" can see historical simulation results first,
  not just claims. Almanak's Strategy Optimisation Suite stands out as a feature no other competitor
  has.
- **Activation/custody** (the most detailed and most relevant part for the Fugugent design): the
  user uses a **Safe Wallet** (1-of-1 multisig, the user stays sole owner) + the **Zodiac Roles
  Modifier** for granular permissions — whitelisting specific contract functions plus parameter
  limits that the "Deployment EOA" (an automated execution account separate from the Safe) is
  allowed to call. When creating a Deployment from a strategy, the user **signs one transaction** to
  apply those permissions to their wallet. It is the Deployment EOA that pays gas and signs the
  day-to-day execution transactions — not the user's main wallet. This model is very close to the
  Fugugent plan (Altana session key: call allowlist + spend cap + expiry).
- **Trust signals**: strategy code is versioned and owned by the user (not a black box), and a
  backtest is mandatory before going live.
- **Real weaknesses**: public documentation of the marketplace UI (cards, filters, ratings) is thin;
  the product feels aimed at quants/developers (you need to understand Python/strategies) rather
  than "someone with zero prior knowledge" — a large gap versus the Fugugent UX target.

## 4. Giza / ARMA — an important case: a failed project and "metric inflation"

- **Sources**: [ownyourmind.ai/projects/giza](https://ownyourmind.ai/projects/giza/), [defillama.com/protocol/giza](https://defillama.com/protocol/giza), [chainwire.org](https://chainwire.org/2025/01/29/gizas-arma-breaks-new-ground-on-base-with-advanced-defi-automation/), [stablewatch.io](https://www.stablewatch.io/research/giza-project-spotlight)
- **Discovery/data**: the ARMA dashboard shows deposits (TVL) and APY per market, a filter per
  protocol, and sorting by deposit/APY. It supports AAVE, Morpho, Compound, Moonwell.
- **Initial claims**: TVL >$16M, $1.3B in "agentic volume", 15% advertised APY, and a backtest
  claiming "2x yield enhancement" versus a static position.
- **What happened**: **on 26 Feb 2026 Giza announced that ARMA and Pulse were being wound down**,
  with a 26 Mar 2026 migration deadline and user funds returned. They were replaced by "Giza World"
  (a unified agent) claiming large assets-under-agent and volume figures **with no third-party
  verification** — and an independent on-chain measurement as of 24 Jun 2026 showed agent positions
  at close to zero, in stark contrast to the numbers shown on the homepage. **This is hard evidence
  of the "vanity metrics with no on-chain verification" risk** — a strong argument for why Data
  Quality (metrics verifiable on-chain, not self-reported) is the crucial differentiator.
- **Lesson for Fugugent**: never display AUM/volume/APY without a link to an on-chain source that
  anyone can audit (block explorer, event log, or an independent aggregator).

## 5. Fetch.ai Agentverse

- **Sources**: [docs.agentverse.ai/documentation/getting-started/agentverse-marketplace](https://docs.agentverse.ai/documentation/getting-started/agentverse-marketplace), [agentverse.ai/ai-agent-marketplace](https://agentverse.ai/ai-agent-marketplace), [progressiverobot.com](https://www.progressiverobot.com/2026/04/14/what-is-agentverse/)
- **Discovery**: categories such as Finance, Crypto, Trading, Image generation, Search, Travel,
  Weather, News, Data & analytics, Developer tools, Productivity, Translation. A search bar
  (agent/protocol address) plus 3 dropdown filters (agent type, state Active/Inactive, trust level
  Verified/Unverified). There is also a **GitHub-like advanced search syntax**: `is:active`,
  `is:verified`, `is:fetch-ai`, `has:location`, `has:readme`, `has:guide`,
  `has:interactions:1k/10k/100k/1m`, `tag:finance` and so on — a query pattern powerful enough for
  power users, but likely to be a dead end for a novice who does not know the syntax.
- **Data on the card**: status tag (Active/Offline), Verified/Unverified badge, a **rating score**
  (influenced by how often it appears in search, how often it is used, and content relevance),
  geographic location, protocol manifest icons.
- **Activation**: a working **"Chat with Agent"** button opens a conversation directly through the
  ASI:One integration — there is no publicly documented formal "hire" flow with payment or task
  scoping.
- **Real weaknesses**: the documentation mentions no uptime %, no explicit fee/pricing structure,
  and no payment flow — financial data (APR/PnL/fees) does not appear to be a focus of the card
  (Agentverse is a general-purpose agent directory rather than a dedicated DeFi marketplace).

## 6. Recall Network

- **Sources**: [messari.io/report/recall-onchain-ai-and-intelligence-competitions](https://messari.io/report/recall-onchain-ai-and-intelligence-competitions), [docs.recall.network/competitions](https://docs.recall.network/competitions) (404 when accessed — noted, we fall back to secondary sources), [koreaittimes.com](https://www.koreaittimes.com/news/articleView.html?idxno=143609), [recall.network](https://recall.network/)
- **Discovery**: not a direct hire marketplace but a **competition arena** — trading agents compete
  on a real-time leaderboard over a fixed period (e.g. AlphaWave, 7 days, $25,000 USDC prize pool).
- **Data**: the real-time leaderboard shows **PnL**, and the smart contract records every
  action/input/output/timestamp/performance metric. **AgentRank** (launched 29 Aug 2025, inspired by
  PageRank) converts competition results into a permanent, skill-specific ranking — a "queryable
  source of reputation" used by other marketplaces/apps. Every competition uses fixed, public
  metrics: PnL for trading, accuracy for reasoning, consistency over time; **reputation decays if an
  agent goes inactive**.
- **Trust signals**: because it is based on head-to-head competition with on-chain/recorded results,
  this is one of the **most credible verified-track-record models** of everything researched —
  worth copying for a "leaderboard across the 4 Fugugent categories" concept.
- **Real weaknesses**: the focus is competition/paper trading, not a smooth
  hire-to-manage-real-money flow for a novice user.

## 7. Theoriq

- **Sources**: [theoriq.ai](https://theoriq.ai/), [crypto.news](https://crypto.news/theoriq-unveils-mainnet-touts-new-era-ai-driven-defi/), [theoriq.ai/blog/theoriq-mainnet-thq-tge-launch-guide-details](https://www.theoriq.ai/blog/theoriq-mainnet-thq-tge-launch-guide-details), Medium (XT Exchange)
- **Status**: mainnet only went live on **15 Dec 2025**, so it is still very new — AlphaSwarm and
  AlphaProtocol are public, including a "Theoriq Knowledge Agent".
- **Discovery/model**: not a classic agent-card marketplace but an **agent swarm** — agents register,
  publish their capabilities, then dynamically form a swarm (role allocation, voting, adaptive
  strategy) for complex tasks (trading, yield optimization, treasury management).
- **Trust signals**: reputation is built from actions recorded on-chain/anchored off-chain plus
  independent evaluator agents scoring the results — similar to the "independent audit agent"
  concept that could differentiate Fugugent (an agent that audits other agents).
- **Real weaknesses**: because it just went live, public data on the marketplace UI (cards, filters)
  and long-term track record is still thin/immature to compare against.

## 8. OpenAI GPT Store (non-crypto UX comparison)

- **Sources**: [openai.com/index/introducing-the-gpt-store](https://openai.com/index/introducing-the-gpt-store/), [venturebeat.com](https://venturebeat.com/ai/openai-updates-gpt-store-with-ratings-and-expanded-builder-profiles), Medium ("How to Rank Your GPT"), OpenAI Developer Community
- **Discovery**: categories such as DALL·E, writing, research, programming, education, lifestyle.
  Ranking is app-store-plus-search-engine: keywords, relevance, rating, activity level — GPTs that
  are updated regularly rise, abandoned ones fall.
- **Data**: 1-5 star ratings, number of ratings, and the **total number of conversations ever
  started** shown on the builder profile — real usage metrics, not just claims.
- **Activation**: 1 click to start chatting — no wallet or funding friction, because it is not a
  financial product.
- **Real weaknesses (relevant as a warning)**: with over 3 million GPTs created, the store is full
  of spam and duplicates; there are many clones with near-identical names that "farm interactions
  and then break or inject prompts without permission"; some GPTs leak their internal prompts or are
  easily manipulated into phishing; and takedowns often happen with no clear explanation to the
  creator. **Lesson: ratings plus conversation counts alone are not enough to moderate quality — you
  need additional signals (verification, audits, or manual curation for high-risk categories).**

## 9. Poe (non-crypto UX comparison)

- **Sources**: [poe.com/blog/introducing-creator-monetization-for-poe](https://poe.com/blog/introducing-creator-monetization-for-poe), [creator.poe.com/docs/resources/creator-monetization](https://creator.poe.com/docs/resources/creator-monetization), [perplexityaimagazine.com](https://perplexityaimagazine.com/ai-tools/poe-ai-review-2026/)
- **Discovery**: broad categories (tutoring, knowledge, therapy, entertainment, assistant, analysis,
  storytelling, roleplay, media generation). "Distribution is still the hardest problem" — many bots
  with similar names, thin prompts, and low-quality output make discovery noisy.
- **Data**: the creator analytics dashboard tracks average earnings from paywalls/subscriptions/
  messages per time period, updated daily; the monetisation API supports variable pricing based on
  input/output length and compute complexity.
- **Activation**: chat immediately, paid per message or via subscription — very low friction.
- **Real weaknesses**: total creator payouts had only passed $100k by mid-2026 — showing that
  long-tail monetisation is still small even on a large platform; discovery quality remains the main
  complaint.

## 10. Other comparisons the judges/team mentioned (not re-researched here)

- **8004scan, BNB Agent Studio, Altana, PancakeSwap/TermiX**: already researched in depth in
  `docs/research/01-bnb-agent-studio.md`, `03-altana.md`, `04-8004scan-termix-pancakeswap.md`.
- **3Commas / Pionex** (grid trading bots, not an agent marketplace but relevant to the grid
  trading category): these platforms already show **win rate, Sharpe/Sortino ratio, profit factor,
  max drawdown**, plus a "copy strategy" marketplace with **verified performance history** and
  1-click deploy. Historical backtests over 120 days. This is the data-quality baseline Fugugent has
  to beat for the specific grid trading category in DeFi/BSC.
  Sources: [3commas.io/blog/ai-trading-bot-performance-analysis](https://3commas.io/blog/ai-trading-bot-performance-analysis), [help.3commas.io grid bots](https://help.3commas.io/en/articles/7932030-grid-bots-main-settings-and-options)

---

## Cross-product summary (rough table)

| Product | Clear category discovery? | Performance data verified on-chain? | Hire flow ≤3 clicks? | Clear non-custodial custody? | Competitive track record (leaderboard)? |
|---|---|---|---|---|---|
| Virtuals ACP | Partly | Partly (post-job ratings) | Yes | Not explicit | No |
| Olas Pearl | Not clearly documented | No (self-reported) | Yes (after installing the app) | Yes (Safe) | No |
| Almanak | Yes (strategy marketplace) | Yes (mandatory backtest) | No (needs a permission signature, aimed at quants) | Yes (Safe+Zodiac) | No |
| Giza/ARMA | Yes | **No (claims with no verification — then shut down)** | Yes | Partly | No |
| Fetch.ai Agentverse | Yes (tags & advanced syntax) | No (popularity rating only) | Yes (chat directly) | N/A (not a financial agent) | No |
| Recall Network | No (competition arena, not hiring) | **Yes (on-chain/recorded leaderboard)** | N/A | N/A | **Yes (AgentRank)** |
| Theoriq | No (swarm, not a catalogue) | Partly (new, evaluator agents) | N/A | Partly | No (still new) |
| GPT Store | Yes | Partly (rating + chat count) | Yes (1 click) | N/A | No |
| Poe | Yes | Partly (earnings dashboard) | Yes (1 click) | N/A | No |

**Pattern conclusion**: not a single product combines **(a)** clear per-category discovery for a
non-expert, **(b)** performance metrics verified on-chain in real time (not self-reported),
**(c)** transparent non-custodial custody with 1-click revoke, **and** **(d)** a competitive
cross-agent leaderboard within one category. Fugugent can win by doing all four at once, especially
for the 4 specific DeFi categories none of the products above serve in depth.

---

## Fugugent Differentiation Opportunities

### A. Data Quality metrics specific to each category, and where the data comes from

| # | Metric | Relevant category | How it is computed / data source |
|---|---|---|---|
| 1 | Realized APR 7d/30d/90d (net of fees) | Yield optimisation, LP | Reconstructed from deposit/withdraw history plus actual on-chain balances (vault/strategy contract event logs), not the protocol's advertised APY. Compare against `apyBase`/`apyReward` from the [DefiLlama Yields API](https://github.com/DefiLlama/yield-server) as a market baseline. |
| 2 | Max drawdown | All 4 categories | A time series of the agent's NAV/position value (snapshot per block/interval) → compute the largest peak-to-trough. |
| 3 | Sharpe / Sortino ratio | Yield optimisation, grid trading | Daily returns from the NAV time series above, divided by volatility (Sortino: downside deviation only). Industry baseline: 3Commas/Cryptohopper already display these for trading bots. |
| 4 | Fees vs profit (net-of-fee return) | All | Gross PnL (from on-chain transactions) minus total gas + protocol fees + Fugugent platform fees, shown as a breakdown rather than one combined number. |
| 5 | Gas cost per rebalance/action | LP rebalancing, grid trading | Sum of `gasUsed * gasPrice` across each agent execution tx (indexing the agent contract's event log on BSC testnet), averaged per action. |
| 6 | Average slippage per execution | Grid trading, rebalancing | The difference between the expected price (the quote at submit time) and the actual execution price from the tx receipt/DEX swap event. |
| 7 | Time-in-range (%) | LP rebalancing (concentrated liquidity) | The percentage of time the pool price sits inside the agent's LP position range, computed from a price oracle/pool tick history — a pattern already used by [Revert Finance](https://medium.com/blockchain-biz/why-you-should-use-revert-finance-prior-to-entering-any-lp-on-uniswap-a4779a1a7c49). |
| 8 | Real impermanent loss (IL) vs fees earned | LP rebalancing | Compare the actual LP position value against the hold-equivalent (standard IL formula), minus the fees already claimed — Revert Finance and DefiLlama Yields already have an `ilRisk` flag. |
| 9 | Distance to liquidation (health factor and the % price drop that triggers it) | Health factor monitoring | `HF = (collateral * liq. threshold) / debt` read straight from the lending contract (Aave/Venus on BSC) via `getUserAccountData` or its equivalent; also show "the price has to drop X% for liquidation" — a pattern from [HF Guard](https://hfguard.app/) and [Otomato](https://otomato.xyz/protocols/aave). |
| 10 | Win rate & number of trades | Grid trading | The percentage of grid orders that closed in profit out of all executed orders, from the grid agent contract's event log. |
| 11 | Agent uptime (%) | All | A periodic heartbeat/ping from the agent runtime to the Fugugent backend, recorded as a time series; show the last 30 days, not a static "99.9%" claim. |
| 12 | Agent response latency (detection → execution) | All, critical for health factor and grid | The gap between the trigger timestamp (price/HF crossing the threshold) and the timestamp of the executed on-chain tx — readable from the tx block timestamp versus the trigger event time in our own indexer. |
| 13 | Number of active users & AUM per agent, with a block explorer link | All | Queried directly from the Fugugent smart contracts (number of unique delegating wallets + total value under management), not a number hardcoded in the frontend — link to BscScan testnet as proof (avoiding the Giza case). |
| 14 | Historical backtest before going live (optional per strategy) | All, especially yield/grid | A simulation against historical on-chain price data (subgraph/our own indexer), displayed as a chart with a "past performance ≠ future" disclaimer — the Almanak pattern (mainnet fork simulation). |
| 15 | Agent contract audit/verification | All | A direct link to the source-verified contract on BscScan plus audit status (if any) as a badge on the card, not just the word "audited" with no link. |
| 16 | Cross-category reputation score (leaderboard) | All | An adaptation of Recall's AgentRank: aggregate on-chain metrics per category into a ranking that decays if the agent goes inactive — give the user the "top 3 agents in this category" right on the category page. |

### B. Concrete differentiation ideas (for the 3 judging criteria)

1. **A mandatory "Verified on-chain" badge**: every AUM/PnL/APR number on an agent card must have a
   click-through link to on-chain proof (tx hash/block explorer) — directly answering the Giza
   failure (numbers with no verification).
2. **Category pages with a leaderboard, not just a list**: each of the 4 categories gets a ranking
   based on the same metric (e.g. risk-adjusted return), Recall AgentRank style, so a novice
   immediately knows "which agent is best in this category" without reading the details.
3. **"3-click hire, 1-click revoke" as an explicit UX promise**: show an activation progress bar
   (pick an agent → set session limits → sign) so there is no dead end, and keep the revoke button
   always visible on the dashboard (as planned with the Altana session key).
4. **A "try it first" simulation before committing real money**: a paper-trade/backtest mode per
   agent (inspired by Almanak and the Recall competitions) so a user with zero prior knowledge can
   see simulated results before hiring with real funds.
5. **Head-to-head comparison between agents in the same category**: a table comparing 2-3 agents
   side by side (net APR, drawdown, fees, uptime) — not a single competitor found in this research
   offers a comparison view directly in the marketplace.
6. **A transparent fee-versus-profit breakdown**: show "you earned $X net after $Y in gas and $Z in
   platform fees" — not just a headline APR. This addresses the fuzziness that is a problem at the
   GPT Store (claims vs reality) and at Giza (advertised APY vs real results).
7. **Uptime and latency as first-class trust metrics**, especially for health factor monitoring
   (where a delay means a real liquidation risk) — show a response history chart, not an SLA promise
   with no evidence.
8. **Explicit quality curation for financially risky categories**: because the GPT Store and
   Virtuals show that an open marketplace easily fills up with "no product, no audience" projects,
   Fugugent can require a review/sandbox process before a DeFi agent goes public (similar to the
   Virtuals graduated/sandbox status, but with explicit data quality criteria).
9. **Reputation that decays when an agent is inactive** — prevents an old agent with a good track
   record but no longer running from sitting permanently at the top of the leaderboard (the AgentRank
   lesson).
10. **An independent "auditor agent"** that automatically evaluates/verifies other agents' claims and
    publishes a score — a concept from Theoriq (evaluator agents) that no other DeFi competitor has
    concretely applied to a user-facing marketplace.
11. **Equally deep categories**: make sure each of the 4 categories has exactly equivalent data
    fields (rather than one category getting full metrics and the others getting scraps) — give
    health factor monitoring non-trading metrics such as "distance to liquidation %" instead of
    forcing an APR on it like the yield category.
12. **A scrollable history of agent actions (activity feed)**, not just aggregate numbers — every
    rebalance/grid order/health check shown as a log line with a tx hash, similar to the Virtuals ACP
    job dashboard but more granular for a DeFi context.
13. **Filters for "how long it has been live" and "how much money it has ever managed"** as a proxy
    for maturity, because star ratings on their own (the GPT Store/Poe pattern) are easy to
    manipulate and empty at the start.
14. **Slippage and gas efficiency as a competitive differentiator between agents** in the grid
    trading/rebalancing categories — metrics that even 3Commas/Pionex (established grid bots) do not
    explicitly expose to users per agent.
15. **Zero-jargon language and UI up front, technical detail behind it** — show APR/health factor
    with a one-line explanation ("the closer to 1.0, the closer to liquidation") so a novice user
    does not dead-end on terminology, while still exposing the raw data for anyone who wants to
    verify it (fixing the Fetch.ai Agentverse problem where the search syntax is too technical for a
    beginner).

---

## Sources we could not fully access

- `docs.recall.network/competitions` returned a 404 in WebFetch — the Recall information above was
  assembled from Google cache/Messari/secondary articles, not directly from the official docs. It
  needs to be re-verified manually at `docs.recall.network` before being quoted as settled fact.
- Details of the Pearl marketplace (`marketplace.olas.network`) and Almanak card/filter UI could not
  be found as screenshots or detailed public documentation — the descriptions above are
  reconstructed from blog posts and text docs, not direct UI observation.
