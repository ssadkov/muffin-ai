type AccountLike = {
  id: string;
  name: string;
  currency?: string | null;
};

export type ParsedCommand =
  | { action: 'btc_price'; confidence: number }
  | {
      action: 'update_balance';
      accountId: string;
      amount: number;
      currency: string;
      type: 'add' | 'subtract' | 'set';
      confidence: number;
    }
  | {
      action: 'update_goal';
      targetValue: number;
      title: string;
      currency: string;
      confidence: number;
    };

const RU_CHARS = '\u0430-\u044f\u0451';

const OP_KEYWORDS = {
  add: [
    'add',
    'plus',
    'deposit',
    'received',
    'top up',
    'topped up',
    '\u0434\u043e\u0431\u0430\u0432',
    '\u043f\u043b\u044e\u0441',
    '\u043f\u043e\u043f\u043e\u043b\u043d',
    '\u043f\u0440\u0438\u0448\u043b',
    '\u043f\u043e\u043b\u0443\u0447',
    '\u0437\u0430\u0447\u0438\u0441\u043b',
  ],
  subtract: [
    'subtract',
    'spend',
    'spent',
    'minus',
    'pay',
    'paid',
    'withdraw',
    'withdrew',
    '\u0441\u043f\u0438\u0448',
    '\u0441\u043f\u0438\u0441',
    '\u043c\u0438\u043d\u0443\u0441',
    '\u043f\u043e\u0442\u0440\u0430\u0442',
    '\u043e\u043f\u043b\u0430\u0442',
    '\u0441\u043d\u044f\u043b',
    '\u0441\u043d\u044f\u0442',
    '\u0432\u044b\u0432\u0435\u043b',
    '\u043a\u0443\u043f\u0438\u043b',
  ],
  set: [
    'set',
    'balance',
    'now',
    'make it',
    '\u0443\u0441\u0442\u0430\u043d\u043e\u0432',
    '\u043f\u043e\u0441\u0442\u0430\u0432',
    '\u0441\u0434\u0435\u043b\u0430\u0439',
    '\u0431\u0430\u043b\u0430\u043d\u0441',
    '\u0442\u0435\u043f\u0435\u0440\u044c',
    '\u0441\u0435\u0439\u0447\u0430\u0441',
  ],
};

const GOAL_KEYWORDS = [
  'goal',
  'target',
  'save',
  '\u0446\u0435\u043b\u044c',
  '\u043d\u0430\u043a\u043e\u043f',
  '\u0445\u043e\u0447\u0443 \u043d\u0430\u043a\u043e\u043f',
  '\u0441\u0431\u0435\u0440\u0435\u0436',
];

const CURRENCY_PATTERNS: Array<[string, RegExp]> = [
  ['USD', /(?:\$|\busd\b|\busdt\b|\bdollars?\b|\bbucks?\b|\u0434\u043e\u043b\u043b\u0430\u0440|\u0431\u0430\u043a\u0441)/i],
  ['KZT', /(?:\bkzt\b|\u20b8|\u0442\u0435\u043d\u0433\u0435|\u0442\u0433\b)/i],
  ['RUB', /(?:\brub\b|\brur\b|\u20bd|\u0440\u0443\u0431|\u0440\u0443\u0431\u043b)/i],
  ['EUR', /(?:\beur\b|\u20ac|\u0435\u0432\u0440\u043e)/i],
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  hundreds: 100,
  thousand: 1000,
  thousands: 1000,
  '\u043d\u043e\u043b\u044c': 0,
  '\u043e\u0434\u0438\u043d': 1,
  '\u043e\u0434\u043d\u0430': 1,
  '\u043e\u0434\u043d\u043e': 1,
  '\u0434\u0432\u0430': 2,
  '\u0434\u0432\u0435': 2,
  '\u0442\u0440\u0438': 3,
  '\u0447\u0435\u0442\u044b\u0440\u0435': 4,
  '\u043f\u044f\u0442\u044c': 5,
  '\u0448\u0435\u0441\u0442\u044c': 6,
  '\u0441\u0435\u043c\u044c': 7,
  '\u0432\u043e\u0441\u0435\u043c\u044c': 8,
  '\u0434\u0435\u0432\u044f\u0442\u044c': 9,
  '\u0434\u0435\u0441\u044f\u0442\u044c': 10,
  '\u043e\u0434\u0438\u043d\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 11,
  '\u0434\u0432\u0435\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 12,
  '\u0442\u0440\u0438\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 13,
  '\u0447\u0435\u0442\u044b\u0440\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 14,
  '\u043f\u044f\u0442\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 15,
  '\u0448\u0435\u0441\u0442\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 16,
  '\u0441\u0435\u043c\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 17,
  '\u0432\u043e\u0441\u0435\u043c\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 18,
  '\u0434\u0435\u0432\u044f\u0442\u043d\u0430\u0434\u0446\u0430\u0442\u044c': 19,
  '\u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044c': 20,
  '\u0442\u0440\u0438\u0434\u0446\u0430\u0442\u044c': 30,
  '\u0441\u043e\u0440\u043e\u043a': 40,
  '\u043f\u044f\u0442\u044c\u0434\u0435\u0441\u044f\u0442': 50,
  '\u0448\u0435\u0441\u0442\u044c\u0434\u0435\u0441\u044f\u0442': 60,
  '\u0441\u0435\u043c\u044c\u0434\u0435\u0441\u044f\u0442': 70,
  '\u0432\u043e\u0441\u0435\u043c\u044c\u0434\u0435\u0441\u044f\u0442': 80,
  '\u0434\u0435\u0432\u044f\u043d\u043e\u0441\u0442\u043e': 90,
  '\u0441\u0442\u043e': 100,
  '\u0434\u0432\u0435\u0441\u0442\u0438': 200,
  '\u0442\u0440\u0438\u0441\u0442\u0430': 300,
  '\u0447\u0435\u0442\u044b\u0440\u0435\u0441\u0442\u0430': 400,
  '\u043f\u044f\u0442\u044c\u0441\u043e\u0442': 500,
  '\u0448\u0435\u0441\u0442\u044c\u0441\u043e\u0442': 600,
  '\u0441\u0435\u043c\u044c\u0441\u043e\u0442': 700,
  '\u0432\u043e\u0441\u0435\u043c\u044c\u0441\u043e\u0442': 800,
  '\u0434\u0435\u0432\u044f\u0442\u044c\u0441\u043e\u0442': 900,
  '\u0442\u044b\u0441\u044f\u0447\u0430': 1000,
  '\u0442\u044b\u0441\u044f\u0447\u0438': 1000,
  '\u0442\u044b\u0441\u044f\u0447': 1000,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/[^\w$.\u20ac\u20bd\u20b8\s\u0430-\u044f-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return normalizeText(value).replace(new RegExp(`[^a-z0-9${RU_CHARS}]`, 'g'), '');
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectOperation(text: string): 'add' | 'subtract' | 'set' | null {
  if (hasAny(text, OP_KEYWORDS.subtract)) return 'subtract';
  if (hasAny(text, OP_KEYWORDS.add)) return 'add';
  if (hasAny(text, OP_KEYWORDS.set)) return 'set';
  return null;
}

function detectCurrency(rawText: string, account?: AccountLike | null): string {
  for (const [currency, pattern] of CURRENCY_PATTERNS) {
    if (pattern.test(rawText)) return currency;
  }
  return (account?.currency || 'USD').toUpperCase();
}

function parseNumericAmount(text: string): number | null {
  const match = text.match(/(?:\d[\d\s\u00a0]*)(?:[,.]\d+)?/);
  if (!match) return null;
  const normalized = match[0].replace(/[\s\u00a0]/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseWordAmount(text: string): number | null {
  const tokens = normalizeText(text).split(/\s+/);
  let best = 0;
  let current = 0;
  let seen = false;

  for (const token of tokens) {
    const value = NUMBER_WORDS[token];
    if (value === undefined) {
      if (seen) break;
      continue;
    }

    seen = true;
    if (value === 100) {
      current = Math.max(1, current) * 100;
    } else if (value === 1000) {
      best += Math.max(1, current) * 1000;
      current = 0;
    } else {
      current += value;
    }
  }

  const total = best + current;
  return seen && total > 0 ? total : null;
}

function parseAmount(text: string): number | null {
  return parseNumericAmount(text) ?? parseWordAmount(text);
}

function accountAliases(account: AccountLike): string[] {
  const name = normalizeText(account.name);
  const aliases = [name, account.id.replace(/^acc_/, '').replace(/_/g, ' ')];
  const words = name.split(/\s+/).filter((word) => word.length >= 3);
  aliases.push(...words);

  const combined = `${account.id} ${name}`.toLowerCase();
  if (combined.includes('cash')) aliases.push('cash', '\u043d\u0430\u043b\u0438\u0447');
  if (combined.includes('bybit')) aliases.push('bybit', 'by bit');
  if (combined.includes('kaspi')) aliases.push('kaspi', '\u043a\u0430\u0441\u043f\u0438');
  if (combined.includes('okx')) aliases.push('okx', 'ok x');
  if (combined.includes('aptos')) aliases.push('aptos');
  if (combined.includes('solana')) aliases.push('solana', 'sol');

  return Array.from(new Set(aliases.filter(Boolean)));
}

function findAccount(text: string, accounts: AccountLike[]): { account: AccountLike | null; confidence: number } {
  const normalized = normalizeText(text);
  const compactText = compact(text);
  let best: { account: AccountLike | null; confidence: number } = { account: null, confidence: 0 };

  for (const account of accounts) {
    for (const alias of accountAliases(account)) {
      const aliasNorm = normalizeText(alias);
      const aliasCompact = compact(alias);
      let score = 0;
      if (aliasNorm.length >= 3 && normalized.includes(aliasNorm)) score = Math.max(score, aliasNorm.length > 5 ? 0.96 : 0.82);
      if (aliasCompact.length >= 3 && compactText.includes(aliasCompact)) score = Math.max(score, aliasCompact.length > 5 ? 0.92 : 0.78);
      if (score > best.confidence) best = { account, confidence: score };
    }
  }

  return best;
}

export function findMatchingAccount(
  rawText: string,
  accounts: AccountLike[]
): { account: AccountLike | null; confidence: number } {
  return findAccount(rawText, accounts);
}

function findRecentToolAccount(chatHistory?: { role: 'user' | 'assistant'; content: string }[]): string | null {
  if (!chatHistory) return null;
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const match = chatHistory[index].content.match(/"accountId"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

function defaultAccountForCurrency(accounts: AccountLike[], currency: string): AccountLike | null {
  if (currency === 'USD') {
    return accounts.find((account) => /cash/i.test(account.name) || /cash/i.test(account.id)) || null;
  }
  return accounts.find((account) => (account.currency || '').toUpperCase() === currency) || null;
}

function isGoalCommand(text: string): boolean {
  return hasAny(text, GOAL_KEYWORDS);
}

export function isPotentialCommand(rawText: string): boolean {
  const text = normalizeText(rawText);
  return (
    /\bbtc\b|\bbitcoin\b/.test(text) ||
    detectOperation(text) !== null ||
    (parseAmount(text) !== null && isGoalCommand(text))
  );
}

export function parseFinanceCommand(
  rawText: string,
  accounts: AccountLike[],
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
): ParsedCommand | null {
  const text = normalizeText(rawText);
  if (!text) return null;

  const asksBtcPrice =
    /\bbtc\b|\bbitcoin\b/.test(text) &&
    (/\b(price|course|rate)\b/.test(text) || text.includes('\u0446\u0435\u043d') || text.includes('\u043a\u0443\u0440\u0441'));
  if (asksBtcPrice) {
    return { action: 'btc_price', confidence: 0.95 };
  }

  const amount = parseAmount(text);
  if (amount === null) return null;

  if (isGoalCommand(text)) {
    return {
      action: 'update_goal',
      targetValue: amount,
      title: `Reach $${amount.toLocaleString()} in liquid assets`,
      currency: detectCurrency(rawText),
      confidence: 0.86,
    };
  }

  const explicitOperation = detectOperation(text);
  const accountMatch = findAccount(text, accounts);
  let account = accountMatch.account;
  let accountConfidence = accountMatch.confidence;

  const recentAccountId = findRecentToolAccount(chatHistory);
  if (!account && recentAccountId) {
    account = accounts.find((item) => item.id === recentAccountId) || null;
    accountConfidence = account ? 0.74 : 0;
  }

  const currency = detectCurrency(rawText, account);
  if (!account) {
    account = defaultAccountForCurrency(accounts, currency);
    accountConfidence = account ? 0.62 : 0;
  }

  if (!account) return null;

  const operation = explicitOperation || (accountConfidence >= 0.78 ? 'set' : null);
  if (!operation) return null;

  const confidence = Math.min(0.98, 0.45 + accountConfidence * 0.35 + (explicitOperation ? 0.18 : 0.08));
  if (confidence < 0.68) return null;

  return {
    action: 'update_balance',
    accountId: account.id,
    amount,
    currency,
    type: operation,
    confidence,
  };
}

export function commandToToolCall(command: ParsedCommand): string {
  if (command.action === 'btc_price') {
    return '[TOOL_CALL: BTC_PRICE]';
  }

  if (command.action === 'update_goal') {
    return `[TOOL_CALL: UPDATE_GOAL: ${JSON.stringify({
      targetValue: command.targetValue,
      title: command.title,
      currency: command.currency,
    })}]`;
  }

  return `[TOOL_CALL: UPDATE_BALANCE: ${JSON.stringify({
    accountId: command.accountId,
    amount: command.amount,
    currency: command.currency,
    type: command.type,
  })}]`;
}
