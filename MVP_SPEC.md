# Muffin AI — QVAC Mobile Finance Agent

## Project Context

We are building **Muffin AI**, a private mobile-first personal finance assistant for the **QVAC Hackathon I – Unleash Edge AI** (June 1 - June 21, 2026).

**Hackathon Context:**
The hackathon focuses on unleashing edge AI and meaningfully using QVAC models locally across devices (e.g., using "Psy models" for specialized tasks). Muffin AI embraces this by demonstrating local-first financial memory and edge AI reasoning, running the AI model locally on the user's PC (via LM Studio at `http://127.0.0.1:1234`) or iOS device.

Muffin AI is a local AI-powered finance app that helps a user understand where their money is without sending sensitive financial context to cloud AI providers.

The app should run as a mobile-first application. The first target is an **Expo / React Native** app that can be launched on a phone.

The core idea:

> Muffin AI is a private local financial memory on your phone. It stores accounts, balance snapshots, financial rules and goals in a local database. A QVAC-powered local agent can query this database, update public crypto wallet balances, process screenshots, and answer natural-language questions about the user’s money.

## Main Requirements

Build a mobile-first MVP with:

1. Expo / React Native app
2. Local SQLite database
3. QVAC integration as local AI agent layer
4. Local financial memory
5. Public crypto wallet readers
6. Read-only crypto exchange API integration placeholder
7. Screenshot import flow
8. Financial rules engine
9. Chat interface where the user can ask Muffin AI questions
10. Mobile-first UI

Important: the app should prioritize hackathon demo readiness over production perfection.

---

# Product Name

**Muffin AI**

Tagline:

> Private Money Memory

Alternative tagline:

> Local AI for your personal finances

Positioning:

> Muffin AI is a private mobile AI finance assistant powered by QVAC. It reads public crypto wallets, imports read-only exchange balances, parses bank screenshots, stores financial memory locally, and answers questions about your money without sending private context to the cloud.

---

# MVP Demo Story

The demo should show this flow:

1. User opens Muffin AI on a phone.

2. Home screen shows total liquid assets, progress toward a $100,000 goal, and account cards.

3. User taps **Update Wallets**.

4. App updates demo/public crypto wallet balances.

5. User taps **Sync Exchange**.

6. App imports a mock/read-only exchange balance.

7. User adds a bank screenshot.

8. App extracts or simulates extracted balance from the screenshot.

9. User asks in chat:

   > What is my current financial situation?

10. Muffin AI answers using local database data:

> You have $18,420 in liquid assets across 6 accounts. You are 18.4% toward your $100,000 goal. Your largest balance is OKX with $6,800. One rule needs attention: Bybit Card has $760, above your $500 crypto-card limit.

---

# Technical Stack

Use:

* Expo
* React Native
* TypeScript
* expo-sqlite
* expo-secure-store
* expo-image-picker
* expo-notifications
* @qvac/sdk
* Optional: zod
* Optional: react-native-url-polyfill
* Optional: ethers / aptos / solana web3 libraries later

Start simple. If QVAC SDK integration is difficult in Expo immediately, create a clear abstraction layer so we can mock the agent first and swap in QVAC later.

The code should be clean and easy to extend.

---

# Architecture

```txt
Muffin AI Mobile App
        |
        v
QVAC Local Agent
        |
        +--> Local SQLite financial memory
        |
        +--> SecureStore for API keys
        |
        +--> Public wallet readers
        |       +--> Aptos
        |       +--> Solana
        |
        +--> Exchange read-only APIs
        |       +--> OKX / Bybit placeholder
        |
        +--> Screenshot OCR / parser
        |
        +--> Money rules engine
        |
        +--> Deep links to finance apps
```

---

# Core Concepts

## Account

An account is any place where money can be located.

Examples:

* Kaspi Gold
* Bybit Card
* OKX Account
* Aptos Wallet
* Solana Wallet
* Cash USD
* Bank Deposit

## Balance Snapshot

A balance snapshot is a historical record of how much money was in an account at a specific time.

We do not need full transaction tracking in MVP.

## Financial Rule

A financial rule is a user-defined rule that Muffin AI checks.

Examples:

* Crypto cards should not hold more than $500.
* Balances should be updated at least weekly.
* Target liquid assets: $100,000.

## Agent Event

An agent event records what Muffin AI did.

Examples:

* Updated Aptos wallet
* Parsed screenshot
* Checked money rules
* Added balance snapshot

---

# Local Database Schema

Use SQLite.

Create a database service in:

```txt
src/db/database.ts
```

Create tables:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT,
  address TEXT,
  app_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  usd_value REAL,
  source TEXT NOT NULL,
  confidence REAL,
  raw_text TEXT,
  screenshot_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);
```

```sql
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  threshold_value REAL,
  threshold_currency TEXT,
  severity TEXT DEFAULT 'info',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_value REAL NOT NULL,
  currency TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS exchange_connections (
  id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key_ref TEXT,
  api_secret_ref TEXT,
  passphrase_ref TEXT,
  permissions TEXT DEFAULT 'read_only',
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

---

# Seed Data

Create a seed function:

```txt
src/db/seed.ts
```

It should insert demo accounts if the database is empty.

Seed accounts:

```txt
Aptos Wallet
type: crypto_wallet
source: aptos_public_wallet
currency: USD
address: demo_aptos_address

Solana Wallet
type: crypto_wallet
source: solana_public_wallet
currency: USD
address: demo_solana_address

OKX Account
type: exchange
source: exchange_readonly
currency: USD

Bybit Card
type: crypto_card
source: manual
currency: USD

Kaspi Gold
type: bank
source: screenshot
currency: KZT
app_url: kaspi://

Cash USD
type: cash
source: manual
currency: USD
```

Seed balance snapshots:

```txt
Aptos Wallet: $4,250
Solana Wallet: $1,130
OKX Account: $6,800
Bybit Card: $760
Kaspi Gold: $2,420
Cash USD: $3,060
```

Seed goal:

```txt
Reach $100,000 in liquid assets
target_value: 100000
currency: USD
```

Seed rules:

```txt
Crypto cards should not hold more than $500.
rule_type: crypto_card_max_balance
threshold_value: 500
threshold_currency: USD
severity: warning
```

```txt
Balances should be updated at least weekly.
rule_type: stale_balance_check
threshold_value: 7
threshold_currency: days
severity: info
```

---

# App Screens

Create a simple mobile-first UI.

Use this folder structure:

```txt
src/
  app/
  components/
  db/
  services/
  agent/
  tools/
  screens/
  utils/
```

If using Expo Router, structure can be:

```txt
app/
  index.tsx
  accounts.tsx
  chat.tsx
  sources.tsx
  settings.tsx
```

Or use React Navigation. Choose the simplest stable option.

## Screen 1: Home

Home should show:

* Muffin AI logo placeholder
* “Private Money Memory”
* Total liquid assets
* Progress toward $100,000 goal
* Rule warning count
* Quick action buttons

UI copy:

```txt
Muffin AI
Private Money Memory

Total liquid assets
$18,420

Goal
$100,000

Progress
18.4%

[Ask Muffin AI]
[Update Wallets]
[Sync Exchange]
[Add Screenshot]
[Check Rules]
```

## Screen 2: Accounts

Show list of accounts:

```txt
Aptos Wallet       $4,250   updated now
Solana Wallet      $1,130   updated now
OKX Account        $6,800   updated 5 min ago
Bybit Card         $760     warning
Kaspi Gold         $2,420   screenshot
Cash USD           $3,060   manual
```

Each account card should show:

* name
* type
* latest USD value
* source
* last updated
* warning badge if needed

## Screen 3: Chat

Chat interface where user asks Muffin AI questions.

Minimum working examples:

```txt
What accounts do I have?
```

```txt
How close am I to my $100k goal?
```

```txt
Check my money rules.
```

```txt
What is my current financial situation?
```

The chat should use the agent service.

If QVAC is not fully connected yet, use a mock agent with the same interface.

## Screen 4: Sources

Show connected sources:

```txt
Crypto wallets
✓ Aptos Wallet
✓ Solana Wallet

Exchanges
✓ OKX read-only demo
+ Connect Bybit
+ Connect Binance

Banks
+ Add screenshot
+ Open bank app
```

Include read-only API security copy:

```txt
Exchange integrations use read-only API keys only.
Muffin AI never asks for trading or withdrawal permissions.
API keys are stored locally on this device.
```

## Screen 5: Settings

Show:

* Local database status
* QVAC status
* Privacy statement
* Reset demo data button

Copy:

```txt
Privacy

Your financial memory is stored locally on this device.
Muffin AI is designed to work without sending sensitive financial context to cloud AI providers.
```

---

# Agent Layer

Create:

```txt
src/agent/muffinAiAgent.ts
```

The agent should expose:

```ts
export type AgentResponse = {
  message: string;
  actions?: AgentAction[];
};

export type AgentAction = {
  type: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export async function askMuffinAi(question: string): Promise<AgentResponse>;
```

For the first implementation, `askMuffinAi` can:

1. Load accounts from SQLite
2. Load latest balances
3. Load goals
4. Load rules
5. Build context
6. Send context + question to QVAC
7. Return answer

If QVAC integration is not working yet, implement a mock deterministic answer for demo questions.

Important: keep the interface the same so QVAC can be plugged in later.

---

# QVAC Integration

Create:

```txt
src/services/qvacService.ts
```

Goal:

```ts
export async function qvacChat(prompt: string): Promise<string>;
```

Implementation should try to use `@qvac/sdk`.

If SDK integration in Expo creates issues, temporarily return a mock response and add clear TODO comments.

Pseudo-code:

```ts
export async function qvacChat(prompt: string): Promise<string> {
  // TODO: initialize QVAC SDK local model here.
  // This service should become the only place where QVAC SDK is called.
  // For now, fallback to deterministic local demo response if QVAC is unavailable.
}
```

Add a feature flag:

```ts
const USE_QVAC = false;
```

When ready, set to true.

The prompt should include:

```txt
You are Muffin AI, a private local finance assistant.

You answer based only on the local financial data provided in the context.
You do not invent balances.
You are concise, helpful and privacy-first.
If a rule is violated, explain it clearly.
If data is stale, mention it.
```

---

# Agent Context Format

Build context like this:

```txt
LOCAL FINANCIAL MEMORY

Goal:
- Reach $100,000 in liquid assets.

Accounts:
- Aptos Wallet: $4,250, source: aptos_public_wallet, updated: 2026-06-08
- Solana Wallet: $1,130, source: solana_public_wallet, updated: 2026-06-08
- OKX Account: $6,800, source: exchange_readonly, updated: 2026-06-08
- Bybit Card: $760, source: manual, updated: 2026-06-08
- Kaspi Gold: $2,420, source: screenshot, updated: 2026-06-08
- Cash USD: $3,060, source: manual, updated: 2026-06-08

Rules:
- Crypto cards should not hold more than $500.
- Balances should be updated at least weekly.

Computed:
- Total liquid assets: $18,420
- Goal progress: 18.42%
- Rule warning: Bybit Card exceeds $500 by $260.
```

Then append user question.

---

# Tools Layer

Create tool-like services.

## Database Tools

```txt
src/tools/databaseTools.ts
```

Functions:

```ts
listAccounts()
getLatestBalances()
getTotalLiquidAssets()
getActiveGoals()
getActiveRules()
saveBalanceSnapshot()
logAgentEvent()
```

## Rules Tools

```txt
src/tools/rulesTools.ts
```

Functions:

```ts
checkMoneyRules()
checkCryptoCardLimit()
checkStaleAccounts()
```

Return:

```ts
export type RuleWarning = {
  ruleId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  accountId?: string;
};
```

## Crypto Wallet Tools

```txt
src/tools/cryptoWalletTools.ts
```

Functions:

```ts
updateAptosWallet(address: string)
updateSolanaWallet(address: string)
updateAllCryptoWallets()
```

For MVP, implement mock balances first.

Example:

```ts
export async function updateAptosWallet(address: string) {
  return {
    amount: 4250,
    currency: 'USD',
    raw: {
      APT: 123,
      USDC: 1250
    }
  };
}
```

Add TODOs for real integrations.

Later real integrations:

* Aptos fullnode / indexer
* Solana RPC
* EVM RPC

## Exchange Tools

```txt
src/tools/exchangeTools.ts
```

Functions:

```ts
syncOkxReadOnly()
syncBybitReadOnly()
syncAllExchanges()
```

For MVP, implement OKX as mock or read-only placeholder.

Return:

```ts
{
  exchange: 'OKX',
  totalUsdValue: 6800,
  assets: [
    { symbol: 'USDT', amount: 5000, usdValue: 5000 },
    { symbol: 'BTC', amount: 0.02, usdValue: 1800 }
  ]
}
```

Security requirement:

* Never request withdrawal permissions
* Never request trading permissions
* Store API secrets only in SecureStore
* Store only references or labels in SQLite

## Screenshot Tools

```txt
src/tools/screenshotTools.ts
```

Functions:

```ts
pickScreenshot()
parseBankScreenshot(imageUri: string)
saveScreenshotBalance(accountId, parsedBalance)
```

For MVP:

1. Use `expo-image-picker`
2. Let user select screenshot
3. Simulate OCR parser if QVAC vision/OCR is not ready
4. Return a demo parsed result

Example:

```ts
{
  accountName: 'Kaspi Gold',
  amount: 2420,
  currency: 'USD',
  originalCurrency: 'KZT',
  confidence: 0.82,
  rawText: 'Detected demo bank balance from screenshot'
}
```

Later:

* Use QVAC OCR / multimodal input to extract text
* Ask user to confirm before saving

---

# Deep Links

Create:

```txt
src/services/deepLinkService.ts
```

Functions:

```ts
openExternalApp(appUrl: string)
```

Example app URLs:

```txt
kaspi://
bybit://
okx://
phantom://
petra://
```

If app URL fails, show alert:

```txt
Could not open this app. Please open it manually.
```

Deep links are nice-to-have, not core.

---

# Privacy and Security Requirements

Show this in UI and keep in code comments:

1. Financial memory is stored locally.
2. Exchange API keys are read-only.
3. No withdrawal permissions.
4. No trading permissions.
5. API secrets should be stored in SecureStore, not plain SQLite.
6. Public crypto wallet data can be read automatically.
7. Bank data should be imported only from user-provided screenshots.
8. For the hackathon demo, mock data is acceptable as long as architecture is clear.

---

# Initial Implementation Plan

Please implement in this order.

## Step 1 — Create Expo App

Create or update project as Expo + TypeScript.

Install:

```bash
npm install expo-sqlite expo-secure-store expo-image-picker expo-notifications
npm install @qvac/sdk
npm install zod
```

If `@qvac/sdk` causes bundling issues, isolate it in `src/services/qvacService.ts` and use a mock fallback.

## Step 2 — Create SQLite Layer

Implement:

```txt
src/db/database.ts
src/db/schema.ts
src/db/seed.ts
src/db/queries.ts
```

The app should initialize DB on startup and seed demo data if empty.

## Step 3 — Create Home Screen

Show:

* total assets
* goal progress
* warnings
* quick actions

## Step 4 — Create Accounts Screen

Show all demo accounts and balances.

## Step 5 — Create Rules Engine

Implement crypto card max $500 warning.

Bybit Card with $760 should trigger warning:

```txt
Bybit Card exceeds your $500 crypto-card limit by $260.
```

## Step 6 — Create Chat Screen

Implement `askMuffinAi`.

First with mock deterministic answers.

Then connect QVAC through `qvacService`.

## Step 7 — Create Wallet Update Flow

Button:

```txt
Update Wallets
```

Should call mock wallet tools and save balance snapshots.

Log agent event.

## Step 8 — Create Exchange Sync Flow

Button:

```txt
Sync Exchange
```

Should call mock OKX read-only sync and save balance snapshot.

Log agent event.

## Step 9 — Create Screenshot Import Flow

Button:

```txt
Add Screenshot
```

Should open image picker, simulate parsed result, and save/update Kaspi Gold balance.

Log agent event.

## Step 10 — Polish for Demo

Add:

* nice mobile spacing
* simple mascot placeholder
* privacy copy
* loading states
* error states
* clear demo labels

---

# Recommended UI Style

Use a warm, friendly design.

Brand feel:

* Soft
* Private
* Calm
* Personal
* Not corporate banking

Colors:

* Cream / light background
* Brown / dark text
* Soft orange accent
* Green for positive financial status
* Red/orange for warnings

Do not overcomplicate styling.

Use simple React Native StyleSheet.

---

# Example Components

Create:

```txt
src/components/AccountCard.tsx
src/components/MetricCard.tsx
src/components/PrimaryButton.tsx
src/components/WarningCard.tsx
src/components/ChatBubble.tsx
src/components/ProgressBar.tsx
```

---

# Example TypeScript Types

Create:

```txt
src/types.ts
```

```ts
export type AccountType =
  | 'crypto_wallet'
  | 'exchange'
  | 'crypto_card'
  | 'bank'
  | 'cash'
  | 'deposit'
  | 'manual';

export type AccountSource =
  | 'aptos_public_wallet'
  | 'solana_public_wallet'
  | 'exchange_readonly'
  | 'screenshot'
  | 'manual';

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  source: AccountSource;
  currency?: string;
  address?: string;
  appUrl?: string;
  isActive: boolean;
  createdAt: string;
};

export type BalanceSnapshot = {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  usdValue?: number;
  source: string;
  confidence?: number;
  rawText?: string;
  screenshotPath?: string;
  createdAt: string;
};

export type Goal = {
  id: string;
  title: string;
  targetValue: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
};

export type Rule = {
  id: string;
  title: string;
  ruleText: string;
  ruleType: string;
  thresholdValue?: number;
  thresholdCurrency?: string;
  severity: 'info' | 'warning' | 'critical';
  isActive: boolean;
  createdAt: string;
};
```

---

# Expected Demo Data Calculations

Seed balances:

```txt
Aptos Wallet: $4,250
Solana Wallet: $1,130
OKX Account: $6,800
Bybit Card: $760
Kaspi Gold: $2,420
Cash USD: $3,060
```

Total:

```txt
$18,420
```

Goal:

```txt
$100,000
```

Progress:

```txt
18.42%
```

Rule warning:

```txt
Bybit Card exceeds $500 by $260.
```

---

# Chat Answer Examples

## Question

```txt
What is my current financial situation?
```

## Answer

```txt
You have $18,420 in liquid assets across 6 accounts.

Your largest balance is OKX Account with $6,800.
You are 18.4% toward your $100,000 goal.

One rule needs attention: Bybit Card has $760, which is $260 above your $500 crypto-card limit.
```

## Question

```txt
How close am I to my $100k goal?
```

## Answer

```txt
You are 18.4% toward your $100,000 liquid assets goal.

Current liquid assets: $18,420
Remaining: $81,580
```

## Question

```txt
Check my money rules.
```

## Answer

```txt
One warning found.

Bybit Card has $760. Your rule says crypto cards should hold no more than $500.
Suggested action: move $260 back to your main wallet or exchange account.
```

---

# Hackathon README Copy

Add this to project README:

```md
# Muffin AI

Muffin AI is a private mobile AI finance assistant powered by QVAC.

It helps users understand where their money is without sending sensitive financial data to cloud AI providers. Muffin AI stores account metadata, balance snapshots, money rules and financial goals in a local SQLite database. The QVAC-powered agent can query this local database, update public crypto wallet balances, import read-only exchange balances, parse bank app screenshots, and answer natural-language questions about the user’s financial position.

## Why QVAC

Personal finance data is extremely sensitive. Most AI finance assistants require users to send private financial context to cloud models. Muffin AI demonstrates a different approach: local-first financial memory and local AI reasoning on the user’s device.

## Features

- Mobile-first app
- Local SQLite financial memory
- QVAC-powered local finance agent
- Public crypto wallet balance readers
- Read-only crypto exchange integration
- Bank screenshot import
- Financial rules engine
- Goal tracking
- Privacy-first design

## Demo

The demo shows a user opening Muffin AI on a phone, updating crypto wallets, syncing a read-only exchange balance, importing a bank screenshot, and asking Muffin AI:

> What is my current financial situation?

Muffin AI answers from local data only, showing total liquid assets, progress toward a $100,000 goal, and warnings about financial rules.
```

---

# Definition of Done for MVP

The MVP is complete when:

1. App launches on mobile through Expo.
2. Local SQLite database initializes.
3. Demo data is seeded.
4. Home screen shows total assets and goal progress.
5. Accounts screen shows account list.
6. Chat screen answers at least 3 finance questions using local data.
7. Rule engine detects Bybit Card > $500.
8. Update Wallets button updates/saves mock crypto wallet balances.
9. Sync Exchange button updates/saves mock OKX balance.
10. Add Screenshot button opens image picker and saves a parsed/mock bank balance.
11. QVAC service abstraction exists.
12. App has privacy-first copy.
13. README explains QVAC/local-first value clearly.

---

# Important Implementation Notes

Prioritize working demo over production-grade integrations.

If something is hard:

* Mock the data
* Keep the architecture clean
* Add TODO comments
* Make the demo flow smooth

The most important thing is to prove:

> A mobile AI finance agent can use local financial memory and local/private AI reasoning to help a user understand their money.

Do not build full transaction tracking yet.

Do not build bank API integrations yet.

Do not request trading or withdrawal permissions from exchanges.

Do not store secrets in plain SQLite.

Do not overcomplicate the design.

---

# First Cursor Task

Start by creating the Expo app structure, SQLite schema, seed data, and Home screen.

Then implement the Accounts screen and the rules engine.

After that implement the Chat screen with a mock Muffin AI agent.

Finally add QVAC service abstraction and replace mock responses when QVAC is ready.
