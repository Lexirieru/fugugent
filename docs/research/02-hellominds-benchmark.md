# HelloMinds ("Minds by Animoca Brands") — Product & UX Benchmark for Fugugent

> In-depth research for **Fugugent** — an agent marketplace on BNB Chain with cartoon fugu fish characters.
> Research date: **2026-09-08**. Source content version: `llms.txt v1.9.2` (last updated 2026-08-26).

---

## 0. Methodology & Source Status

| Source | Status | Notes |
|---|---|---|
| `https://www.hellominds.ai/` | ⚠️ SPA (Vite/React) | The initial HTML is just a `<div id="root">` shell. Content is rendered client-side. |
| `https://www.hellominds.ai/sitemap.xml` | ✅ OK | 46 URLs. |
| `https://www.hellominds.ai/robots.txt` | ✅ OK | Reveals private paths: `/api/`, `/profile`, `/profile/minds`, `/composio/callback`. |
| `https://www.hellominds.ai/llms.txt` | ✅ OK | 12.9 KB — the official product summary. |
| `https://www.hellominds.ai/llms-full.txt` | ✅ OK | 25.4 KB — the full reference + FAQ. |
| `https://www.hellominds.ai/.well-known/agents.json` | ✅ OK | 14.2 KB — a structured agent manifest. |
| `https://www.hellominds.ai/data/bazaar.json` | ✅ OK | **193 KB — the full Bazaar catalogue (119 Apps + 29 Skills).** |
| `https://www.hellominds.ai/data/minds.json` | ✅ OK | **19 KB — 19 One-Click Mind templates.** |
| `https://www.hellominds.ai/data/toolkits.json` | ✅ OK | **95 KB — 104 toolkits + auth schemes (Composio).** |
| `https://www.hellominds.ai/assets/index-nE9hYUns.js` | ✅ OK | **A 3.0 MB bundle — the source of truth for UI copy, API endpoints, and the card schema.** |
| `https://build.hellominds.ai/sitemap.xml` | ✅ OK | 69 URLs (4 locales: en/jp/ko/vi). |
| `https://build.hellominds.ai/llms.txt` | ✅ OK | A map of the Builder Hub docs. |
| `https://build.hellominds.ai/llms-full.txt` | ❌ **404** | The file does not exist (returns a Next.js 404 page). |
| `https://www.hellominds.ai/bazaar` (rendered) | ⚠️ Needs JS | The data comes from `/data/*.json` (which we fetched directly). |
| `https://app.hellominds.ai/onboarding` | 🔒 **Needs login** | Not accessible without an account. The flow was reconstructed from bundle copy + docs. |
| `https://www.hellominds.ai/locales/en/*.json` | ✅ OK | The i18n files — an **identity map** (key == English value), so these are the literal UI copy. |
| `https://www.hellominds.ai/data/tutorials-manifest.json` + `/data/get-started-guide.json` | ✅ OK | 25 tutorial slugs + the complete 5-step onboarding guide. |
| `https://build.hellominds.ai/<path>.md` | ✅ OK | A **"markdown twin"** for every docs page — the best way to read the Builder Hub. |
| `https://build.hellominds.ai/docs/api` | ✅ OK | A **full OpenAPI 3.0.3 spec** embedded in a Next.js chunk (`JSON.parse('…')`) — 21 paths / 27 operations. |
| All 17 Builder Hub pages | ✅ OK | None failed; **none required a login**. |

**The key method:** because both sites are SPAs (the product = **Vite + React Router**; the Builder Hub = **Next.js**), the actual content was obtained by (a) downloading the 3 MB JS bundle and extracting the prose string literals, (b) downloading the static data files `/data/*.json` and `/locales/en/*.json`, (c) using the `.md` markdown twins on the Builder Hub, and (d) extracting the OpenAPI spec from a Next.js chunk. Every card field, endpoint, and piece of UI copy in this document is **directly observed**, not guessed.

> ⚠️ **An honest limitation:** the user dashboard (`/profile`), the Stripe checkout flow, and the Builder Console (`/console`, where API keys are created) sit behind a login and were **not accessed**. All dashboard element names in §4.5 come from the JS bundle and the i18n files, not from a logged-in session — so they are accurate as *strings that exist in the code*, but the visual layout is unverified.
>
> ⚠️ **An important warning:** their marketing documents (`llms.txt`, `llms-full.txt`) **overstate** what the shipped product actually does. Every important claim has been cross-checked against the production bundle; the differences are documented in **§7.3**.

---

## 1. Full Site Map

### 1.1 The product site — `www.hellominds.ai`

```
/                              Landing
/about                         About
/for-everyone                  Consumer page
/examples                      Everyday examples
/pricing                       Pricing & Cognition Credits
/faq                           FAQ
│
├── /bazaar                    ← MARKETPLACE (landing)
│   ├── /bazaar/minds          19 One-Click Mind templates
│   ├── /bazaar/apps           119 Apps (integrations)
│   └── /bazaar/skills         29 Skills (playbooks)
│
├── /docs/overview             Knowledge base
│   ├── /docs/core-concepts
│   ├── /docs/getting-started
│   ├── /docs/guides
│   ├── /docs/security
│   └── /docs/troubleshooting
│
├── /tutorials                 Tutorial hub
│   ├── /tutorials/get-started
│   ├── /tutorials/signalsentry-daily-x-brief
│   ├── /tutorials/superior-trade-app-and-skill
│   ├── /tutorials/game-dev-threejs
│   ├── /tutorials/minds-video
│   └── /tutorials/storyboard-image-generator
│
├── /quiz/mindprint            ← A 3-minute acquisition quiz
│   ├── /quiz/mindprint/research
│   └── /quiz/mindprint/types/{16 types}   ← 16 personality types (MBTI style)
│
├── /campaign/free-credits     Free credits promo
├── /campaign/moca             MocaProof rewards
├── /campaign/burn-sp          Burn $MOCA Staking Power → Cognition
│
├── /privacy-policy, /terms-of-use
└── 🔒 /profile, /profile/minds   (private, disallowed in robots.txt)
```

**Other subdomains (from the bundle):** `app.hellominds.ai` (the main app + `/onboarding`), `api.hellominds.ai` (the v1 API), `api.auth.hellominds.ai`, `api.orbit.hellominds.ai` (feedback), `api.build.hellominds.ai`, `name-api.hellominds.ai` (Mind name availability check), `assets.hellominds.ai`.

### 1.2 The Builder Hub — `build.hellominds.ai` (4 locales: en/jp/ko/vi)

```
/en                                        Builder Hub landing
/en/docs                                   Docs hub
│   ├── /en/docs/get-started/account-setup
│   ├── /en/docs/get-started/cli
│   └── /en/docs/get-started/client-library
│   ├── /en/docs/guides/building-skills
│   └── /en/docs/guides/circles
/docs/api                                  API Reference (Builder Tools)
/en/changelog                              Release notes
/en/faq
/en/inspirations                           Builder case studies
│   ├── /en/inspirations/etsy-shop-strategist
│   ├── /en/inspirations/superior-trade-intern
│   └── /en/inspirations/architect-of-ancestry
/en/program                                Minds Investment Programme (US$10M)
│   ├── /en/program/faq
│   ├── /en/program/apply
│   └── /en/program/build-east
```

> **An important observation:** the HelloMinds builder documentation is **very thin** — only **5 docs pages** plus 1 API reference. This is a *weakness* we can beat, not a benchmark to chase.

---

## 2. Product Model

### 2.1 What they sell

HelloMinds **does not sell agents per unit**. What they sell is **compute fuel** (`Cognition Credits`). Agents, templates, Skills, and Apps are all **free to equip**.

> Their business model: **"Labor-as-a-Service"** (their own term, in `agents.json` → `entity.operating_model`).

| Layer | Paid? | Mechanism |
|---|---|---|
| Creating a Mind (agent) | **Free** | No credit card / wallet |
| Equipping a Skill / App from the Bazaar | **Free** | No per-item cost |
| Running an agent (reasoning + tool calls) | **Paid** | Burns Cognition Credits |
| Publishing to the Bazaar (as a builder) | Free | Revenue share is **not live yet** (see §5.4) |

### 2.2 Who uses it

Two explicit audiences, with separate pages:

1. **Minds for Everyone** (`/for-everyone`) — non-technical consumers. The personas mentioned: sales professional, realtor, parent, Etsy shop owner, content creator, AI beginner, trader/market watcher.
2. **Minds for Builders** (`build.hellominds.ai`) — developers, prompt engineers, and creators publishing Skills/Apps/Tools.

### 2.3 Agent structure: **Soul + Brain**

This is their strongest conceptual framing and is worth copying structurally:

- **Soul** — the permanent core: **Identity (DNA)** + **Memory** + **State** + **Wallet**. Owned by the user, cannot be taken away by the platform, a "sovereign asset".
- **Brain** — the LLM that thinks. **Auto-routed** to the most appropriate model per task. No vendor lock-in.
- Their key line: *"The Soul persists, only the Brain switches."*

Supporting concepts:

| Term | Definition (verbatim from the docs) |
|---|---|
| **DNA / Identity** | A Mind's permanent personality, values, and operating principles. |
| **Memory** | Long-term (LTM) + short-term (STM), persisting across sessions. |
| **State** | Dynamic internal variables — **"stress, focus, trust"** — changing in real time. |
| **Wallet** | An on-chain wallet per Mind. The private key is encrypted; the AI never accesses it. |
| **Tool** | One specific capability (1 API call), e.g. "send Gmail". |
| **Skill** | A *learned playbook* — a multi-step sequence of instructions. |
| **App** | A bundle of Tools under one identity (e.g. the Gmail App = every Gmail Tool). |
| **Artifact** | A passive digital object (file/document) a Mind can read. |
| **Circle** | A trust-gated group for Mind-to-Mind collaboration. |
| **Concierge** | The onboarding agent that "Awakens" your first Mind. |
| **Swarm** | A set of specialised Minds working together. |

### 2.4 Pricing & the credit system

**Free at launch.** Consumption is based on **Cognition Credits**, paid through **Stripe** (and crypto).

**Monthly plans:**

| Plan | Price | Credits | For |
|---|---|---|---|
| Standard | US$10/mo | 1,000 | Research & multi-step workflows |
| Pro | US$25/mo | 2,500 | Complex tasks & automation |
| Ultra | US$50/mo | 5,000 | High-volume, always-on |

**One-off top-ups:**

| Pack | Price | Credits |
|---|---|---|
| Starter | US$10 | 1,000 |
| Standard | US$25 | 2,500 |
| Pro | US$50 | 5,000 |

**Credit mechanics (worth copying):**

- Credits are tracked **per Mind**, not per account. Each agent has its own wallet.
- **There is no flat rate per action** — *"complexity drives consumption"*. A quick lookup costs little; deep multi-step research costs a lot.
- Low-balance warnings are sent **by the agent itself**, via email/Telegram, **including a Stripe payment link**. The user does not have to watch the balance.
- If credits run out mid-task: *"Your Mind pauses and notifies you. It won't drop a task silently... Once credits are restored, it picks up where it left off."*
- The `/profile` dashboard shows credit usage trends per Mind.

**The credit-based acquisition loop (very relevant for a Web3 hackathon):**

- **Free credits:** +200 Cognition for each of the first 3 Minds; the 4th and 5th Minds get +90.
- **Daily refill:** an automatic top-up of 1 Mind per day, only for active Minds with a balance **< 100 Cognition**. The one chosen is the most recently created Mind.
- **Referrals:** *"Refer a friend. You both earn $5 in Cognitions"* — paid out after the referral completes **3 conversations**.
- **Burn-to-earn:** burn $MOCA Staking Power → Cognition. The best rate is **100 LLM tokens per SP** for the first 50,000 SP. Staked $MOCA is untouched; only SP is converted.
- **Credential-gated airdrop:** free credits based on a **MocaProof** credential (decentralised identity).

---

## 3. Category Taxonomy & Agent Card Anatomy

### 3.1 A three-layer taxonomy (+ one)

The Bazaar is split into **3 tabs**, plus Tools as a hidden layer:

| Tab | Count | Definition |
|---|---|---|
| **Minds** (`/bazaar/minds`) | **19** | Ready-to-use agent templates (One-Click) |
| **Apps** (`/bazaar/apps`) | **119** | External integrations (Gmail, Notion, Slack…) |
| **Skills** (`/bazaar/skills`) | **29** | Multi-step playbooks |
| *Tools* | 104 toolkits | No tab of their own; the building blocks |

### 3.2 ⭐ The card schema — **the fields that ACTUALLY exist**

Taken straight from `bazaar.json` / `minds.json`:

**A Skill / App card:**
```json
{
  "id": "F230493E-F36B-1410-8462-00039CE7DF11",
  "name": "LinkedIn Recruiter Research",
  "short_description": "Search and research LinkedIn jobs, people, profiles, and companies",
  "description": "Unlock LinkedIn recruiter research without credentials touching your Mind...",
  "disclaimer": "",
  "iconTint": "red",
  "iconInitials": "LR",
  "image": "linkedin_recruiter_research.webp",
  "tutorial": "<ul><li>Your mind will ask you to go to the Browserbase website...</li></ul>",
  "apiKey": "",
  "level": "Easy",
  "useCases": [
    "Searched 38 software engineer roles across top tech companies",
    "Located 15 founder profiles",
    "Fetched full company profiles with headcount and funding"
  ],
  "tag": ["Featured"]
}
```

**A Mind card (agent template):**
```json
{
  "id": "general-assistant",
  "archetype": "generalassistant",
  "name": "General Assistant",
  "configurable": true,
  "short_description": "Handle bookings, reminders, and daily life tasks.",
  "description": "A personal assistant gifted to someone you care about...",
  "iconTint": "red",
  "iconInitials": "GA",
  "image": "mind_general_assistant.webp",
  "imageWithBackground": "with-background/mind_general_assistant_clean.webp",
  "useCases": ["Booked a restaurant for Saturday at 7pm", "..."],
  "skills": [],
  "apps": ["Google Calendar", "Gmail", "Google Tasks", "Google Sheets", "Google Docs"],
  "tag": ["Official", "Featured"]
}
```

**Runtime fields (from the JS bundle, fetched separately per card):**
```js
t[r] = n.equippedCount ?? n.popularity ?? n.usageCount ?? undefined
// rendered as: `Equipped: {{count}}` with count.toLocaleString('en-US')
```

### 3.3 ⭐⭐ Field analysis: what EXISTS versus what DOES NOT

| Field | Present? | Actual UI label / notes |
|---|:---:|---|
| Name | ✅ | |
| Short description (1 line) | ✅ | On the card; the long description is in the modal, under the **"Description"** section |
| Icon / image | ✅ | + an `iconInitials` fallback + `iconTint` (colour) |
| **`level`** (Easy/Intermediate/Advanced) | ✅ | The UI label is **"Setup Effort"** (not "difficulty"). Rendered as a **3-bar meter** |
| **`useCases`** (past-tense outcomes) | ✅ | The UI label is **"Example Actions"** — a checked bullet list. **Their strongest pattern**, see §3.4 |
| **`tag`** | ✅ | Badges: `Official`, `Featured`, `Verified` (green + a checkmark icon), `Composio` (purple) |
| **`equippedCount`** | ✅ | The only social metric. Label: `Equipped: 1,234` |
| `tutorial` (HTML) | ✅ | UI label: **"What to Expect when you install the {{name}} {{app\|skill}}"** |
| `disclaimer` | ✅ | Mostly empty, **but** the value `"Crypto Trading"` triggers an orange warning banner: *"This app involves crypto trading. Please ensure you understand the risks before proceeding."* |
| `apiKey` (a URL for obtaining a key) | ✅ | Only 5 of the 148 items need an external key |
| **Rating / stars** | ❌ | **DOES NOT EXIST** |
| **User reviews** | ❌ | **DOES NOT EXIST** |
| **Per-item price** | ❌ | **DOES NOT EXIST** (everything is free to equip) |
| **Latency / execution time** | ❌ | **DOES NOT EXIST** |
| **Success rate / reliability** | ❌ | **DOES NOT EXIST** |
| **Creator / author** | ❌ | **DOES NOT EXIST** — everything looks first-party |
| **Run / execution count** | ❌ | **DOES NOT EXIST** (only "equipped") |
| **Estimated credit cost** | ❌ | **DOES NOT EXIST** — the user has no idea what it costs before running it |
| **Last updated / version** | ❌ | **DOES NOT EXIST** |

### 3.3b ⚠️ AN IMPORTANT CORRECTION: the API has more fields than the UI shows

The table above describes **what is rendered on the Bazaar web card**. But the **Builder API** (`GET /v1/bazaar/apps/{appId}`) returns a far richer object:

```jsonc
// BazaarApp — from the OpenAPI spec v1.0.3
{
  "appId": "...", "appName": "...", "description": "...",
  "tier": "wild" | "verified",   // ← a TWO-LEVEL trust label, it really is in the API
  "provider": "composio",         // ← the CREATOR/PROVIDER IS in the API
  "version": "...",               // ← VERSIONING EXISTS
  "createdAt": "...",             // ← A TIMESTAMP EXISTS
  "toolCount": 12,
  "equippedCount": 1234,
  "authType": "OAUTH2",
  "minCoreVersion": "...",
  "tools": [{ "toolSlug": "..." }] // only on the detail endpoint
}
// BazaarSkill
{ "skillId", "name", "description", "createdAt", "equippedCount",
  "source": "mind" | "system" }   // mind = from the catalogue/made by a Mind, system = a platform skill
```

The CLI also already supports filters that **do not exist in the web UI**:
```bash
minds bazaar search "slack" --tier verified --provider composio --sort equipped
# --sort: equipped (popularity) | name | newest (createdAt)
```

> 🎯 **This strengthens the conclusion rather than weakening it.** HelloMinds **already has** tier/provider/version/createdAt/toolCount in the backend — but **shows none of it on the marketplace card**. The failure is a **product and UX failure, not a data failure**. This is the sharpest lesson for Fugugent: having the data is worthless if you do not render it at the point of decision.
>
> What genuinely **does not exist anywhere** (API or UI): **rating, reviews, success rate, latency, cost per run, run count**. The eleven fields that would help most with the "which agent do I hire" decision are missing. The hackathon judges score **Data Quality: "accurate real-time data that lets a user make a decision"** — this is where Fugugent can win outright.

### 3.4 The `useCases` pattern: outcome sentences in the **past tense**

This is their strongest copywriting pattern and **must be copied**:

> "Searched 38 software engineer roles across top tech companies"
> "Booked a restaurant for Saturday at 7pm"
> "Labelled 23 emails across 4 categories"
> "Pulled last 12 company posts with engagement and commentary"
> "Found the cheapest flight for your trip"

Not *"Can search for job openings"* (a capability, abstract) but *"Searched 38 openings"* (an outcome, concrete, with a number). It answers the user's question **"what will I get?"** in one second, rather than **"what can this tool do?"**.

### 3.5 The real category taxonomy (from `toolkits.json`)

48 distinct categories at the toolkit layer. The ten largest:

| Category | Count |
|---|---|
| team collaboration | 16 |
| payment processing | 15 |
| developer tools | 12 |
| crm | 10 |
| project management | 10 |
| productivity | 8 |
| task management | 8 |
| accounting | 8 |
| social media accounts | 6 |
| team chat | 5 |

Others: email, databases, analytics, ecommerce, marketing automation, ai content generation, video conferencing, scheduling & booking, customer support, and so on.

> ⚠️ But **not one** of these 48 categories is used as a filter in the Bazaar UI. The filters that exist are about *trust/origin* (`Verified only`, `Official`, `Third-Party`, `Featured`, `Recommended`) and *alphabetical order* — **there is no topic/category filter at all**. That is an obvious navigation weakness: 119 Apps with no way to say "show me only CRM" or "only finance".

### 3.6 The complete catalogue of 19 One-Click Minds

| Name | Short description | Apps | Skills |
|---|---|:--:|:--:|
| General Assistant | Handle bookings, reminders, and daily life tasks | 5 | 0 |
| Sales Mind | Design, run, and improve your sales motion | 6 | 3 |
| Bizz Mind | Audit ideas, crunch numbers, find fastest path to growth | 3 | 3 |
| **Superior Trader** | Designs and validates automated trading systems **on-chain** | 1 | 0 |
| Game Designer | Turns game concepts into player-ready systems | 0 | 0 |
| Email Manager | Reach inbox zero with smart cleanup | 2 | 3 |
| Scrum Master | Run sprints, manage backlog, flag blockers in Notion | 1 | 1 |
| Fitness Coach | Schedule workouts, track goals | 2 | 1 |
| Personal Chef | Plan meals, track nutrition, optimise grocery | 2 | 3 |
| Recruiter | Find candidates, benchmark market, close roles | 1 | 4 |
| Football Mind | Sports companion & tournament analyst | 3 | 0 |
| Decision Mind | Strategic thinking partner | 1 | 0 |
| Content Mind | Brand-voice partner → publish-ready content | 1 | 0 |
| Research Mind | Private analyst, sourced output | 1 | 0 |
| Product Builder Mind | Idea → buildable & ready to ship | 1 | 0 |
| Learning Coach Mind | Personal tutor, tuned learning plan | 1 | 0 |
| Follow-Up Mind | Tracks who you owe, drafts follow-ups | 1 | 0 |
| GTM Mind | Positioning, messaging & launch | 1 | 0 |
| Chief of Staff Mind | Tasks + meetings → one moving plan | 1 | 0 |

> 📌 **A note on depth:** the distribution is very lopsided. The top 4 Minds have 3–6 Apps and 3 Skills; **the last 11 Minds have only 1 App and 0 Skills** — practically just a persona prompt. For the **Agent Diversity: "all 4 categories equally deep"** judging criterion, HelloMinds is a **bad** example: they have breadth (19 templates) but uneven depth.

### 3.7 `level` distribution (difficulty)

| | Easy | Intermediate | Advanced |
|---|---|---|---|
| Apps (119) | 110 | 2 | 7 |
| Skills (29) | 25 | 1 | 3 |

---

## 4. End-to-End User Flow (the exact steps)

### 4.1 Landing → Sign-up

1. The landing page `/`. The main headline emphasises **sharing**: *"One shared AI agent keeps everyone aligned"*, *"Finally, an AI you can actually share."*
2. Three audience variants in the hero: **For friends / For colleagues / For you and your loved ones**.
3. CTA: `Try it Free`. There is also an alternative acquisition path: the **Mindprint quiz** (*"Take our 3-minute Mindprint quiz and find the AI agent built for how you think"*) → 16 personality types → an agent recommendation.
4. Sign-up: **email only**. The copy: *"No wallets, no code, no barriers. You're live in seconds."* The wallet is created **automatically in the background**. One profile per email.
5. T&C acceptance: *"To continue using Minds by Animoca Brands, please accept the following:"*

**Their strongest positioning copy** (worth studying for the Fugugent landing page):

- 🏆 *"**The shift is simple — you're not asking a Mind for an answer, you're giving it a job.**"* — one sentence that explains the entire product category. This is the copywriting benchmark.
- *"Minds is AI made easy for everyone. **Always on. Free to launch. No installation.**"* — three points of friction removed in three phrases.
- *"**No wallets, no code, no barriers.** You're live in seconds."*
- *"...like a teammate that **never forgets and never clocks off**."*
- *"A Mind that acts, executes, and — as the agentic economy arrives — **transacts**."*
- *"Personal. Persistent. Portable."*
- The three-step framing on the landing page: **(1)** *"Describe your needs through email or chat via Telegram and your mind does the rest."* → **(2)** *"Your Mind gets to work organising, researching, building... 24/7."* → **(3)** the result.

> ⚠️ Note: *"No wallets, no code, no barriers"* is a deliberate **anti-Web3** position. Fugugent lives on BNB Chain, so we cannot copy it literally — but we do have to match the *level of friction* the user feels (e.g. an embedded/smart wallet, a gasless first action).

**Gamification:** there is a hook — *"Your files, skills and Minds all in one place. Get to your task and **clear a daily quest**."* — a daily quest, paired with the daily credit refill. A cheap retention loop that fits a crypto audience very well.

**Product status:** *"Minds is currently in **Beta**."*

### 4.2 Onboarding — two paths

After signing up, the user chooses: *"Choose between Quick Setup or Tailored Setup."*

**Path A — Quick Setup / One-Click:**
1. *"Pick a Mind template to get started, or build your own."*
2. Pick a template from the 19 archetypes. Skills come pre-equipped.
3. Name the Mind (checked through `name-api.hellominds.ai`).
4. Done → an introduction email is sent.

**Path B — Tailored Setup (Concierge):**
1. A loading screen: *"Please wait while your Master Mind is being activated."* / *"Master Mind will guide you step by step on how to launch your first Mind."*
2. A step-by-step conversational wizard. The copy at each step:
   - *"A few quick questions so your {{name}} understands you more and can act like part of your team."*
   - *"Tell us what you'd like your assistant to handle and your main priority."*
   - *"Help your Mind understand who you serve and what you focus on."*
   - *"What would make your assistant genuinely useful on day one?"*
   - *"Give your Mind a name and personality that matches your brand."*
   - *"One last step. What will you call your assistant?"*
3. A time estimate is shown: *"Customize based on your needs and preferences. Takes 1–2 min."*
4. **An escape hatch:** *"In a rush? Reply to the Concierge: 'Please go ahead and create my Mind now.' You can calibrate its personality later just by conversing with it."*
5. The Concierge "Awakens" the Mind → the Mind sends an introduction email from its own `@amind.ai` address.

> 💡 The Concierge is framed firmly as *single-use*: *"Do not treat it as a personal assistant — it exists only to spawn your specialized Mind."*

**The official names of the three paths** (verbatim from the FAQ): *"Launch a Mind from the main page or dashboard — you can choose **One-click Minds** (pick a template), **Guided Mind** (choose options and add your own context), or **Speak to Concierge** (recommended for custom Minds)."*

**The follow-on onboarding (`/tutorials`)** is packaged as one staged path, not a pile of loose articles: *"A step-by-step path from creating your first Mind to building Circles. Each step combines short videos and written guides — **watch, read, or both**."* A good pattern: every step has two modalities and the user picks.

### 4.3 First activation

1. The Mind sends an introduction email: it states its name, confirms its purpose, and invites interaction.
2. *"Reply the email to start chatting, or connect via Telegram instead."*
3. The conversation starts with the first reply. There is no app to install.
4. Channels: **email (primary)** + **Telegram** + WeChat (via a `/bind` token) + WhatsApp Business.

**Connecting Telegram (the exact steps from the docs):**
1. Open Telegram, find `@BotFather`, start a chat.
2. Send `/newbot`, follow the prompts.
3. Pick a display name + username (must end in `_bot`).
4. Open the profile page (`profile.animocaminds.ai`).
5. Verify the Telegram account (phone number + confirmation code).
6. *"Say hello — your Mind is now live in Telegram."*

### 4.4 ⭐ Discovery → Detail → **Equip** (the "hire" flow)

This is the core marketplace flow.

1. **Browse** — `/bazaar` with 3 tabs: Minds / Apps / Skills. The hero is marked **"EARLY BETA"**: *"Browse one-click Minds, Apps, and Skills powering the ecosystem."*
   - A search box (client-side substring match, case-insensitive).
   - The filter/sort chips that actually exist: **`Featured`**, **`Recommended`**, **`All`**, **`A → Z`**, **`Z → A`**, **`Verified only`**, **`Official`**, **`Third-Party`**. For Apps there are two more: `Connected first`, `Not connected first`.
   - Result counter: `{{total}} {{noun}} found` / `Showing {{total}} {{noun}}`.
   - Mind list sorting: `Recently Created` (default) | `A → Z`.
   - A view mode toggle: `grid` | `list` — **persisted in `localStorage`** (`minds:viewMode`, `minds:sort`).
   - A responsive grid: `grid-cols-2 lg:grid-cols-3` (2 columns on mobile, 3 on desktop).
   - Pagination + "View All".
2. **The card** shows: the icon, the name, `short_description` (truncated to 1 line), an `Official` badge (a blue pill) + a `Verified` checkmark icon, the `level` signal bar, and `Equipped: {{count}}`.
3. **Clicking a card → a detail modal** (`max-w-[900px] max-h-[90dvh]`), containing:
   - Header: icon, name, badges, `Equipped: {{count}}`
   - The long `description`
   - **"How it works"** — the `tutorial` content (an HTML list)
   - **"Use cases"** — the past-tense `useCases` list
   - The bundled Apps/Skills (for a Mind)
   - The primary button: **`Equip this App`** / **`Equip this Skill`**
4. **Equip** → a dialog: *"Choose Mind(s) to equip"* / *"Choose a **Mind.**"*
   - It shows the user's list of Minds, **with each one's credit balance** (`loadCredits`)
   - Sorting inside the dialog: `Recently Created` | `A → Z`
   - Minds that already have this item are marked **`Equipped`** (idempotent, you cannot double up)
   - Inactive Minds are sorted to the bottom (`isEnabled` first)
5. **Confirm** → `POST /v1/minds/{mindId}/apps` or `POST /v1/minds/{mindId}/skills`
6. **A cost warning before execution** (copy verbatim):
   > *"This activates a real cycle and spends Cognition, the same as any regular message to your Mind. The Mind typically gets going within a minute. If a cycle's already running or queued, the nudge won't add another on top."*
7. If a Skill needs an external API key, the Mind **asks for it in conversation**, not through a form.

**An alternative flow (documented in `llms.txt`):** the user copies a *"generated activation message"* and pastes it to the Mind over email/Telegram; the Mind equips it automatically. So there are **two equip paths**: the web UI and a natural-language message.

**Empty states in the equip flow (verbatim):**
- No Minds yet → *"Create your first Mind, then come back to equip it."* + a `Create a Mind` button
- Not logged in → *"Log in to see the Minds on your account and equip this to one of them."* + `Sign in to pick a Mind`
- Failure → *"We couldn't equip that Mind. Please try again."*

### 4.5 Monitoring / Dashboard (`/profile` — 🔒 the page requires a login; the element names below come from the bundle + i18n files, not from a logged-in session)

**`/profile` tabs:** `My Minds` · `My Connections` · `Linked Accounts` · `Redeem` · `Referral`. The header shows `Account ID:`.

**The Mind detail page (`/profile/minds/:mindId`)** — tabs `Overview` · `Mind Connections`, plus a `Chat now` action (*"Open your Mind in the app and start chatting instantly."*).

**Panels on Overview (labels in capitals):** `COGNITION` · `COGNITION USAGE` · `MIND CIRCLE` · `CIRCLE MEMBERS` · `WALLETS`, plus `App Connections`, `Skills`, `Tools`, `Status`, `ID:`.

**The controls that actually exist:**

| Control | Detail |
|---|---|
| **Online/Offline toggle** | **This is the real kill switch.** Helper copy: *"**Online Minds accept new tasks. Switch to Offline to pause without deleting.**"* aria-label: `Status: {{label}}. Click to toggle.` Toast: `Mind is now online` / `Mind is now offline`. |
| **Nudge** | Wakes the agent manually. `POST api.hellominds.ai/v1/messaging/{mindId}/beacon` with `triggerImmediateCognition`. The result: **"Nudge sent"** (*"will start a cognition cycle within a minute or so"*) or **"Nudge noted"** (*"already has a cognition running or queued"*). Blocked when offline: *"{{mindName}} is offline — switch it online to nudge"*. |
| **Top up** | `Top Up Now — US ${{amount}} one-time` / `Top Up Now — {{price}} {{cadence}}`, `{{count}} Cognitions`, `Worth of Cognition`, `Transaction Reference`. |
| **Manage Circle** | `ADD TO CIRCLE`, `Already in circle`, *"That's the Steward — already in circle"*. |
| **Wallet** | *"Each Mind has its own blockchain wallet for Web3 integrations."* States: *"Mind's wallet address is initializing…"*, *"Wallet initialization timed out"*. |

**What DOES NOT exist, despite being claimed in `llms-full.txt`:**
- ❌ **There is no "activity log"** in the UI. The closest thing is the `COGNITION USAGE` panel.
- ❌ **There is no soft kill "Quit emailing me"** in the site UI — it only appears in `llms-full.txt`.
- ❌ **There is no "high-impact action" confirmation** — the strings `high-impact` and `undo` appear **zero times** in the bundle.
- ❌ **Deleting a Mind is not self-serve.** From the FAQ: *"**Deletion isn't self-serve yet.** If you want a Mind permanently removed, get in touch with us and we'll handle it for you."*

**Referrals (the only real revenue-share number on the entire platform):**
> *"Share your unique link and earn **20% of every credit top-up your referrals make — no cap, paid monthly**."*

**Billing (Stripe):** `Monthly` / `One Time`; *"Redirected to Stripe · Secure checkout · 256-bit SSL"*; *"✓ Cancel anytime · No lock-in · **Cognitions reset monthly**"*; *"✓ One-time charge · **Cognitions never expire**"*.

**Linked Accounts:** Telegram, WeChat, iMessage. ⚠️ An irreversibility warning: **`Linked (This can't be unlinked)`** and *"**This is a one-time action. Once linked, your Telegram account cannot be unlinked from this profile.**"*

### 4.6 Corrections and fixes

The mental model they use: **treat the agent like an employee**.

> *"Treat your Mind like an employee. Tell it exactly what it did wrong and how to fix it in the future. The Mind will record this feedback in its long-term memory and adjust its future behaviour."*

---

## 5. Differentiating Features

### 5.1 Circles — Mind-to-Mind collaboration with a trust gate

Their most original mechanism.

- By default a Mind **cannot** talk to another Mind.
- How to introduce them: (a) send an email and **CC the target Mind's email address**, or (b) add them to a shared **Telegram group**.
- **A privacy guarantee:** *"Unknown agents or persons are fully blocked — your Mind does not even see the incoming message."* The block happens **before** the context reaches the model — a cross-agent prompt-injection mitigation.
- **An excellent permission warning** (verbatim, worth copying as-is):
  > *"Only add those you know and trust. Circle members can interact with your Mind, put it to work and **consume Cognition without your prior approval**, access information it knows about you such as schedules, and **request Cognition transfers on your behalf**."*
- The best practice they teach: **a swarm of specialists beats one super-agent**.
- **Outside humans need no account:** *"Anyone can email your Mind directly with no account needed. Introducing someone is as simple as TO'ing or CC'ing them on a thread with your Mind... From there, several humans and Minds can sit in the same conversation, negotiate, agree changes, and execute. You only step in when you want to."* — zero acquisition friction for collaborators.

### 5.2 The agent builder

Three levels, matched to the user's ability:
1. **One-Click** — pick a template, name it. 0 configuration.
2. **Build Your Own** — a name + personality + a description of the desired outcome.
3. **Concierge** — a conversational wizard, AI-guided.
4. **(Builder)** — the CLI + client library, publishing to the Bazaar.

On top of that: **a Mind can create its own Tools and Skills** — *"Ask your Mind to search the public registry; another Mind may have already created what you need. Your Mind can also create its own tools and skills for your personal use."*

### 5.3 The Skill definition format

An important technical finding (verbatim from the FAQ):

> *"Under the hood, a Skill is a **compact JSON playbook** that defines the exact sequence of operations, **hardwires which tool the Mind must call at each step**, and includes **fail-safes** if something goes wrong. Compared with simple prompt files, this design **lowers token cost, improves reliability and execution, and allows creators to monetise per use without exposing their underlying logic**."*

So: not a free-form prompt but a **structured step DAG** with explicit tool binding. That matters — this design is what makes (a) lower cost, (b) deterministic results, and (c) per-use monetisation without leaking IP possible.

**The four artefacts that make up a Skill** (from the Skill Building Guide — the only official structural vocabulary):

| Human-language name | Developer term |
|---|---|
| *"How it's found"* — the listing other builders see in the Bazaar | **Registry Offering** |
| *"How it connects"* — the wiring between the Skill and its app | **App Manifest** |
| *"What it can do"* — the concrete actions it is allowed to take | **Tool Schemas** |
| *"How it behaves"* — the routine it follows | **Skill Playbook** |

> *"You do not need to write any of these directly. You describe the outcome, and your Mind builds and maintains all four."*
>
> ⚠️ **No file format, JSON/YAML schema, or field list is published anywhere.** These four artefacts are only *named*, never *specified*. Authoring is 100% conversational.

### 5.3b The Bazaar publish flow — the exact 6 steps

The official example: a daily standup digest from a Linear board.

| # | Step | Action |
|---|---|---|
| **01** | **Describe** | Chat to the Mind: *"Build me a Skill that reads my team's Linear board and sends me a morning standup digest: what shipped yesterday, what's in progress, and what's blocked. Keep it short."* |
| **02** | **Refine** | The Mind reads its proposal back in plain language. The user: *"Group it by assignee, and flag anything blocked for more than two days."* → *"That's it. Build it."* |
| **03** | **Connect** | **A UI step, not code:** Profile → **My Connections** → find the app → enter the API key → **Save Key**. *"**The platform stores and uses the key. Your Mind never holds the key directly.**"* Set once, reused by every subsequent Skill. |
| **04** | **Run** | *"Give me today's standup."* → a correction: *"Too long. One line per person."* |
| **05** | **Inspect** | ⭐ **Review the scope of access before publishing:** *"Show me what this Skill can do, what it reads, and what it can change. Flag anything it should not touch."* → *"Tighten anything that looks too broad before anyone runs it."* |
| **06** | **Publish** | *"Publish this Skill to the Bazaar as 'Sprint Standup' so my team can equip it."* |

> 🎯 **Step 05 is the best marketplace-security pattern they have** — a human-readable permission audit, done **before** publishing, expressed in plain language. Fugugent needs an equivalent (and can go further by showing it to the *buyer*, not just the publisher).

**Updating a Skill:** through the conversational operations `REGISTRY_Update` and `SKILL_Update`. *"Updates take effect immediately for new sessions — users in an active session continue with the version they started… Your Bazaar listing updates automatically… no separate publishing step needed."*
⚠️ **There is no publish API.** The Bazaar routes in the public API are **read-only (ID discovery)**.

### 5.3c The Constitution: Tenets, Invariants, Guardrails, Priors

Their behaviour governance model — the most mature concept they have, and highly relevant to an agent that holds money.

- **Tenet** — *"a stored rule, belief, or learned fact that lives permanently in a Mind's Soul."* Two kinds:
  - **Invariant** — can never be broken, even if the user explicitly tells it to. This is a **Guardrail**.
  - **Prior** — a flexible learned preference.
- *"**All Guardrails are Tenets — but not all Tenets are Guardrails.**"*
- *"**You define the Guardrails. Your Mind builds up its Priors.**"*
- When a situation conflicts with the Soul, *"the Mind experiences cognitive dissonance and will not comply"*. They call this the **Constitution** — *"both a technical floor (what the Mind can do) and a moral floor (what it won't do)."*
- The user can read and change it: *"Show me your current Tenets."*

**The three Guardrail patterns they give as examples** — note the second one:
1. **Privacy** — *"Never share the Steward's personal email"*
2. 💰 **Budget** — *"**Never spend more than 500 Credits in a single session**"*
3. **Style** — *"Always respond in French"*

> 🎯 **A budget guardrail is a primitive Fugugent must have**, and on-chain we can make it far stronger: not merely an instruction the model complies with, but a **spend cap enforced by a smart contract**. HelloMinds can only promise compliance; we can guarantee it.

### 5.3d Brain Pulse — failure handling

> *"When a Skill fails — due to an API timeout, a missing input, or an unexpected response — the Mind is notified through **Brain Pulse** rather than crashing silently. It can retry the Skill with adjusted parameters, pivot to an alternative approach, or explain the failure."*

A built-in self-monitoring/recovery layer. Good pattern: **an agent that is aware of its own failures and explains them**, instead of failing silently.

### 5.3e Platform built-in Skills

- **Mind Architect** — defines a new Mind's Soul and purpose
- **Skill Architect** — designs/documents a Skill
- **Standard Hygiene** — context management: summarising long conversations, prioritising active memory, pruning
- **Passive Autonomous Mode** — *"lets a Mind take actions without waiting for user prompts: checking in at intervals, sending scheduled updates, or running triggered workflows"*

Tiered memory: **RAM** (active context) → **Episodes** (memories of past sessions) → **Tenets** (permanent).

### 5.4 Creator revenue share — ⚠️ **DOES NOT EXIST YET**

This is a big gap. The evidence:

- FAQ: *"Developers who want to extend the platform can build skills and submit them to the Bazaar, with **monetisation for skill creators coming soon**."*
- `llms.txt` claims builders can *"Earn from users adopting their published items"* — but there is **no mechanism, number, rate, or payout documentation anywhere** in the whole docs set.
- There is no `creator`/`author` field on any of the 148 Bazaar items. Everything is tagged `Official`/`Featured`.
- The Programme FAQ, their most recent official answer (verbatim): *"**Can builders earn from the Skills and Tools they publish?** Yes. Builders who publish Skills and Tools to the Minds Bazaar can benefit from the platform's reward model. **We're still finalising the specifics and will share them in-platform when ready.**"*
- The `/about` page already markets it as if it were live: *"**Monetize on every skill install. Build once, earn every time it runs.**"* — a promise with no mechanism.
- **The builder analytics dashboard does not exist either:** *"A builder analytics dashboard is **in development**. It will give you visibility into session volume, Cognition Credit spending by creation, and Skill call frequency. **Coming soon.**"*

**The only revenue-share number actually published anywhere on the platform is for referrals, not creators:**
> *"Share your unique link and earn **20% of every credit top-up your referrals make — no cap, paid monthly**."*

Beyond that there is the **Minds Investment Programme** (up to US$10M, equity, rolling) and a $5 Cognition referral bonus.

**Investment Programme terms worth noting** (from `/en/program` + `/en/program/faq`):
- *"Selected teams receive a bundle of **cash investment and Cognition Credits**"* — the credits flow right back into their own platform.
- *"**Every accepted team receives platform support, Cognition Credits, and DevRel support regardless of investment.** Investment decisions, if any, are **performance-based**, made on the basis of demonstrated progress, **not at acceptance**."*
- *"**Not all accepted teams receive investment**… Participants that do not receive investment will not be required to give up equity."*
- Requires a **pitch deck (PDF/PPTX)** + a **3-minute video pitch** + **three third-party-verifiable claims** with links.
- The deck is read by **"Minds Review"** — an AI reviewer. Their advice: *"Use **real text, not scanned images** of slides"*, *"**YouTube unlisted gives the best AI evaluation**"*.
- The strongest signal by their own account: *"link to any Skills or Tools you've published on the Bazaar — **showing you've already started is the strongest signal we see**"*.
- Shortlisting within **2–4 weeks**, then a **30-minute** call. *"No mass rejections."*
- Explicitly **not crypto-gated**: *"You do not need to build anything related to crypto or Web3."*

> 🎯 **The Fugugent opportunity:** an on-chain revenue share that actually works, is transparent, and is verifiable is the sharpest differentiator versus HelloMinds — and it is very natural on BNB Chain.

### 5.5 Reviews / reputation — ⚠️ **DOES NOT EXIST YET**

There is no rating, review, or reputation. What exists:
- **A binary trust label:** `Official` (team-reviewed) versus `Wild` (community, not reviewed). But **100% of the current catalogue is Official/Featured** — the `Wild` label is documented but unused.
- **`equippedCount`** as the only popularity proxy.
- A **leaderboard** is mentioned in `llms.txt` (*"A Leaderboard surfaces the most-equipped items"*) — but there is no `/leaderboard` route in the sitemap.

### 5.6 Sandbox / testing — ⚠️ **DOES NOT EXIST at the platform level**

There is no dry-run, preview, or sandbox as a platform feature. Every equip/execution is live and burns real credits; the only mitigation is a text warning before the action.

**An important exception:** one agent — **Superior Trader** — brings its own sandbox at the domain level: *"**backtests them before a dollar is at risk**, deploys them live **or on paper** across crypto and on-chain spot markets."* So the pattern exists, but it is **built into one agent rather than provided by the platform**. For Fugugent, making dry-run a **platform primitive** (available to every agent) is an obvious improvement.

### 5.6b The crypto / DeFi surface (directly relevant to Fugugent)

Out of 119 Apps, only **5 touch Web3** — their crypto surface is very shallow:

| App | Function |
|---|---|
| Superior Trade | Monitor positions, analyse markets, manage trades |
| Polymarket | Search markets, pull prediction market data |
| Pieverse | Query and interact with on-chain assets |
| Laguna Network | Query and execute on-chain operations |
| (Nansen / Dune / CoinGlass) | Icons present in the bundle, on-chain data |

**The Superior Trader Mind** (the only trading agent, `archetype: superiortrader`):
- Supported chains: **Hyperliquid** and **Aerodrome** — i.e. **not BNB Chain**.
- Its `useCases` are the best example of the numbered past-tense pattern applied to a DeFi context:
  > "Backtested strategy across 3 months of market data"
  > "Deployed trading bot to paper trading environment"
  > "Detected risk conditions and halted execution"
  > "Improved strategy Sharpe ratio through optimization"

> 🎯 **The opportunity:** HelloMinds has a per-agent wallet and strong "agentic economy" rhetoric, but its actual on-chain capability is minimal (5 of 119 Apps) and does not touch BNB Chain at all. Fugugent can be **far deeper on-chain** while borrowing their already-mature product language.

### 5.7 The "Passive Autonomous Soul" Skill — an interesting guardrail pattern

One of the 29 Skills is **"Passive Autonomous Soul" — *"Complete tasks within scope and never act beyond it."*** That is: a behavioural guardrail packaged **as an equippable marketplace item**. An interesting pattern — a safety boundary as a product the user can choose.

---

## 6. Technical Architecture

### 6.1 The stack we detected

| Layer | Technology | Evidence |
|---|---|---|
| Product frontend | **Vite + React + i18next + Radix UI + Tailwind** | `assets/index-*.js`, `Uv()` cva, `__scopeToggleGroup` |
| Builder Hub | **Next.js (App Router)** | `_next/static/chunks/`, an RSC payload |
| Auth / DB | **Supabase** (+ **WebAuthn/passkeys**) | `RealtimeClient`, `supabase.auth.getUser()`, `pubKeyCredParams` |
| Tool integration | **Composio** | `logos.composio.dev`, `composio_managed_auth_schemes`, `api.hellominds.ai/v1/composio`, `/composio/callback` |
| Payments | **Stripe** | Checkout + top-up links |
| Analytics | GTM (server-side via **Stape**), GA4 | `GTM-WRMHX4XC`, `proxy.feed.hellominds.ai` |
| Browser automation | **Browserbase** | The LinkedIn Recruiter Skill |
| Search | **Tavily**, SerpAPI, Perplexity | The App list |
| On-chain data | Nansen, Dune, CoinGlass, Polymarket | The App list |

> 🔑 **The most important architectural finding:** their 119-App integration layer is **not their own** — it is **Composio**. The auth schemes in `toolkits.json` (`OAUTH2` ×102, `API_KEY` ×29, `S2S_OAUTH2` ×8, `GOOGLE_SERVICE_ACCOUNT`, `BASIC`, `OAUTH1`) are exactly the Composio taxonomy. **Fugugent can do the same** and get hundreds of integrations without building them one at a time.

### 6.2 The Builder API — full specification

**OpenAPI 3.0.3 · "Minds Builder API" v1.0.3 · Server: `https://api.build.hellominds.ai`**
(The consumer web app uses a separate base: `https://api.hellominds.ai`.)

**Auth:**
```jsonc
"BuilderApiKey": { "type": "apiKey", "in": "header", "name": "X-Api-Key" }
// X-Access-Key is DEPRECATED. Env var: MINDS_BUILDER_API_KEY
```

**21 paths / 27 operations.** Tags: Account, Cognition, Credits, Minds, Circles, Bazaar, Messaging, Events.
The Bazaar routes and `GET /v1/minds/check/name` are **public** (no key); everything else needs `X-Api-Key`.

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/v1/humans/{humanId}/minds` | Lists Minds; `humanId` has to match the JWT in the API key |
| GET | `/v1/minds/check/name` | **Public.** → `{ "isAvailable": true }` |
| POST | `/v1/minds/awaken` | `{ id, mindName }`. `id` = an enum of **20 archetypes** |
| GET | `/v1/minds/{mindId}` | Detail: email, wallet, chain, species, `isEnabled`, `model`, `hasTelegram` |
| PATCH | `/v1/minds/{mindId}` | Only `{ isEnabled: boolean }` in v1 |
| GET/PUT/DELETE | `/v1/minds/{mindId}/skills` | List / equip / unequip. Body `{ ids: [...] }` |
| GET/PUT/DELETE | `/v1/minds/{mindId}/apps` | Same |
| GET | `/v1/minds/{mindId}/cognition/usage` | `interval`: `1m\|5m\|15m\|1h\|1d\|1w\|1M` |
| GET | `/v1/minds/{mindId}/cognition/usage-by-tool` | `interval`: `hour\|day\|week\|month` (**a different enum!**) |
| GET | `/v1/minds/{mindId}/credits` | → `{ mindId, swarm: 219.65 }` |
| GET/POST/DELETE | `/v1/circles/{mindId}` | GET → a `CircleMember[]` directly |
| GET | `/v1/bazaar/skills`, `/skills/{id}` | **Public**, `search`/`page`/`pageSize` |
| GET | `/v1/bazaar/apps`, `/apps/{id}` | **Public**, + `tier=wild\|verified` |
| POST | `/v1/messaging/conversation` | `alias` pattern `^[a-z0-9_-]+$`, max 64 |
| GET | `/v1/messaging/conversations`, `/{alias}` | |
| GET | `/v1/messaging/histories/{alias}` | **The canonical one.** `limit` 1–200 (default 50), the `before` cursor is **exclusive**, **newest-first** |
| GET | `/v1/messaging/history/{alias}` | **DEPRECATED** — oldest-first, `after` is inclusive |
| POST | `/v1/messaging/message` | `{ alias, messageText, attachments? }`. **Do not send `conversationId`** |
| GET | `/v1/messaging/events?alias=` | **An SSE stream** — see §6.5 |

**Important data conventions:**
- `senderType` / `partyType`: **`0` = Mind, `1` = human**
- A Mind's email always ends in **`@hellominds.ai`**
- The balance is called **`swarm`** on the wire, but the CLI/SDK displays it as `cognition`
- The pagination cursor is the `fingerprint` of the last row
- Apps use `appId` + **`appName`** (not `name`); Skills use `skillId` + `name`

**The error envelope:**
```json
{ "error": { "type": "ValidationError", "subType": "InvalidAlias",
             "message": "alias must match ^[a-z0-9_-]+$" } }
```
Types: `ValidationError`, `Unauthorized`, `Forbidden`, `NotFound`, `BadGateway`.

**The enum of 20 Mind archetypes** (`POST /v1/minds/awaken`): `mastermind`, `generalassistant`, `sales`, `bizz`, `superiortrader`, `gamedesigner`, `emailmanager`, `scrummaster`, `fitnesscoach`, `personalchef`, `recruiter`, `football`, `decision`, `content`, `research`, `productbuilder`, `learningcoach`, `followup`, `gtm`, `chiefofstaff`.
(Note: `mastermind` exists in the API but **not** in the public `minds.json` catalogue of 19 — that is the Concierge/Master Mind.)

### 6.3 Developer tooling

| Artefact | Package | Version |
|---|---|---|
| CLI | `@animocabrands/minds-cli` | 0.1.4 |
| Client library | `@animocabrands/minds-client-lib` | 0.1.4 (Node, typed) |

**Documented CLI commands:** `minds mind awaken`, `minds mind check-name`, `circle add`, and history with `--cursor`.

**Client library functions:** `checkMindName()`, `awakenMind()`, `getHistory()` (newest-first).

**Auth:** the Builder API key is created in the console (with a **name and an expiry date**) and stored as the env var **`MINDS_BUILDER_API_KEY`**. **Shown only once.**

**Setup prerequisites:** at least 1 Mind + 1 Builder API key before you can use the Builder Tools.

**A clever bit of CLI positioning:** *"drive it from Cursor, Claude Code, or any coding agent, JSON stdout and examples in `--help` so your agent can list Minds, check cognition, and manage your account without you memorizing commands."* — the CLI is designed for a **coding agent** to use, not a human. A good pattern for 2026.

### 6.4 MCP — it exists, but it is undocumented

The accurate status: **MCP exists as a platform feature, but there is not a single piece of builder documentation for it.** The evidence:

1. The Investment Programme application form has a checkbox: **"Connected an MCP server to a Mind"** — so a user *can* connect an MCP server to a Mind.
2. The Builder Hub marketing page calls **`navigator.modelContext.provideContext()`** and registers browser tools: `openHome`, `openDocs`, `openInspirations`, `openProgram`, `openProgramApply`, `openFaq`, `openGuide`, `openInspiration`. This is browser-side MCP so an agent can navigate their site.
3. There is **no** MCP endpoint, server configuration, or guide anywhere in the docs/API reference.

Production tool integration runs through **Composio** and **`HTTP_Execute`** (see §6.5b), not MCP.

### 6.5 Events: **SSE, not webhooks**

There are no webhooks at all. The only push mechanism is **Server-Sent Events**:

```
GET /v1/messaging/events?alias=<alias>
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

From the spec (verbatim): *"Each authenticated connection subscribes to a **Redis channel scoped to the user**. A heartbeat comment (`: ping`) is sent every 30 seconds to keep the connection alive."*

- Initial confirmation: `: connected`
- Events: `data: <JSON>\n\n`
- Heartbeat: `: ping` every 30 seconds
- `?alias` filters to one conversation; with no alias you get all of the user's events
- Event payload: `fingerprint, conversationId, messageId, messageText, partyType, senderName, mindId, mindName, attachments[]`

The SDK offers two ways to consume it: `client.subscribeEvents({ onEvent, onError })` (callbacks) and `for await (const e of client.eventsIterator({ alias }))` (an async iterator), both accepting an `AbortSignal`.

> A `webhookId` field appears in the `custom` object on some Mind history rows, but it is **undocumented**.

### 6.5b `HTTP_Execute` — the universal connector

An important finding for integration strategy. From the builder FAQ:

> *"**`HTTP_Execute`** — which lets your Mind call **any public REST endpoint without a pre-built connector**. If a service has a public URL and a standard API, your Mind can reach it today."*

So their integration strategy has three layers: **(1)** curated Apps (Composio, 119), **(2)** `HTTP_Execute` as a universal escape hatch, **(3)** MCP (undocumented). The live integrations named explicitly: Telegram, Gmail, Google Calendar, Discord, Slack, GitHub, **Nansen**, **Dune**, Perplexity, Spotify, Strava.

### 6.5c The LLMs and infrastructure they use

- **Brain providers:** OpenAI, Google (Gemini), xAI (Grok) — and **Qwen** is mentioned in the data handling section.
- **Framework:** **LangChain** is listed as an infrastructure service.
- Automatic routing per kind of work: *"reasoning, coding, image analysis, fast response."*

### 6.6 The contents of the Builder Hub docs (official descriptions from `build.hellominds.ai/llms.txt`)

The entire builder documentation is only 5 pages. Their official descriptions:

| Page | Content (verbatim from llms.txt) |
|---|---|
| **Account setup** | *"Create a Mind and issue a Builder API key before using Builder Tools."* |
| **Minds CLI** | *"Install the Minds CLI and drive it from Cursor, Claude Code, or any coding agent, JSON stdout and examples in `--help` so your agent can list Minds, check cognition, and manage your account without you memorizing commands."* |
| **Minds Client Library** | *"Embed configured Minds in your application, typed Node client for messaging, events, and Builder API capabilities after you set up with the Minds CLI."* |
| **Skill Building Guide** | *"**Six steps** from describing a Skill in one message to publishing it on the Bazaar, connected to the apps your team already uses. **Linear is the example**, the same flow works for any app."* |
| **Navigate Circles** | *"**Three ways** to introduce a Mind — the Manage Circle dialog, an email CC, or a Telegram group. Plus how the trust gate works and why unknown senders are silently blocked."* |

> 📌 **The Bazaar publish flow is 6 steps, starting from "describing a Skill in one message"** — that is, authoring in natural language rather than hand-writing a JSON file. This matters: the Skill schema is a JSON playbook (§5.3), but **the authoring path is conversational**. An excellent pattern to copy — the builder describes, the system compiles.
>
> ⚠️ There is also a new UI discovery here: the **"Manage Circle dialog"** — so Circles can be managed through the UI, not only via email CC/Telegram as the consumer-facing documents say.

**The latest changelog (2026-08-25)** shows the direction of development:
- `minds mind check-name` / `awaken`
- History `--cursor` **newest-first** (before-cursor pagination)
- **`circle add` now accepts a human's email, not just a Mind** — Circles are growing from machine-to-machine into a human+agent mix.

### 6.7 The security model

- **Private key:** encrypted in the DB. The AI never sees it. To sign a transaction the AI **sends an execution request**; the backend decrypts and signs. (A good pattern — signing is separated from reasoning.)
- **Training data:** *"No user data is sent to or retained by these models for training purposes."*
- **Isolation between agents:** the Circle gate blocks a message **before** it enters the model's context.
- **Kill switch:** soft (natural language) + hard (the dashboard).
- **Confirmations:** high-impact actions require explicit confirmation.
- `/.well-known/security.txt` is available.

---

## 7. UI/UX Patterns — What to Copy versus What to Avoid

### 7.1 ✅ Worth copying

| # | Pattern | Detail |
|---|---|---|
| 1 | **Numbered past-tense `useCases`** | "Searched 38 roles", not "Can search roles". Evidence of outcomes, not feature promises. |
| 2 | **A signal bar for `level`** | Difficulty as 1–2–3 visual bars, not text. Readable in 200 ms. |
| 3 | **`iconInitials` + `iconTint`** | A coloured avatar fallback when there is no image — no card is ever blank. |
| 4 | **Persisted view mode + sort** | `localStorage` stores the grid/list and sort preference. |
| 5 | **Prescriptive empty states** | *"Try a different search term or clear the filters."* / *"Try clearing a filter or switching the format."* — always naming an **action**, not just "no results". |
| 6 | **Empty states that drive conversion** | *"Create your first Mind, then come back to equip it."* + a direct button. Not a dead end. |
| 7 | **A cost warning before execution** | *"This activates a real cycle and spends Cognition..."* + a time estimate ("within a minute") + an anti-duplicate guarantee. |
| 8 | **The credit balance shown in the agent-picker dialog** | The user sees each agent's balance **exactly when** choosing which one to equip. |
| 9 | **An escape hatch in onboarding** | *"In a rush? …You can calibrate its personality later."* |
| 10 | **A duration estimate in the wizard** | *"Takes 1–2 min."* |
| 11 | **The "You should see:" pattern in the docs** | Every docs step states the expected result → the user can self-verify. |
| 12 | **Explicit, honest permission warnings** | The Circle copy states outright that members can "consume Cognition without your prior approval". |
| 13 | **The agent reports its own balance** | Credit notifications come from the agent through a channel already in use, with a payment link. Not a dashboard banner. |
| 14 | **Pause-and-resume, not failure** | Out of credits → pause + notify + continue from where it stopped. |
| 15 | **A personality quiz as discovery** | Mindprint (16 types) turns "I don't know which agent I want" into a personal recommendation. |
| 16 | **Anthropomorphic agent state** | "stress, focus, trust" — in real time. A perfect fit for a fugu mascot (a fugu puffs up when stressed!). |
| 17 | **A 2-column grid on mobile** | `grid-cols-2 lg:grid-cols-3` — not 1 column; better density for browsing. |
| 18 | **A CLI designed for a coding agent** | JSON stdout + examples in `--help`. |
| 19 | ⭐ **"Markdown twins" for every docs page** | Every Builder Hub page is also available at `<path>.md` (e.g. `/en/docs/get-started/cli.md`). Plus per-page buttons: **Copy MD · View Markdown · Ask on Telegram · Builder console**. This makes the docs perfectly readable by an agent/LLM. Very cheap, very modern. |
| 20 | **A "Setup Effort" meter, not "difficulty"** | User-oriented framing: the user is not asking "how hard is this" but "how much work do I have to do". |
| 21 | **"Example Actions" as the label** | Better than "Features" or "Capabilities". |
| 22 | **Contextual risk banners** | `disclaimer: "Crypto Trading"` triggers an orange banner. The warning appears **only on the items that need it**, right at the decision point. |
| 23 | ⭐ **An "Inspect" step before publishing** | *"Show me what this Skill can do, what it reads, and what it can change. Flag anything it should not touch."* — a permission audit in plain language. |
| 24 | ⭐ **A budget guardrail as a primitive** | *"Never spend more than 500 Credits in a single session."* |
| 25 | **Brain Pulse: the agent explains its own failures** | Retry with different parameters, pivot, or explain — instead of crashing silently. |
| 26 | **A Circle canvas with a visual legend** | 🧠 blue = Mind online, 🧠 grey = offline, 🛡 orange = Steward (the owner), 👤 = human, dashed line = a connection. The canvas is **read-only**; all changes go through a dialog. It separates "looking" from "changing" cleanly. |
| 27 | **An honest status toggle** | *"Online Minds accept new tasks. Switch to Offline to pause without deleting."* — it explains the consequence, not just the label. |
| 28 | **"Nudge" with duplicate protection** | Wakes the agent manually, and tells you when a cycle is already queued: *"Nudge noted — already has a cognition running or queued."* |
| 29 | **Onboarding with video and text side by side** | *"watch, read, or both"* — every step has an embedded YouTube video AND written instructions. |
| 30 | **Concrete numbers in the case studies** | The Inspirations pages carry real metrics: "3,300 views → 106 clicks → 46 visits, $0.08/visit". Far more convincing than a testimonial. |
| 31 | **An honesty label on illustrative content** | The genealogy case study is explicitly marked: *"**Illustrative story** — written to describe the thought process behind the pattern, not a single named builder."* Cheap integrity that raises trust. |
| 32 | **A risk disclaimer on the trading demo** | *"Agentic trading is experimental… Past performance does not guarantee future results… should not be replicated without independent assessment."* Mandatory for Fugugent in DeFi. |

### 7.2 ❌ What NOT to copy

| # | Anti-pattern | Why |
|---|---|---|
| 1 | **Cards with no decision metrics** | With no rating, run count, success rate, latency, or cost — the user has no basis for choosing among 119 items. |
| 2 | **Filters limited to `All \| Official`** | 48 categories exist in the data but **are not used as filters**. Browsing 119 Apps is practically impossible. |
| 3 | **No per-action cost estimate** | *"complexity drives consumption"* + no numbers = cost anxiety. The user cannot estimate anything. |
| 4 | **Total creator anonymity** | No creator field → no reputation, no incentive to build a brand, no accountability. |
| 5 | **An unused `Wild` label** | A two-tier trust system is documented but 100% of the catalogue is `Official`. An unkept promise. |
| 6 | **Revenue share "coming soon"** | Advertised as a builder advantage with no mechanism behind it. It damages builder trust. |
| 7 | **A leaderboard that does not exist** | Mentioned in `llms.txt`, absent from the sitemap/routes. |
| 8 | **Wildly uneven category depth** | 11 of 19 Minds have just 1 App + 0 Skills. Breadth without depth. |
| 9 | **An equip flow via copy-pasted messages** | *"copy a generated activation message and paste it to your Mind"* — fragile, untraceable, fails silently. |
| 10 | **No sandbox / dry-run** | Every test burns real money. |
| 11 | **Email as the primary channel** | High latency, no rich UI, hard to display real-time data. Bad for a DeFi/trading use case. |
| 12 | **A landing page rendered 100% client-side** | No content in the initial HTML → bad for SEO and first paint. They patch over it with `llms.txt`. |
| 13 | **Only 5 pages of builder docs** | Very thin for a platform claiming a US$10M investment programme. |
| 14 | **No versioning/last-updated** | There is no way to know whether a Skill is still maintained. |
| 15 | **Far too many stacked concepts** | Mind/Soul/Brain/DNA/State/Skill/Tool/App/Artifact/Circle/Cognition/Concierge/Swarm/Steward/Tenet/Prior/Invariant/Guardrail/Episode/Swarm — **20 new terms** before the user does anything at all. |
| 16 | 🚨 **Account linking that cannot be undone** | *"Once linked, your Telegram account cannot be unlinked from this profile."* A permanent action with no way out is a serious UX failure. |
| 17 | 🚨 **Agent deletion is not self-serve** | *"Deletion isn't self-serve yet… get in touch with us."* The user cannot delete their own asset. Fatal for a product that sells a "sovereign asset". |
| 18 | **Tutorial filters compiled away** | The filter bar on `/tutorials` renders empty (`N2 = false`), yet the `?category=`/`?format=` URL params are still honoured. A half-finished control shipped to production. |
| 19 | **Hidden content** | `tutorials-manifest.json` contains 25 slugs; the page only shows **6** from a hardcoded allowlist. 19 tutorials cannot be found through navigation. |
| 20 | **An empty table in the FAQ** | The `faq-launch-options` component (the "Option \| Best for \| What happens" table) is called **with no data** — an empty/broken table on the live page. |
| 21 | **Stale docs that differ from the product** | `/docs` still refers to the `animocaminds.ai` domain, and `/docs/troubleshooting` contains no failure modes at all — just 5 marketing FAQs. |
| 22 | **A "Troubleshooting" page with no troubleshooting** | The title promises problem-solving; the content is five marketing questions. Misleading. |

---

### 7.3 ⭐⭐ The gap between what is MARKETED and what is SHIPPED

This is the most valuable finding of the whole research, and the harshest lesson for us. Their `llms.txt` / `llms-full.txt` / `agents.json` are far more ambitious than the product that actually runs. Verified by searching for the strings in the production bundle:

| Claimed in `llms-full.txt` / marketing | The reality in the shipped product |
|---|---|
| A **"Wild"** trust label (community, unreviewed) | ❌ **Zero occurrences** in the bundle. The real badges: Official / Featured / Verified / Composio / Third-Party |
| *"A **Leaderboard** surfaces the most-equipped items"* | ❌ **Zero occurrences.** No route, no UI |
| Equip = **copy an "activation message"** and paste it to the Mind | ⚠️ The strings exist in `locales/en/common.json` (`"Copy equip message"`, `Equip yourself with the skill "{{name}}" (ID: {{id}})`) but **are absent from the production bundle**. These are stale i18n keys; the live UI uses a direct Equip button |
| *"Your Mind asks for confirmation on **high-impact actions**… **undo actions**… review its **activity log**"* | ❌ The strings `high-impact`, `undo`, and activity log have **zero occurrences**. Not one of the three exists |
| A soft kill *"Quit emailing me"* + a *"**hard kill switch** in the dashboard"* | ⚠️ Neither is in the UI. What exists: an **Online/Offline** toggle (*"pause without deleting"*) |
| *"**No user data is sent to or retained** by these models for training"* | ⚠️ `/docs/security` actually says providers *"may retain data in accordance with their own privacy policies"* |
| *"over **1,000 skills** live and growing"* (the `/about` page) | ⚠️ The public `bazaar.json` catalogue contains **29 Skills** and 119 Apps |
| The Bazaar as a community marketplace | ⚠️ Badged **"EARLY BETA"**; 100% of the catalogue is Official/Featured |
| **State** = *"focus, trust, attention"* | ⚠️ `/docs/core-concepts` says *"**stress**, focus, trust"* |
| Domain | ⚠️ `/docs` still refers to **animocaminds.ai** and **profile.animocaminds.ai**; the rest of the site uses **hellominds.ai** — the docs are stale |
| A Mind's email | ⚠️ The docs say **`@amind.ai`**; the API spec says **`@hellominds.ai`** |
| The CLI *"targeting a **June 2026** release"* (programme FAQ) | ⚠️ The changelog shows the CLI shipped on **2026-06-09** and was already at 0.1.4 by August. The FAQ is stale |
| LLM providers | ⚠️ Three different lists on three pages: the docs (OpenAI/Google/xAI), the FAQ (+ **Qwen**), `llms.txt` (generic) |

**Lessons for Fugugent (and these bear directly on the judging):**

1. **Never document a feature you have not shipped.** Hackathon judges will click. A promised leaderboard that does not exist is a dead end — exactly what the Functionality criterion measures.
2. **One source of truth.** They have four surfaces (docs, FAQ, llms.txt, the app) that contradict each other on basic facts. For the demo, make sure the landing page, docs, and app state the **same** numbers.
3. **Do not display numbers you cannot prove.** *"Over 1,000 skills"* when the catalogue holds 29 is a credibility risk. We display real counts, read straight from the data.
4. **Delete dead i18n keys.** Their stale equip strings leak an older product flow.

## 8. Lessons for Fugugent

Mapped onto the three judging criteria: **[F]** Functionality (the land→find→understand→activate journey with no dead ends), **[D]** Data Quality (accurate real-time data for deciding which agent to hire), **[A]** Agent Diversity (4 categories of equal depth).

### Must adopt (copy directly)

1. **[F] A 2/3-column marketplace grid with search + sort + a persisted view toggle.**
   Copy `grid-cols-2 lg:grid-cols-3` and store `viewMode`/`sort` in `localStorage`. Cheap, and it immediately feels mature.

2. **[F][D] Numbered past-tense `useCases` on every fugu card.**
   Not "Can monitor token prices" but **"Monitored 12 pairs on PancakeSwap, fired 3 alerts this week."** This is the single copywriting change with the biggest demo impact.

3. **[F] Empty states that are always prescriptive and never a dead end.**
   Every empty state has to name an action and provide the button for it: *"No agents yet — create one, then come back to hire."* The judges explicitly test for "no dead ends".

4. **[F] A cost warning + time estimate before execution.**
   Copy this: *"This runs a real cycle and spends X FUGU. The agent usually starts within ~1 minute. If a cycle is already running, this request does not add another to the queue."*

5. **[F] The agent's balance shown in the agent-picker dialog.**
   When the user picks which agent will equip a skill, show each agent's balance on the same row.

6. **[F] An escape hatch + a duration estimate in onboarding.**
   *"In a rush? Skip it — you can set the personality later."* + *"Takes 1–2 minutes."*

7. **[F] Visual idempotency: mark already-hired items with a `Hired` badge.**
   Stop the user paying twice for the same thing, and show the status clearly.

8. **[F][D] Pause-and-resume when the balance runs out, not a silent failure.**
   The agent has to notify *itself* through the user's channel, with a top-up link, and resume from where it stopped.

9. **[A] `level` as a visual signal bar (1–2–3 bars).**
   Difficulty/complexity readable instantly without reading text.

10. **[F] A coloured avatar fallback (`iconInitials` + `iconTint`).**
    For Fugugent this becomes a **fugu variant**: every agent gets a fugu with a different colour/expression, generated deterministically from its ID. No card is ever blank, and the visual identity is free.

### Must surpass (this is where we win)

11. **[D] ⭐ Agent cards must carry the real-time decision metrics HelloMinds lacks.**
    At minimum, per card: **success rate (7 days)**, **run count**, **median latency**, **average cost per run**, **last active**, **number of active hirers**. All on-chain-verifiable. This attacks their biggest gap and the Data Quality criterion head-on.

12. **[D] ⭐ A cost estimate *before* hiring, not just a warning.**
    Show "≈0.4 BNB per 100 runs, based on the last 1,284 runs". HelloMinds only says *"complexity drives consumption"* — which cannot be acted on.

13. **[D] ⭐ Real creator reputation with an on-chain identity.**
    A `creator` field with a wallet address, the number of agents published, total runs served, and an aggregate rating. HelloMinds is 100% anonymous.

14. **[D] An on-chain revenue share that actually works, not "coming soon".**
    An automatic split through a smart contract on BNB Chain, with payouts visible in the explorer. This is the promise HelloMinds failed to keep — and the strongest reason to use a blockchain.

15. **[D] Verified ratings + reviews, gated by proof of use.**
    Only wallets that have actually hired the agent (provably, on-chain) can leave a review. This is anti-sybil rating, only possible in Web3.

16. **[F][D] A free sandbox / dry-run before hiring.**
    "Try this agent once, free" or a simulation against sample data. HelloMinds has none at all; every test burns money.

17. **[A] ⭐ Category filters that actually work — their biggest navigation weakness.**
    HelloMinds has 48 categories in the data but only shows an `All | Official` filter. We need first-class category filters + multi-select + a "clear all" chip.

18. **[A] ⭐ Four categories with genuinely EQUAL depth.**
    HelloMinds fails here: 11 of 19 templates have only 1 App and 0 Skills. Our rule: **every category has at least N agents, and every agent has at least X tools + Y verified use cases.** Make a parity checklist and stick to it. The judges will check.

19. **[D] A leaderboard that actually exists.**
    They promise one in `llms.txt` but there is no route for it. We ship it: a leaderboard by runs, by revenue, by rating, with time ranges.

20. **[F] Agent details as a page with a URL, not just a modal.**
    The HelloMinds modal cannot be shared or bookmarked. An agent is an asset — it needs a canonical URL, an OG image (its fugu!), and to be shareable.

21. **[D] Versioning + "last updated" + a per-agent changelog.**
    Absent from HelloMinds. A cheap, strong trust signal.

22. **[F] One-transaction activation, not a copy-pasted message.**
    Their "copy the activation message and paste it to the agent" flow is fragile. Ours: connect wallet → click Hire → one signature → the agent is live. Traceable, atomic, and it cannot fail silently.

23. **[F] A real-time monitoring panel with a live execution log.**
    HelloMinds only has a static "activity log" behind a login. We show the currently running run, step by step, plus the tx hash. This hands the judges direct evidence for the Data Quality criterion.

24. **[A] Guardrails as selectable items (copy "Passive Autonomous Soul").**
    Offer limit presets: read-only, spend cap, contract allowlist. For a DeFi marketplace this is a requirement, not an extra.

25. **[F] Use Composio (or an equivalent) for the integration layer.**
    The HelloMinds 119-App catalogue is not their own work. We can get instant category depth the same way, then spend our engineering effort on the on-chain layer that actually differentiates us.

26. **[F] An SSR landing page with real content.**
    Their marketplace is 100% client-rendered and the cards are absent from the HTML. We SSR the discovery pages — faster, indexable, and better when demoed over a bad connection.

29. **[F] One positioning sentence as sharp as theirs.**
    The benchmark: *"You're not asking a Mind for an answer, you're giving it a job."* Fugugent needs one equivalent sentence that explains "why an agent marketplace" in a single read, placed above the fold.

30. **[F] A retention loop: a daily quest + a daily refill.**
    HelloMinds pairs *"clear a daily quest"* with a daily auto top-up for agents under 100 credits. Cheap to build, a great fit for a crypto audience, and it gives the judges something alive to look at during the demo.

31. **[F] Match their *level of friction*, do not copy their anti-Web3 stance.**
    They win with *"No wallets, no code, no barriers — you're live in seconds."* We are on BNB Chain, so the answer is an embedded/smart wallet plus a gasless first action, so a user can reach "first agent live" without ever seeing a seed phrase.

32. **[F] Provide a "markdown twin" for every docs page + a Copy MD button.**
    Their best pattern, and the cheapest to copy. The judges (and agents) can read our docs perfectly.

33. **[D] A budget guardrail enforced by a smart contract, not merely an instruction.**
    HelloMinds promises *"Never spend more than 500 Credits in a single session"* as an instruction the model complies with. On BNB Chain we can **guarantee** it with an on-chain allowance. This is the most convincing "why blockchain" argument there is for an agent that holds money.

34. **[F] A permission audit shown to the BUYER, not just the publisher.**
    Their "Inspect" step is only seen by the Skill's creator. We show "this agent can read X, can change Y, can spend at most Z" on the **agent detail page**, before hiring.

35. **[F] Every action must be reversible.**
    Permanent Telegram linking and non-self-serve agent deletion are the two most obvious failures in their product. Every action in Fugugent must be undoable by the user themselves.

36. **[F] Never ship a half-finished control.**
    A tutorial filter compiled to nothing, an FAQ table with no data, a promised leaderboard with no route. Better to remove the element than to show it broken — the judges test for dead ends.

37. **[D] Put real numbers in every case study/demo.**
    "3,300 views → 106 clicks → 46 visits, $0.08 per visit" is far more convincing than a qualitative claim. For us: real runs, real tx hashes, real costs.

38. **[F] Honesty labels + risk disclaimers.**
    Mark illustrative content as illustrative, and put an explicit disclaimer on anything that touches trading. This builds trust rather than reducing it.

### Product identity notes (the fugu)

27. The HelloMinds **State ("stress, focus, trust")** concept is a gift to a fugu mascot: **a fugu puffs up when stressed.** Visualise the agent's workload/risk as how puffed up the fugu is. It turns an abstract metric into instant emotional feedback — something HelloMinds, with its flat corporate visual language, cannot do.

28. Avoid stacking up 13 new terms the way they do. Fugugent should have at most **4–5 core terms**. Everything else in plain language.

---

## 9. Comparison Summary

| Dimension | HelloMinds | The Fugugent target |
|---|---|---|
| Unit sold | Cognition Credits (fuel) | Per-agent hire + revenue share |
| Agent price | Free to equip | Transparent, on-chain, per run |
| Card metrics | `equippedCount`, `level`, `tag` | + success rate, latency, cost, runs, creator, rating |
| Trust | Binary Official/Wild (Wild unused) | On-chain reputation + reviews gated by proof |
| Creator | Anonymous | A wallet identity + public earnings |
| Revenue share | ❌ "coming soon" | ✅ A smart contract, verifiable |
| Filters | `All \| Official` | Multi-select categories + price range + performance |
| Channel | Email + Telegram | A real-time web app + a wallet |
| Sandbox | ❌ | ✅ A free dry-run |
| Agent detail | A modal (no URL) | A canonical page + OG sharing |
| Category depth | Uneven (11/19 shallow) | Enforced parity across the 4 categories |
| Integrations | Composio (119 apps) | Composio + BNB Chain adapters |
| Builder docs | 5 pages | Deeper |

---

## 10. Source URL List

**Product:**
- https://www.hellominds.ai/
- https://www.hellominds.ai/sitemap.xml
- https://www.hellominds.ai/robots.txt
- https://www.hellominds.ai/llms.txt
- https://www.hellominds.ai/llms-full.txt
- https://www.hellominds.ai/.well-known/agents.json
- https://www.hellominds.ai/data/bazaar.json
- https://www.hellominds.ai/data/minds.json
- https://www.hellominds.ai/data/toolkits.json
- https://www.hellominds.ai/assets/index-nE9hYUns.js
- https://www.hellominds.ai/bazaar (+ `/minds`, `/apps`, `/skills`)
- https://www.hellominds.ai/pricing
- https://www.hellominds.ai/docs/overview (+ core-concepts, getting-started, guides, security, troubleshooting)
- https://www.hellominds.ai/tutorials
- https://www.hellominds.ai/faq
- https://www.hellominds.ai/quiz/mindprint
- https://www.hellominds.ai/campaign/free-credits, /campaign/moca, /campaign/burn-sp

**Builder Hub:**
- https://build.hellominds.ai/sitemap.xml
- https://build.hellominds.ai/llms.txt
- https://build.hellominds.ai/robots.txt
- https://build.hellominds.ai/en/docs/get-started/account-setup
- https://build.hellominds.ai/en/docs/get-started/cli
- https://build.hellominds.ai/en/docs/get-started/client-library
- https://build.hellominds.ai/en/docs/guides/building-skills
- https://build.hellominds.ai/en/docs/guides/circles
- https://build.hellominds.ai/docs/api
- https://build.hellominds.ai/en/changelog
- https://build.hellominds.ai/en/program (+ /faq, /apply, /build-east)
- https://build.hellominds.ai/en/inspirations (+ etsy-shop-strategist, superior-trade-intern, architect-of-ancestry)

**Failed / restricted:**
- `https://build.hellominds.ai/llms-full.txt` → **404**
- `https://app.hellominds.ai/onboarding` → **needs a login**
- `https://www.hellominds.ai/profile` → **needs a login** (disallowed in robots.txt)
