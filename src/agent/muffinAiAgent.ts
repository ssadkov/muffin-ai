import { askLocalQVAC } from '../services/qvacService';
import {
  getLatestBalances,
  getActiveGoals,
  getRatesMap,
  getSetting,
  normalizeCurrency,
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';
import {
  commandToToolCall,
  findMatchingAccount,
  isPotentialCommand,
  parseFinanceCommand,
  ParsedCommand,
} from './commandParser';

export type AgentResponse = {
  message: string;
  actions?: AgentAction[];
};

export type AgentAction = {
  type: string;
  label: string;
  metadata?: Record<string, unknown>;
};

function buildContextString(): string {
  const accounts = getLatestBalances();
  const goals = getActiveGoals();
  const rules = checkMoneyRules();
  const rates = getRatesMap();

  let context = 'LOCAL FINANCIAL MEMORY\n\n';
  
  context += 'Goals:\n';
  goals.forEach(g => context += `- ${g.title}: $${g.target_value} (Base Currency: ${g.currency || 'USD'})\n`);

  context += '\nAccounts:\n';
  let total = 0;
  accounts.forEach(a => {
    // Include account ID and currency to help the LLM match them correctly
    context += `- ${a.name} (ID: ${a.id}, owner: ${a.owner_type || 'personal'}): ${a.amount} ${a.currency || 'USD'} (USD: $${a.usd_value})\n`;
    total += a.usd_value;
  });

  context += '\nExchange Rates (against USD):\n';
  Object.keys(rates).forEach(currency => {
    if (currency === 'USD') return;
    const val = rates[currency];
    if (val > 0) {
      context += `- 1 ${currency} = $${val.toFixed(val > 1 ? 2 : 6)}\n`;
    }
  });

  context += '\nRules Warnings:\n';
  rules.forEach(r => context += `* ${r.message}\n`);

  context += `\nComputed:\n- Total liquid assets: $${total}\n`;

  return context;
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMoney(value: number, currency?: string | null): string {
  const amount = Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${amount} ${currency || 'USD'}`;
}

function totalUsd(accounts: ReturnType<typeof getLatestBalances>): number {
  return accounts.reduce((sum, account) => sum + Number(account.usd_value || 0), 0);
}

function isBalanceReadQuestion(text: string): boolean {
  return (
    text.includes('сколько') ||
    text.includes('баланс') ||
    text.includes('остаток') ||
    text.includes('скока') ||
    text.includes('balance') ||
    text.includes('how much') ||
    text.includes('what is on') ||
    text.includes('whats on') ||
    text.includes('what\'s on')
  );
}

function isAccountOnlyReadQuestion(text: string): boolean {
  const withoutQuestionWords = text
    .replace(/^(а|and)\s+/, '')
    .replace(/^(на|in|on)\s+/, '')
    .trim();
  return withoutQuestionWords.length > 0 && withoutQuestionWords.length <= 40 && !/\d/.test(withoutQuestionWords);
}

function isOverviewQuestion(text: string): boolean {
  return (
    text.includes('сколько у меня') ||
    text.includes('сколько всего') ||
    text.includes('всего денег') ||
    text.includes('общий баланс') ||
    text.includes('итого') ||
    text.includes('финансовое положение') ||
    text.includes('текущее положение') ||
    text.includes('все балансы') ||
    text.includes('по всем счетам') ||
    text.includes('где деньги') ||
    text.includes('how much do i have') ||
    text.includes('how much total') ||
    text.includes('total balance') ||
    text.includes('total assets') ||
    text.includes('financial status') ||
    text.includes('financial situation') ||
    text.includes('all balances')
  );
}

function isLargestBalanceQuestion(text: string): boolean {
  return (
    text.includes('где больше всего') ||
    text.includes('больше всего денег') ||
    text.includes('самый большой баланс') ||
    text.includes('самый крупный') ||
    text.includes('крупнее всего') ||
    text.includes('максимум денег') ||
    text.includes('на каком счете больше') ||
    text.includes('на каком счету больше') ||
    text.includes('largest balance') ||
    text.includes('biggest balance') ||
    text.includes('most money') ||
    text.includes('highest balance')
  );
}

function isGoalRemainingQuestion(text: string): boolean {
  return (
    (text.includes('осталось') || text.includes('сколько еще') || text.includes('left')) &&
    (text.includes('цели') || text.includes('цель') || text.includes('goal'))
  );
}

function getLargestAccount(accounts: ReturnType<typeof getLatestBalances>): any | null {
  if (accounts.length === 0) return null;
  return accounts.reduce((best, account) => {
    return Number(account.usd_value || 0) > Number(best.usd_value || 0) ? account : best;
  }, accounts[0]);
}

function buildLargestBalanceAnswer(accounts: ReturnType<typeof getLatestBalances>, isRussian: boolean): string {
  const account = getLargestAccount(accounts);
  if (!account) {
    return isRussian ? 'Счетов пока нет.' : 'There are no accounts yet.';
  }

  const nativeBalance = formatMoney(account.amount || 0, account.currency || 'USD');
  const usdValue = Number(account.usd_value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const needsUsdEquivalent = (account.currency || 'USD').toUpperCase() !== 'USD';

  if (isRussian) {
    return needsUsdEquivalent
      ? `Больше всего сейчас на ${account.name}: ${nativeBalance} (примерно $${usdValue}).`
      : `Больше всего сейчас на ${account.name}: ${nativeBalance}.`;
  }

  return needsUsdEquivalent
    ? `The largest balance is in ${account.name}: ${nativeBalance} (about $${usdValue}).`
    : `The largest balance is in ${account.name}: ${nativeBalance}.`;
}

function buildOverviewAnswer(accounts: ReturnType<typeof getLatestBalances>, isRussian: boolean): string {
  const lines = accounts.map((account) => {
    const nativeBalance = formatMoney(account.amount || 0, account.currency || 'USD');
    const usdSuffix = (account.currency || 'USD').toUpperCase() === 'USD'
      ? ''
      : ` (≈ $${Number(account.usd_value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
    return `- ${account.name}: ${nativeBalance}${usdSuffix}`;
  });

  const total = totalUsd(accounts).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return isRussian
    ? `Сейчас по счетам:\n${lines.join('\n')}\n\nИтого в USD-эквиваленте: $${total}.`
    : `Current balances:\n${lines.join('\n')}\n\nTotal USD equivalent: $${total}.`;
}

function buildAccountBalanceAnswer(account: any, isRussian: boolean): string {
  const nativeBalance = formatMoney(account.amount || 0, account.currency || 'USD');
  const usdValue = Number(account.usd_value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const needsUsdEquivalent = (account.currency || 'USD').toUpperCase() !== 'USD';

  if (isRussian) {
    return needsUsdEquivalent
      ? `На ${account.name}: ${nativeBalance} (примерно $${usdValue}).`
      : `На ${account.name}: ${nativeBalance}.`;
  }

  return needsUsdEquivalent
    ? `${account.name}: ${nativeBalance} (about $${usdValue}).`
    : `${account.name}: ${nativeBalance}.`;
}

function buildGoalRemainingAnswer(accounts: ReturnType<typeof getLatestBalances>, isRussian: boolean): string | null {
  const goal = getActiveGoals()[0];
  if (!goal) {
    return isRussian ? 'Активной цели пока нет.' : 'There is no active goal yet.';
  }

  const total = totalUsd(accounts);
  const target = Number(goal.target_value || 0);
  const remaining = Math.max(0, target - total);
  const totalText = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const remainingText = remaining.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return isRussian
    ? `До цели осталось примерно $${remainingText}. Сейчас есть $${totalText} из $${target.toLocaleString()}.`
    : `About $${remainingText} remains. Current total is $${totalText} of $${target.toLocaleString()}.`;
}

function answerSimpleReadQuestion(question: string, accounts: ReturnType<typeof getLatestBalances>, isRussian: boolean): string | null {
  const text = normalizeQuestion(question);

  if (isGoalRemainingQuestion(text)) {
    return buildGoalRemainingAnswer(accounts, isRussian);
  }

  if (isLargestBalanceQuestion(text)) {
    return buildLargestBalanceAnswer(accounts, isRussian);
  }

  if (isOverviewQuestion(text)) {
    return buildOverviewAnswer(accounts, isRussian);
  }

  const accountMatch = findMatchingAccount(text, accounts);
  if (
    accountMatch.account &&
    accountMatch.confidence >= 0.78 &&
    (isBalanceReadQuestion(text) || isAccountOnlyReadQuestion(text))
  ) {
    return buildAccountBalanceAnswer(accountMatch.account, isRussian);
  }

  return null;
}

const COMMAND_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['none', 'btc_price', 'update_balance', 'update_goal'],
    },
    accountId: { type: 'string' },
    amount: { type: 'number' },
    currency: { type: 'string' },
    type: {
      type: 'string',
      enum: ['add', 'subtract', 'set'],
    },
    targetValue: { type: 'number' },
    title: { type: 'string' },
  },
  required: ['action'],
};

function getAccountListString(accounts: ReturnType<typeof getLatestBalances>): string {
  return accounts
    .map((account) => `- ${account.name}: id=${account.id}, owner=${account.owner_type || 'personal'}, currency=${account.currency || 'USD'}`)
    .join('\n');
}

function parseJsonObject(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function structuredResultToCommand(data: any, accounts: ReturnType<typeof getLatestBalances>): ParsedCommand | null {
  if (!data || data.action === 'none') return null;

  if (data.action === 'btc_price') {
    return { action: 'btc_price', confidence: 0.8 };
  }

  if (data.action === 'update_goal') {
    const targetValue = Number(data.targetValue ?? data.amount);
    if (!Number.isFinite(targetValue) || targetValue <= 0) return null;
    return {
      action: 'update_goal',
      targetValue,
      title: typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : `Reach $${targetValue.toLocaleString()} in liquid assets`,
      currency: normalizeCurrency(data.currency || 'USD'),
      confidence: 0.76,
    };
  }

  if (data.action === 'update_balance') {
    const account = accounts.find((item) => item.id === data.accountId);
    const amount = Number(data.amount);
    const operation = data.type;
    if (!account || !Number.isFinite(amount) || amount < 0) return null;
    if (operation !== 'add' && operation !== 'subtract' && operation !== 'set') return null;
    return {
      action: 'update_balance',
      accountId: account.id,
      amount,
      currency: normalizeCurrency(data.currency || account.currency || 'USD'),
      type: operation,
      confidence: 0.76,
    };
  }

  return null;
}

async function askStructuredCommandFallback(
  question: string,
  accounts: ReturnType<typeof getLatestBalances>,
  modelType: 'qwen' | 'medpsy',
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<ParsedCommand | null> {
  const systemPrompt = `Classify a short personal-finance command.
Return JSON only. If the user is asking a normal question or details are missing, return {"action":"none"}.
Allowed actions:
- btc_price
- update_balance with accountId, amount, currency, type add|subtract|set
- update_goal with targetValue, title, currency

Rules:
- set means current balance/state.
- add means deposit/received/plus.
- subtract means spend/withdraw/minus.
- If the user says company/business/corporate, prefer owner=company accounts. If they do not, prefer owner=personal for ambiguous bank names like Kaspi or BCC.
- Use only account IDs from the account list.`;

  const recentTool = chatHistory
    ?.slice()
    .reverse()
    .map((item) => item.content.match(/"accountId"\s*:\s*"([^"]+)"/)?.[1])
    .find(Boolean);

  const userPrompt = `Accounts:
${getAccountListString(accounts)}

Recent accountId, if the user is correcting a previous amount: ${recentTool || 'none'}

User text:
${question}`;

  try {
    const response = await askLocalQVAC(systemPrompt, userPrompt, modelType, undefined, [], {
      generationParams: {
        temp: 0,
        top_p: 0.1,
        predict: 160,
        reasoning_budget: 0,
        json_schema: COMMAND_JSON_SCHEMA,
      },
    });
    return structuredResultToCommand(parseJsonObject(response.message), accounts);
  } catch (error) {
    console.warn('[MuffinAI] Structured command fallback failed:', error);
    return null;
  }
}

export async function askMuffinAi(
  question: string, 
  modelType: 'qwen' | 'medpsy' = 'qwen',
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ message: string }> {
  const accounts = getLatestBalances();
  const langSetting = getSetting('language', 'ru');
  const isRussian = langSetting === 'ru';

  const parsedCommand = parseFinanceCommand(question, accounts, chatHistory);
  if (parsedCommand) {
    console.log(`[MuffinAI] Deterministic command parsed: ${parsedCommand.action}`);
    return { message: commandToToolCall(parsedCommand) };
  }

  const simpleReadAnswer = answerSimpleReadQuestion(question, accounts, isRussian);
  if (simpleReadAnswer) {
    console.log('[MuffinAI] Deterministic read answer generated');
    return { message: simpleReadAnswer };
  }

  if (isPotentialCommand(question)) {
    const structuredCommand = await askStructuredCommandFallback(question, accounts, modelType, chatHistory);
    if (structuredCommand) {
      console.log(`[MuffinAI] Structured command fallback parsed: ${structuredCommand.action}`);
      return { message: commandToToolCall(structuredCommand) };
    }
  }

  const context = buildContextString();

  let instructions = '';
  if (isRussian) {
    instructions = `You are a private local financial assistant on iPhone. You MUST respond in Russian. Keep answers concise.
Tool calls allowed:
- [TOOL_CALL: BTC_PRICE] (для запроса цены BTC)
- [TOOL_CALL: UPDATE_BALANCE: {"accountId": "ACCOUNT_ID", "amount": NUMBER, "currency": "CURRENCY", "type": "add"|"subtract"|"set"}] (для изменения баланса)
- [TOOL_CALL: UPDATE_GOAL: {"targetValue": NUMBER, "title": "GOAL_TITLE", "currency": "USD"}] (для целей сбережений)

UPDATE_BALANCE Type Rules:
1. "type": "set" is DEFAULT для сообщения баланса/состояния счета (e.g. "на Bybit X", "баланс X", "теперь X", "установи X", "сделай X").
2. "type": "add" ONLY для пополнения/получения (e.g. "добавь X", "плюс X", "пришло X", "получил X", "пополнил X", "зачислили X").
3. "type": "subtract" ONLY для списания/траты (e.g. "потратил X", "минус X", "купил за X", "списал X", "оплатил X", "вывел X", "снял X").
4. CORRECTION RULE: Если пользователь вводит только число/коррекцию (e.g. "567", "нет, 567"), и предыдущим шагом был UPDATE_BALANCE, повторите UPDATE_BALANCE для того же счета с новым amount и "type": "set".

Выводите ТОЛЬКО TOOL_CALL, если уверены, без текста. Для обычных вопросов (e.g. "сколько осталось до цели?") отвечайте текстом.
CRITICAL: Не копируйте числа из примеров. Вычисляйте динамически по LOCAL FINANCIAL MEMORY. Остаток до цели = (Goal Target - Total Assets) рассчитывайте точно.

Examples (REFERENCE ONLY - DO NOT COPY NUMBERS):
- "хочу накопить 120000$" -> [TOOL_CALL: UPDATE_GOAL: {"targetValue": 120000, "title": "Reach $120,000 in liquid assets", "currency": "USD"}]
- "добавь 5000 тенге на Kaspi Gold" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 5000, "currency": "KZT", "type": "add"}]
- "я потратил 1500 рублей с Bybit Card" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 1500, "currency": "RUB", "type": "subtract"}]
- "у меня на Kaspi Gold теперь 1102420 KZT" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 1102420, "currency": "KZT", "type": "set"}]
- "567" (после UPDATE_BALANCE с amount 537) -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 567, "currency": "USD", "type": "set"}]
- "нет, 567" (после UPDATE_BALANCE с amount 537) -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 567, "currency": "USD", "type": "set"}]
- "In Kaspi Gold: 1102420 KZT" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 1102420, "currency": "KZT", "type": "set"}]
- "Сколько мне осталось до цели?" -> (Вычислите разницу и ответьте текстом)
- "Какое мое текущее финансовое положение?" -> (Перечислите текущие балансы текстом)
- "Bitcoin price?" -> [TOOL_CALL: BTC_PRICE]`;
  } else {
    instructions = `You are a private local financial assistant on iPhone. Keep answers concise.
Tool calls allowed:
- [TOOL_CALL: BTC_PRICE] (for BTC price queries)
- [TOOL_CALL: UPDATE_BALANCE: {"accountId": "ACCOUNT_ID", "amount": NUMBER, "currency": "CURRENCY", "type": "add"|"subtract"|"set"}] (for balance updates)
- [TOOL_CALL: UPDATE_GOAL: {"targetValue": NUMBER, "title": "GOAL_TITLE", "currency": "USD"}] (for savings goals)

UPDATE_BALANCE Type Rules:
1. "type": "set" is DEFAULT for reporting balance/account state (e.g. "on Bybit X", "my balance is X", "set balance to X", "make it X").
2. "type": "add" ONLY for depositing/receiving (e.g. "add X", "plus X", "received X", "topped up X").
3. "type": "subtract" ONLY for spending/withdrawing (e.g. "spent X", "minus X", "paid X", "bought X", "charged X").
4. CORRECTION RULE: If user provides only a number/correction (e.g. "567", "no, 567"), and the last turn was a balance tool call, repeat UPDATE_BALANCE for the same account with the new amount and "type": "set".

Only output the TOOL_CALL if sure, without any conversational text. For chat questions (e.g. "how much is left?"), reply in plain text.
CRITICAL: Never copy numbers from examples. Use LOCAL FINANCIAL MEMORY. Compute remaining goal as (Goal Target - Total Assets) accurately.

Examples (REFERENCE ONLY - DO NOT COPY NUMBERS):
- "хочу накопить 120000$" -> [TOOL_CALL: UPDATE_GOAL: {"targetValue": 120000, "title": "Reach $120,000 in liquid assets", "currency": "USD"}]
- "add 5000 KZT to Kaspi Gold" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 5000, "currency": "KZT", "type": "add"}]
- "I spent 1500 RUB from Bybit Card" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 1500, "currency": "RUB", "type": "subtract"}]
- "my Kaspi Gold balance is now 1102420 KZT" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 1102420, "currency": "KZT", "type": "set"}]
- "567" (after UPDATE_BALANCE with amount 537) -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 567, "currency": "USD", "type": "set"}]
- "no, 567" (after UPDATE_BALANCE with amount 537) -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 567, "currency": "USD", "type": "set"}]
- "In Kaspi Gold wallet: 1102420 KZT" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 1102420, "currency": "KZT", "type": "set"}]
- "How much is left until my goal?" -> (Calculate Goal Target - Total Assets and reply in plain text)
- "What is my current financial status?" -> (Summarize active balances in plain text)`;
  }

  const userPrompt = `${context}\n\nUSER QUESTION:\n${question}`;
  
  console.log(`Sending prompt to Edge AI (Model: ${modelType})...`);
  return await askLocalQVAC(instructions, userPrompt, modelType, onChunk, chatHistory);
}

export async function continueMuffinAi(
  originalQuestion: string, 
  systemMessage: string, 
  modelType: 'qwen' | 'medpsy' = 'qwen',
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ message: string }> {
  const context = buildContextString();
  const langSetting = getSetting('language', 'ru');
  const isRussian = langSetting === 'ru';

  const instructions = isRussian
    ? `Вы — локальный финансовый помощник на iPhone. Отвечайте на русском языке. Ответы должны быть краткими.`
    : `You are a private local AI on an iPhone. Keep answers concise.`;
  
  const userPrompt = `${context}\n\nUSER QUESTION:\n${originalQuestion}\n\n${systemMessage}`;
  
  console.log(`Continuing prompt to Edge AI (Model: ${modelType})...`);
  return await askLocalQVAC(instructions, userPrompt, modelType, onChunk, chatHistory);
}
