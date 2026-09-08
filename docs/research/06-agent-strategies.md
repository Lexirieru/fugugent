# Strategy Specification Research — 4 Autonomous DeFi Agents (BNB Smart Chain)

> Context: **Fugugent** — a subscription marketplace for autonomous DeFi agents on BNB Smart Chain. Execution on **testnet (chain 97)**, data/prices read from **mainnet (chain 56)**.
> Research date: **8 September 2026**.
> Goal: the hackathon judges want quantitative proof (win rate, time window, risk) that the agent beats doing it manually. This document is a specification you can implement directly, not just theory.

**Legend:**
- ✅ = verified live today (an RPC call via `cast` to `https://bsc-dataseed.bnbchain.org`, or an HTTP call to a public API)
- 📄 = from official documentation / a paper, not executed live by me
- ⚠️ **NEEDS VERIFICATION** = I did not confirm this directly — do not hardcode it into a contract without re-checking before deploy

The RPC used for every `cast call` in this document: `https://bsc-dataseed.bnbchain.org` (chain 56). The `binance.org` RPC is **not used** (blocked from this execution network, per instructions).

---

## 0. The "agent > manual" proof framework (applies to all 4 agents)

The judges will ask for three specific numbers per agent — design these metrics up front so they stay consistent:

1. **Win rate**: the percentage of backtest episodes (e.g. rolling 30 days, shifted by 1 day, N ≥ 90 windows) where the agent's net return beats the manual baseline's net return (baseline = "set & forget" with no action, with realistic assumptions: a human checks and rebalances manually at most once a week, with a 12–24 hour reaction delay).
2. **Time window**: the minimum backtest range that is statistically honest. For a volatile crypto strategy, that is a minimum of **90 days** of 1-hour price data, ideally **180–365 days** covering uptrend, downtrend, and sideways regimes — so the claim is not "curve-fit" to one market regime (see §1 on Uniswap v3 research: a rebalancing strategy that wins in a sideways market can lose badly in a trending one).
3. **Risk**: at minimum report **max drawdown**, **volatility of returns**, **worst single episode**, and **downside deviation** — not just average APR. An agent that "wins" on APR but has 3x the drawdown of doing it manually is not a better agent.

Mandatory backtest methodology: **walk-forward, not a single in-sample run**. Simulate real gas fees, slippage, and swap fees (do not assume free execution) — all four agents pay real on-chain costs on BSC (~$0.05–$0.30/tx at a gas price of 1–3 gwei on BSC, ⚠️ **NEEDS VERIFICATION** of the real-time gas price figure at implementation time, because BSC gas prices fluctuate).

Free historical data sources for BSC (used by all 4 agents, per-agent detail below):
- **DefiLlama** — historical TVL & yield, free, no API key. ✅ Verified live (see §3).
- **Binance public API `/api/v3/klines`** — OHLCV for BNB and major token prices, free, granularity down to 1 minute, history since 2017. 📄 Good for simulating price-driven strategies (grid, health factor) because BNB/BUSD on a CEX correlates very closely with on-chain BSC prices.
- **BSC on-chain event logs** (`eth_getLogs` via a public RPC or an explorer) — `Swap`, `Mint`, `Burn`, `Collect` from PancakeSwap v3 pool contracts, to reconstruct the real on-chain price path and volume. 📄 Needs an indexer (e.g. self-hosted, or the free BscScan API with rate limits) because public RPCs usually cap the block range for `eth_getLogs`.
- **CryptoDataDownload.com** — free daily/hourly/minute OHLCV CSVs for Binance spot. 📄

---

## 1. LP Rebalancing Agent (PancakeSwap v3)

### 1.1 Relevant contracts (BSC mainnet, chain 56)

| Contract | Address | Status |
|---|---|---|
| PancakeSwap V3 Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | ✅ Contract code exists, checked via `cast code` |
| PancakeSwap V3 NonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | ✅ Cross-verified: `cast call ... "factory()(address)"` returns the Factory address above — matches |

Official address documentation: https://developer.pancakeswap.finance/contracts/v3/addresses

### 1.2 How to choose the range width

The academic research (arXiv 2309.08431 "Predictable Loss and Optimal Liquidity Provision", arXiv 2410.09983 "Backtesting Framework for CLMM on Uniswap V3", arXiv 2309.10129 "Adaptive LP with Deep RL") agrees on several principles that can be turned into rules directly:

- **A narrower range → higher fee APR per unit of capital, but the frequency of going out of range (and therefore the need to rebalance) rises sharply.** This trade-off has to be computed explicitly, not chosen by intuition.
- The optimal range width is a function of the pair's **realized volatility** and the **ratio of pool fees to the gas cost of rebalancing** — not a fixed number. A volatile pool (e.g. altcoin-BNB) needs a wider range than a stable pool (e.g. USDT-USDC).
- The RL study (arXiv 2309.10129) shows an adaptive strategy (width and rebalance timing adjusted to conditions) beating a static baseline by **9%–69%** depending on the pool — that range is so wide that it **must not be promised to the judges as a firm number**; report it as a third-party research reference and re-verify it with our own backtest on the relevant BSC pools.
- Real automated vaults (not academic research) use the approaches below — summarised from their respective docs (📄, I have not read the full source code):
  - **Gamma Strategies** (docs.gamma.xyz/gamma/features/strategies): rebalancing is fired by an **automatic trigger** when the price moves outside a given band around the active band, after which the vault recomputes the base+limit position. Gamma runs several different "strategy types" (narrow/wide/stable) per pool according to that pool's volatility — not one width for every pool.
  - **Arrakis**: focuses on **low-volatility/stable** pairs because IL is smaller and rebalancing is needed less often — their strategies explicitly avoid highly volatile pools for passive vaults.
  - **Steer Protocol**: unlike Gamma/Arrakis (managed), Steer offers **logic-based custom vaults** configured per pool — which shows there is no single universal range formula in the industry; per-pool parametrisation is the industry norm.
  - **Ichi**: known for **single-sided liquidity** (deposit 1 token, auto-rebalance into a one-sided position) — relevant if the Fugugent agent wants to offer LP without the user having to hold 2 tokens.
  - **Bunni**: implements "Liquidity Density Functions" (more advanced, generalising a range into a distribution curve) — this is for v4/hooks, ⚠️ **NEEDS VERIFICATION** of compatibility with PancakeSwap v3 (not v4) on BSC before adopting the idea.

**Implementation recommendation for the hackathon MVP:** use a band width based on **N-day realized volatility** (e.g. the 14-day σ of the pair price, band = ±k·σ with k calibrated per pool through backtesting), not a fixed percentage such as "±5%" — this is consistent with the literature above and easy to explain to the judges with concrete numbers.

### 1.3 Rebalance triggers

Three kinds of trigger, used together (do not pick just one):

1. **Out of range (price exit)** — the most important trigger: as soon as the price tick leaves the position's `[tickLower, tickUpper]`, the position stops collecting fees entirely (100% of the capital becomes one asset). Detect it by comparing the pool's `slot0().tick` against the position's `tickLower/tickUpper` (read from `positions(tokenId)` on the NonfungiblePositionManager).
2. **Deviation from the range centre** — a preventive rebalance before the price actually exits, e.g. once the price has moved past 70–80% of the range width to one side (reducing the risk of "going out of range while gas is expensive / the market is moving fast").
3. **Time-based / cooldown** — a minimum gap between rebalances (e.g. at least 4–6 hours) to prevent "rebalance churn" when the price oscillates at the edge of the range — this is crucial, because research shows **automatic rebalancing is vulnerable to "volatility drag" and is only profitable when fee levels are high**; excessive churn destroys profitability through repeated gas and slippage.

### 1.4 Rebalance profitability formula (net-of-cost)

A rebalance is only executed if:

```
FeeEarnedProjected(new_range) − FeeEarnedProjected(old_range, if kept)
    − GasCost(withdraw + rebalance swap + deposit)
    − SlippageCost(swap to rebalance the token ratio)
    − ExpectedIL_delta(new_range vs old_range)
  > 0
```

Components:
- **IL for a concentrated position** (not full-range): the boundary where IL → 0 is `Pa/P = P/Pb = (1−ρ)²`, with ρ = the fraction of the range width relative to the current price (formula from the research summarised by Peteris Erins/Auditless, Medium). The basic 50/50 pool IL formula: `IL = 2√d/(1+d) − 1`, where `d` = the price change ratio (`P_new/P_old`); for a concentrated position this IL is **amplified** by the concentration factor (the narrower the range, the larger the IL per unit of price movement inside the range).
- **GasCost**: 3 on-chain transactions (decreaseLiquidity/collect, an optional swap to re-ratio, mint the new position) — take the live gas price from the RPC (`eth_gasPrice`) times the gas limit of each operation (⚠️ **NEEDS VERIFICATION** of the actual gas limits from simulation/estimation on testnet 97 before mainnet).
- **SlippageCost**: from `quoteExactInputSingle` (the PancakeSwap v3 Quoter contract) before executing — do not assume zero.

Non-academic research (Medium/DeFi Scientist "Rebalancing vs Passive strategies") concludes that **auto-rebalancing often underperforms passive holding outside periods of high volume/fees** — meaning the rule "only rebalance when the profitability threshold is positive" is not optional, it is required to be able to claim "better than manual" honestly.

### 1.5 Metrics tracked and reported

| Metric | Definition |
|---|---|
| Time-in-range % | The % of time (block-weighted) the active position sits inside the range and collects fees |
| Fee APR | Fees collected (in USD) / average capital, annualised |
| IL (realized) | The difference between the LP portfolio value and a passive 50/50 hold over the same period |
| Net APR | Fee APR − realized IL − (total rebalance gas+slippage / capital, annualised) |
| Number of rebalances | The count of rebalance actions per period (used to prove it is not overtrading) |
| Cost per rebalance | Average gas + slippage per action (USD) |

### 1.6 Data for the marketplace card and detail page

**Card (summary):** 30-day Fee APR, 30-day Net APR (after gas and IL), Time-in-range %, supported pair/pool, current range width, number of rebalances in 30 days, win rate vs manual (from the backtest), risk badge (Low/Med/High based on pool volatility).

**Detail page:** a chart of Net APR vs Fee APR vs IL (keep each component separate — this transparency matters so users are not misled by a gross APR), the history of every rebalance (timestamp, old→new tick range, cost, trigger reason), the win rate distribution per market regime (uptrend/downtrend/sideways — not a single number, because the literature shows performance is heavily regime-dependent), the contracts used (Factory/NFPM above) with BscScan links, and an explicit disclosure of IL risk plus smart contract risk.

### 1.7 How to backtest honestly

1. Take the pool's tick/price history from the on-chain `Swap` event log of the `PancakeV3Pool` contract (reconstructing `sqrtPriceX96` per event) — or use Binance klines for the same pair (BNB/USDT etc.) as a proxy, since that dataset is easier to obtain.
2. Simulate the position with the standard Uniswap v3 fee accrual formulas (`feeGrowthGlobal`, liquidity share) using real volume from the swap history.
3. Run it **walk-forward**: a sliding window (e.g. starting every day, 30 days long), at least 90 distinct windows, covering ≥1 strong-trend period and ≥1 sideways period.
4. Compare against 2 baselines: (a) a passive 50/50 hold with no LP, (b) a full-range LP with no rebalancing — not just one baseline, so the "better than" claim is not cherry-picked.
5. Report the win rate, drawdown, and confidence interval (not just the average) across those windows.

Source for the backtest framework: the paper "Backtesting Framework for Concentrated Liquidity Market Makers on Uniswap V3" (arXiv:2410.09983) — its methodology generalises to PancakeSwap v3 because the CLMM mechanism is identical (a Uniswap v3 fork).

---

## 2. Grid Trading Agent

### 2.1 Grid parameters

Based on the Binance Grid Trading documentation, Pionex ("Grid Bot Parameters Explained"), and 3Commas ("Grid bots: Main settings and options") — 📄, all three platforms agree on the core parameters:

- **Upper price and lower price bounds**: the bot places no orders outside this range.
- **Grid count**: the number of buy+sell levels; an even grid count is split evenly between buys and sells around the current price.
- **Arithmetic spacing**: `interval = (upper − lower) / grid_count` — a fixed price difference between levels. Suited to narrow ranges / low-priced assets.
- **Geometric spacing**: a fixed percentage ratio between levels (not an absolute difference) — suited to wide ranges/high volatility, because it keeps the percentage profit per grid consistent across all price levels.
- **Order size per grid**: usually `total_capital / grid_count`, with the option to allocate more to grids near the current price (some advanced bots do this, but the default is even).

### 2.2 When to reset / stop

- **Stop-loss / upper & lower breakout**: as soon as the price breaks the grid's upper/lower bound consistently (not a momentary wick — use an N-candle or time-based confirmation so it does not overreact to noise), the bot stops and (optionally) liquidates into a stablecoin — the standard pattern on Pionex/3Commas ("trigger price", "stop loss").
- **Grid reset**: once a breakout is confirmed as trending (not a fast reversal), the old grid is frozen and a new grid is recomputed around the new price and volatility — do not automatically re-deploy on the old range, because that only magnifies the loss in a trending market.

### 2.3 Breakout and trending market risk

Grid trading is structurally a **mean-reversion strategy** — it profits from price oscillating inside a range, and **loses significantly in a strong one-directional trending market**, because the grid keeps buying as the price falls (accumulating an asset that keeps depreciating) or runs out of inventory as the price keeps rising (losing the upside). This has to be disclosed explicitly to marketplace users — not buried in a generic disclaimer.

### 2.4 Metrics

| Metric | Definition |
|---|---|
| Grid profit | Total profit from buy-low/sell-high fills, kept separate from the change in unrealized inventory value |
| Number of fills | The count of executed buy and sell orders |
| Drawdown | The maximum drop in portfolio value from the peak, including unrealized losses while trending |
| Profit per grid | The average profit per closed buy-sell pair |
| Win rate | The % of grid pairs (buy→sell) that closed in profit out of all closed pairs |

### 2.5 On-chain execution on BSC — the critical point

**PancakeSwap has NO native on-chain order book for limit orders in the CEX (grid bot) sense.** What exists is:

- **PancakeSwap Limit Order/TWAP** (docs.pancakeswap.finance/trade/limit-orders): 📄 this feature is **on-chain but is not order-book matching inside the AMM pool** — orders are filled by **off-chain takers/keepers** that compete to execute once the market price reaches the limit price, and the taker takes a fee out of the output token as an incentive. That means PancakeSwap limit orders **depend on third-party keepers**, not a native matching engine — closer to the CoW/1inch limit order mechanism than to a Binance-style grid trading order book.
- **Conclusion for the Fugugent grid agent design**: the grid agent **has to implement the keeper function itself**: (1) watch the on-chain price (read the PancakeSwap v3 pool's `slot0()` or an oracle price), (2) when the price touches a grid level, the agent (a server-side bot / keeper contract) executes a **direct swap** through the PancakeSwap Router/SmartRouter, rather than placing a passive limit order and waiting for another taker to fill it. The alternative is to use the existing PancakeSwap Limit Order infrastructure (if its contracts are public and callable programmatically) — ⚠️ **NEEDS VERIFICATION** of whether the PancakeSwap limit-order contract is verified and its address public for BSC before depending on it; I have not confirmed the specific address of the PancakeSwap limit-order engine on BSC live.
- Cost implication: every grid "fill" = 1 on-chain swap transaction (gas + the pool's swap fee, e.g. 0.01–0.25% depending on the PancakeSwap v3 fee tier) — this is **significantly different from a CEX grid bot (much cheaper maker/taker fees, no gas per order)**. The grid count design has to account for the fact that a tight grid = many transactions = cumulative gas costs that can eat up the thin per-grid profit, especially on low-volatility assets.

### 2.6 Data for the marketplace card and detail page

**Card:** the current grid price range (upper/lower), grid count and spacing type (arithmetic/geometric), 30-day grid profit (annualised %), win rate, status (active/breakout-stopped), a "suited to sideways markets" badge (not trending).

**Detail page:** the history of every fill (timestamp, price, buy/sell side, size, gas cost), an equity curve chart against the underlying price (so users can see when the strategy wins and loses), a breakdown of on-chain costs (number of txs, total gas paid, gas as a % of profit), and separate simulations of trending versus sideways scenarios (so users understand this strategy is not "always profitable").

### 2.7 How to backtest honestly

1. Take granular OHLCV (1-minute to 1-hour candles) from Binance `/api/v3/klines` for the matching pair (e.g. BNBUSDT) as a proxy for the BSC price.
2. Simulate grid levels and fills based on candle highs/lows touching a level (not just the close price, which underestimates the real number of fills).
3. Include the **real on-chain cost per fill** (BSC gas + the PancakeSwap swap fee tier) — not a CEX 0.1% fee — so the numbers do not mislead when compared against a CEX grid bot.
4. Test at least 3 regimes: a historical sideways period (e.g. a BNB consolidation period), an uptrend, and a downtrend — report win rate and drawdown **per regime**, not aggregated, because grid performance is heavily regime-dependent (see §2.3).
5. Comparison baseline: passive buy-and-hold over the same period.

---

## 3. Yield Optimisation Agent

### 3.1 APR sources on BSC — verified live via the DefiLlama Yields API

**Endpoints (free, no API key):**
```
GET https://yields.llama.fi/pools
GET https://yields.llama.fi/chart/{pool_id}
```
✅ Verified live today — `GET /pools` returns 17,191 pools globally, with the fields `chain`, `project`, `symbol`, `tvlUsd`, `apyBase`, `apyReward`, `apy`, `underlyingTokens`, `pool` (a UUID, used for the `/chart/{pool}` endpoint — also verified to return daily APY/TVL history going back to 2022).

**Filtering for BSC** — the `chain` field has the exact value `"BSC"` (✅ verified; opBNB is separate as `"Opbnb"`, do not conflate them). Relevant project slugs **confirmed live to have data on the BSC chain**:

| Protocol | DefiLlama `project` slug | BSC pool count (live) |
|---|---|---|
| Venus Core Pool | `venus-core-pool` | 41 |
| Venus Flux (isolated pools) | `venus-flux` | ⚠️ present in the slug list but the BSC pool count has not been checked |
| Aave v3 (BNB Chain) | `aave-v3` | 8 |
| Lista Lending | `lista-lending` | 18 |
| Lista CDP / Liquid Staking | `lista-cdp`, `lista-liquid-staking` | ⚠️ count not checked |
| PancakeSwap AMM (v2 & stable) | `pancakeswap-amm` | 41 |
| PancakeSwap AMM v3 | `pancakeswap-amm-v3` | **0 on BSC** — DefiLlama only has this v3 data for `Ethereum` and `Opbnb`, **not BSC**. ⚠️ That means for PancakeSwap v3 fee APR on BSC, the DefiLlama Yields API **cannot be used directly** — we have to compute it ourselves from on-chain events (see §1.7) or a subgraph. |

Example live data (from `GET /pools`, filtered by `chain=="BSC"`):
- Venus WBNB supply: `apyBase 0.076%` — pool `747b58ab-aefd-42e1-a312-01ad5a0ab7f5`
- Aave v3 WBNB supply: `apyBase 0.011%` — pool `9380e5ac-3b75-468c-951c-c24ff6497e80`
- Lista Lending BNB: `apyBase 0.137%` — pool `e15db93c-9c49-490c-896d-24092b4d7471`

(The numbers above are a snapshot from 8 Sep 2026 and will change in real time — do not hardcode the values, only the structure/endpoints are stable.)

### 3.2 On-chain contract functions for reading supply/borrow rates directly (no third-party API)

**Venus Protocol** — a Compound v2 fork pattern, per-block rates:
- The market token contract (vToken, e.g. vBNB): `supplyRatePerBlock()` and `borrowRatePerBlock()` — both ✅ **verified live** via `cast call` to vBNB `0xA07c5b74C9B40447a954e1466938b865b6BBea36`:
  - `supplyRatePerBlock() → 10940907` (scaled 1e18, per block)
  - `borrowRatePerBlock() → 83484456` (scaled 1e18, per block)
  - Converting to APY: `APY = (1 + ratePerBlock/1e18)^(blocksPerYear) − 1`. BSC block time is ~0.75–1 second after the upgrade (⚠️ **NEEDS VERIFICATION** of the current blocksPerYear figure, because BSC has changed its target block time before — do not use the old 3-seconds-per-block assumption).
- Comptroller (the risk engine, core address): `0xfD36E2c2a6789Db23113685031d7F16329158384` — ✅ verified live, `getAccountLiquidity(address)` responds `(0,0,0)` for an empty address (as expected: no error, no liquidity, no shortfall).

**Aave v3 BNB Chain:**
- Pool Proxy: `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` — ✅ verified live, `getUserAccountData(address)` responds with the correct structure (6 return values, healthFactor = max-uint for an address with no debt — behaviour matching the Aave v3 spec).
- For supply/borrow rates: use `getReserveData(asset)` on the same Pool contract (it returns `currentLiquidityRate` and `currentVariableBorrowRate`, in ray units of 1e27) — ⚠️ **NEEDS VERIFICATION**, I have not called `getReserveData` live (I only tested `getUserAccountData`).
- **PoolAddressesProvider**: the address `0xA97684ead0e402dC232d5A977953DF7ECBaB3CDb` that I found through a web search (used on Polygon/Ethereum/Optimism) **has NO contract code on BSC mainnet** — ❌ confirmed via `cast code` (empty return, "does not have any code"). **Do not use this address for BSC.** Use the Pool Proxy `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` directly, which is verified to work, or find the correct BSC PoolAddressesProvider via the official `aave-address-book` package before production. ⚠️ **NEEDS VERIFICATION**.

### 3.3 Risk-adjusted APR and the pool-migration threshold

The basic risk-adjusted APR formula (this is not DeFi-specific academic research; it is an adaptation of general risk-adjusted return principles plus on-chain risk factors):

```
RiskAdjustedAPR = RawAPR × RiskMultiplier

RiskMultiplier = f(TVL_score, Age_score, Audit_score, DepegRisk_score)
```

A suggested scoring scheme (0–1, either multiplied together or weighted-averaged — pick one consistently and document the reasoning to the user):
- **TVL_score**: a penalty for TVL below a given threshold (e.g. <$1M is treated as a high manipulation/exit risk; >$50M is treated as liquid). These absolute thresholds are a **product design decision**, not an industry standard — state them as explicit assumptions.
- **Age_score**: the age of the protocol/pool since deployment — the younger it is, the riskier (rugs/bugs have not been tested by time).
- **Audit_score**: binary or tiered — large established protocols (Venus, Aave) are verifiably publicly audited and have been battle-tested for a long time; this is a fact you can check on each protocol's official audit page, not from the DefiLlama API.
- **DepegRisk_score**: specific to pools whose underlying is a stablecoin/LST (e.g. USD1, slisBNB) — check the history of deviation from the peg.

**Pool migration threshold**, only migrate if:

```
(APR_new_pool − APR_old_pool) × projected_holding_duration × capital
  > GasCost(withdraw + swap if needed + deposit) + SlippageCost + ExtraRiskBuffer
```

`ExtraRiskBuffer` matters: a pool with a higher APR is often riskier (small TVL, new protocol) — the migration threshold has to be raised (not merely net-of-gas positive) in proportion to the risk score difference, so the agent does not endlessly "chase yield" into risky pools for a marginal APR.

### 3.4 Metrics and data for the card/detail page

**Card:** current APR (raw and risk-adjusted), the pool/protocol currently held, number of migrations in 30 days, a risk badge per pool (Low/Med/High from the scheme in §3.3), protocol TVL.

**Detail page:** the history of every migration (from→to, APR delta, reason, cost), a chart of the pool's historical APR via DefiLlama's `/chart/{pool}`, a breakdown of the risk score by component (TVL/age/audit/depeg), and disclosure of the data source (DefiLlama, with the note "APY from DefiLlama is updated roughly hourly" — per their documentation).

### 3.5 How to backtest honestly

1. Pull the daily APY history per pool via DefiLlama's `GET /chart/{pool}` for every candidate pool (Venus/Aave/Lista/PancakeSwap farms) since that pool was listed.
2. Simulate a yield-switcher agent: each day, compute whether the migration threshold (§3.3) is met based on the historical APR *on that day* (not a future APR — avoid lookahead bias, a common mistake in DeFi backtests).
3. Subtract from every migration a realistic BSC gas estimate plus swap slippage (if the asset changes).
4. Comparison baselines: (a) passively staking in the single highest-APR pool at the start of the period and never moving, (b) the average APR across all candidate pools with no optimisation.
5. Report the win rate per rolling 30-day period, at least 90 windows, plus risk incidents (e.g. how many times the passive baseline ended up in a pool whose APR collapsed because TVL drained — this is part of the "why the agent is better" story).

---

## 4. Health Factor Monitoring Agent

### 4.1 The health factor formula

**Venus (a Compound v2 fork model)** — it has no single "health factor" like Aave, but the conceptual equivalent is available through `getAccountLiquidity`:
- `getAccountLiquidity(address account) → (uint256 error, uint256 liquidity, uint256 shortfall)` on the **Comptroller** contract — ✅ **verified live** at `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  - `liquidity > 0` and `shortfall == 0` → the position is safe; `liquidity` is the remaining borrowing power in USD (scaled).
  - `shortfall > 0` → the position is already undercollateralized, and anyone can execute a liquidation.
  - An equivalent "health factor" can be computed manually: `HF_equiv = (Σ collateral_i × collateralFactor_i) / Σ borrow_i` — take `collateralFactorMantissa` per market from `markets(vTokenAddress)` on the Comptroller.

**Aave v3** — an explicit health factor from the contract:
- `getUserAccountData(address user) → (totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor)` on the **Pool** contract — ✅ **verified live** at `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`.
  - `healthFactor = (totalCollateralBase × currentLiquidationThreshold) / totalDebtBase` (in 1e18 basis; a value of `type(uint256).max` means there is no debt, confirmed live).
  - **HF < 1.0 → the position can be liquidated.**

### 4.2 Action thresholds

A three-tier scheme (standard HF monitoring practice, not a protocol-defined number — this is a product decision that has to be explained to the user):

| HF threshold (Aave-style) | Action |
|---|---|
| HF ≤ 1.5 (or the Venus equivalent, liquidity starting to thin out) | **Warning** — notify, no automatic action yet |
| HF ≤ 1.2 | Automatic **partial repay** or **collateral top-up** (drawn from the treasury/wallet the user authorised) |
| HF ≤ 1.05–1.1 | **Aggressive deleverage** — a large repay/withdraw part of the collateral into a stable asset, prioritising avoiding liquidation even at the cost of slippage |
| HF ≤ 1.0 | Already too late — other liquidators have probably acted already; the agent still attempts an emergency repay as a last resort |

The specific thresholds (1.5/1.2/1.1) are **examples, not research results** — recalibrate them through a backtest of the volatility of the supported assets (§4.5), because a volatile asset needs a wider buffer than a stablecoin.

### 4.3 Estimating the distance to liquidation as a % price move

For Aave v3, with 1 collateral and 1 debt asset:
```
% drop in the collateral price until HF=1 ≈ 1 − (totalDebtBase / (totalCollateralBase × currentLiquidationThreshold))
```
This follows directly from the HF definition above — at the current HF, `%drop_to_liq = 1 − 1/HF_current` (for the simple case of one collateral asset with a constant debt price). For multi-collateral/multi-debt positions you need a per-asset breakdown weighted by each asset's USD value (⚠️ **NEEDS VERIFICATION**: this simplified formula is not automatically correct for a complex portfolio — with more than one debt/collateral asset moving independently you need to re-simulate per price scenario, not use a single closed-form formula).

For Venus, the same approach applies using `liquidity`/`shortfall` and the per-market `collateralFactorMantissa`.

### 4.4 Price sources

- **The Chainlink BNB/USD Price Feed on BSC mainnet**: `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` — ✅ **verified live**: `decimals() = 8`, `description() = "BNB / USD"`, and `latestRoundData()` returns valid round data with a price on the order of `7.51e10` (i.e. ~$751.045 after dividing by `1e8` — this value is today's snapshot and will change). Official sources: https://docs.chain.link/data-feeds/price-feeds/addresses and https://data.chain.link/feeds/bsc/mainnet/bnb-usd.
- For the health factor agent, **the best collateral/debt prices are read directly from the oracle the protocol itself uses** (Venus and Aave each have an internal oracle module — Venus uses a custom `PriceOracle`, Aave uses `AaveOracle`, which usually wraps a Chainlink feed) — rather than reading a general Chainlink feed separately, so the HF/liquidity calculation stays consistent with what the real liquidation contract uses. ⚠️ **NEEDS VERIFICATION** of the specific oracle module addresses for Venus and Aave on BSC (I have not checked them live) before using them for critical calculations.
- The "Binance Oracle" mentioned in the brief: ⚠️ **NEEDS VERIFICATION** — in this research I did not find or verify an official oracle entity by that name being widely used by Venus/Aave on BSC; do not assume it is the primary price source without further confirmation.

### 4.5 Metrics

| Metric | Definition |
|---|---|
| Liquidation avoided | The number of episodes where HF fell below the warning threshold but the agent acted before HF ≤ 1.0 |
| Response time | The time delta (blocks/seconds) between HF crossing the threshold and the agent's mitigation transaction being confirmed on-chain |
| Intervention cost | Gas + slippage (if collateral is swapped) + the opportunity cost of the repay/deleverage, per intervention |

### 4.6 Data for the marketplace card and detail page

**Card:** the current HF (live), the % distance to liquidation, the historical "liquidation avoided" count, the average response time, the protocol being monitored (Venus/Aave), and the collateral & debt assets.

**Detail page:** a chart of historical HF with the action threshold lines, a log of every intervention (timestamp, HF before/after, action taken, cost, BscScan tx hash), a stress-test simulation ("if BNB drops 20% tomorrow, your HF becomes X" — computed with the formula from §4.3 using the live price from the Chainlink feed above), and a disclosure that the agent **does not guarantee 100% prevention of liquidation** (block time, network congestion, and extreme price gaps remain residual risks).

### 4.7 How to backtest honestly

1. Take the price history of BNB and other assets from Binance klines (fine-grained candles, e.g. 1 minute, to capture the flash crashes that matter for liquidation risk).
2. Simulate hypothetical borrow positions (several starting LTV scenarios) and recompute HF at every historical candle using the formulas in §4.1/§4.3.
3. Simulate the agent acting as soon as HF crosses a threshold (with a realistic delay: detection time + BSC block confirmation time, ⚠️ **NEEDS VERIFICATION** of the current BSC block time for an accurate delay estimate), versus a manual baseline (a human reaction delay of 1–24 hours, per the framework in §0).
4. Count how many times the manual baseline would have been liquidated (HF crossing 1.0 before the human could act) versus the agent — this is the **"liquidation avoided"** number, and it is the strongest one for the judges because it directly shows the real loss that was prevented (liquidation usually carries a 5–10% penalty on the collateral, far more expensive than the cost of a preventive intervention).
5. Focus the backtest on periods of extreme historical BNB volatility (not only calm periods) — those are precisely the periods that matter for proving the value of health factor monitoring.

---

## 5. Contract and endpoint verification status summary

| Item | Address/Endpoint | Status |
|---|---|---|
| PancakeSwap V3 Factory (BSC) | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | ✅ |
| PancakeSwap V3 NonfungiblePositionManager (BSC) | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | ✅ |
| Venus Comptroller (Core Pool, BSC) | `0xfD36E2c2a6789Db23113685031d7F16329158384` | ✅ |
| Venus vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | ✅ |
| Aave v3 Pool Proxy (BSC) | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | ✅ |
| Aave v3 PoolAddressesProvider (BSC) | `0xA97684ead0e402dC232d5A977953DF7ECBaB3CDb` | ❌ **no code on BSC** — do not use, look it up again via the official `aave-address-book` |
| Chainlink BNB/USD Feed (BSC) | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | ✅ |
| DefiLlama Yields `/pools` & `/chart/{pool}` | `https://yields.llama.fi/pools`, `https://yields.llama.fi/chart/{pool}` | ✅ |
| PancakeSwap v3 fee/APR data on BSC via DefiLlama | — | ❌ not available (the `pancakeswap-amm-v3` project on DefiLlama only covers Ethereum & Opbnb) — use our own on-chain event log/subgraph |
| PancakeSwap Limit Order engine (contract address) | — | ⚠️ NEEDS VERIFICATION |
| Aave `getReserveData()` for BSC supply/borrow rates | — | ⚠️ NEEDS VERIFICATION (not tested live) |
| Venus/Aave oracle module address (used internally for HF) | — | ⚠️ NEEDS VERIFICATION |
| "Binance Oracle" as a price source | — | ⚠️ NEEDS VERIFICATION (no explicit confirmation found) |
| PancakeSwap v3 subgraph endpoint for BSC | — | ⚠️ NEEDS VERIFICATION (The Graph's hosted service is deprecated, the decentralized-network endpoint needs an API key — the current endpoint has not been confirmed) |

---

## Sources

- [Backtesting Framework for Concentrated Liquidity Market Makers on Uniswap V3 (arXiv:2410.09983)](https://arxiv.org/html/2410.09983)
- [Predictable Loss and Optimal Liquidity Provision (arXiv:2309.08431)](https://arxiv.org/pdf/2309.08431)
- [Adaptive Liquidity Provision in Uniswap V3 with Deep RL (arXiv:2309.10129)](https://arxiv.org/pdf/2309.10129)
- [Risks and Returns of Uniswap V3 Liquidity Providers (arXiv:2205.08904)](https://arxiv.org/pdf/2205.08904)
- [Gamma Strategies docs](https://docs.gamma.xyz/gamma/features/strategies)
- [Impermanent Loss in Uniswap V3 — Auditless/Medium](https://medium.com/auditless/impermanent-loss-in-uniswap-v3-6c7161d3b445)
- [Rebalancing vs Passive strategies for Uniswap V3 — DeFi Scientist/Medium](https://medium.com/@DeFiScientist/rebalancing-vs-passive-strategies-for-uniswap-v3-liquidity-pools-754f033bdabc)
- [Pionex — Grid Bot Parameters Explained](https://www.pionex.com/blog/grid-bot-parameters/)
- [3Commas — Grid bots: Main settings and options](https://help.3commas.io/en/articles/7932030-grid-bots-main-settings-and-options)
- [PancakeSwap — Limit & TWAP Orders docs](https://docs.pancakeswap.finance/trade/limit-orders)
- [PancakeSwap v3 Addresses — developer docs](https://developer.pancakeswap.finance/contracts/v3/addresses)
- [DefiLlama Yields API — pools/chart](https://yields.llama.fi/pools)
- [Venus Protocol docs — Comptroller reference](https://docs-v4.venus.io/technical-reference/reference-isolated-pools/comptroller/comptroller)
- [Venus Protocol GitHub](https://github.com/VenusProtocol/venus-protocol)
- [Aave v3 Pool contract docs](https://aave.com/docs/aave-v3/smart-contracts/pool)
- [Chainlink Data Feeds — BSC addresses](https://docs.chain.link/data-feeds/price-feeds/addresses)
- [Chainlink BNB/USD feed (data.chain.link)](https://data.chain.link/feeds/bsc/mainnet/bnb-usd)
- [Binance Klines API reference (via VoiceOfChain Academy summary)](https://voiceofchain.com/academy/binance-api-historical-data)
- [CryptoDataDownload — Binance historical OHLCV](https://www.cryptodatadownload.com/data/binance/)
