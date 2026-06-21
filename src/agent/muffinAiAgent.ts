import { askLocalQVAC, InferenceStats } from '../services/qvacService';
import { ModelId, DEFAULT_MODEL_ID } from '../services/modelCatalog';
import {
  getLatestBalances,
  getActiveGoals,
  getRatesMap,
  getSetting,
  normalizeCurrency,
  getBalanceGroups,
  getPaymentCoverageSummary,
  getUpcomingPaymentObligations,
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';
import { AiContext, isAccountContext } from './aiContext';
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

function buildContextString(aiContext?: AiContext | null): string {
  const accounts = getLatestBalances();
  const goals = getActiveGoals();
  const rules = checkMoneyRules();
  const rates = getRatesMap();

  let context = 'LOCAL FINANCIAL MEMORY\n\n';

  if (isAccountContext(aiContext)) {
    context += 'ACTIVE UI CONTEXT:\n';
    context += `- Current account: ${aiContext.accountName} (ID: ${aiContext.accountId}, currency: ${aiContext.currency}, owner: ${aiContext.ownerType || 'personal'}, source: ${aiContext.source || 'manual'})\n`;
    context += '- If the user says here, there, this account, current account, тут, здесь, or similar, resolve it to this account unless they explicitly name another account.\n\n';
  }
  
  context += 'Goals:\n';
  goals.forEach(g => context += `- ${g.title}: $${g.target_value} (Base Currency: ${g.currency || 'USD'})\n`);

  context += '\nAccounts:\n';
  let total = 0;
  accounts.forEach(a => {
    // Include account ID and currency to help the LLM match them correctly
    const syncDetails = typeof a.raw_text === 'string' && a.raw_text.trim()
      ? ` Sync details: ${a.raw_text.slice(0, 500)}`
      : '';
    context += `- ${a.name} (ID: ${a.id}, source: ${a.source || 'manual'}, owner: ${a.owner_type || 'personal'}, share: ${a.ownership_percent || 100}%): ${a.amount} ${a.currency || 'USD'} (USD: $${a.usd_value}, owned USD: $${a.owned_usd_value || a.usd_value}). Note: ${a.model_note || 'No note'}${syncDetails}\n`;
    total += a.usd_value;
  });

  const balanceGroups = getBalanceGroups();
  context += '\nAccount Groups:\n';
  context += `- Personal total: $${balanceGroups.personalUsd}\n`;
  context += `- Company total: $${balanceGroups.companyUsd}\n`;
  context += `- Company owned share: $${balanceGroups.companyOwnedUsd}\n`;
  context += `- Personal + owned company share: $${balanceGroups.totalOwnedUsd}\n`;

  const paymentSummary = getPaymentCoverageSummary(31);
  context += '\nUpcoming Payments (31 days):\n';
  paymentSummary.payments.forEach((payment: any) => {
    context += `- ${payment.title} (${payment.owner_type}): ${payment.amount} ${payment.currency}, due day ${payment.due_day}, account ${payment.account_name || payment.account_id || 'not set'}. Note: ${payment.model_note || 'No note'}\n`;
  });
  paymentSummary.deficits.forEach((deficit) => {
    const suggestion = deficit.suggested_from_currency
      ? ` Convert about ${deficit.suggested_from_amount} ${deficit.suggested_from_currency} to ${deficit.currency}.`
      : '';
    context += `- Payment deficit for ${deficit.owner_type} ${deficit.currency}: missing ${deficit.missing} ${deficit.currency}.${suggestion}\n`;
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
  const amount = Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
  return `${amount} ${currency || 'USD'}`;
}

function totalUsd(accounts: ReturnType<typeof getLatestBalances>): number {
  return accounts.reduce((sum, account) => sum + Number(account.usd_value || 0), 0);
}

function formatUsd(value: number): string {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function instantStats(): InferenceStats {
  return {
    ttftMs: 0,
    generationTimeMs: 0,
    tokenCount: 0,
    tokensPerSec: 0,
    instant: true,
  };
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
    text.includes('what\'s on') ||
    text.includes('\u0441\u043a\u043e\u043b\u044c\u043a\u043e') ||
    text.includes('\u0431\u0430\u043b\u0430\u043d\u0441') ||
    text.includes('\u043e\u0441\u0442\u0430\u0442\u043e\u043a') ||
    text.includes('\u0441\u043a\u043e\u043a\u0430')
  );
}

function isAccountOnlyReadQuestion(text: string): boolean {
  const withoutQuestionWords = text
    .replace(/^(а|and)\s+/, '')
    .replace(/^(на|in|on)\s+/, '')
    .trim();
  return withoutQuestionWords.length > 0 && withoutQuestionWords.length <= 40 && !/\d/.test(withoutQuestionWords);
}

function isContextReferenceQuestion(text: string): boolean {
  return (
    /\bhere\b|\bthere\b|\bthis account\b|\bthat account\b|\bcurrent account\b|\bthis wallet\b|\bthat wallet\b|\bcurrent wallet\b|\bon this\b|\bin this\b|\bon there\b|\bin there\b/.test(text) ||
    text.includes('\u0442\u0443\u0442') ||
    text.includes('\u0437\u0434\u0435\u0441\u044c') ||
    text.includes('\u043d\u0430 \u044d\u0442\u043e\u043c') ||
    text.includes('\u0432 \u044d\u0442\u043e\u043c') ||
    text.includes('\u044d\u0442\u043e\u0442 \u0441\u0447\u0435\u0442') ||
    text.includes('\u044d\u0442\u043e\u043c \u0441\u0447\u0435\u0442') ||
    text.includes('\u044d\u0442\u043e\u0442 \u043a\u043e\u0448') ||
    text.includes('\u044d\u0442\u043e\u043c \u043a\u043e\u0448')
  );
}

function getContextAccount(
  accounts: ReturnType<typeof getLatestBalances>,
  aiContext?: AiContext | null
) {
  if (!isAccountContext(aiContext)) return null;
  return accounts.find((account) => account.id === aiContext.accountId) || null;
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

function isCompanyScopeQuestion(text: string): boolean {
  return (
    text.includes('company') ||
    text.includes('business') ||
    text.includes('corporate') ||
    text.includes('компан') ||
    text.includes('бизнес') ||
    text.includes('юр') ||
    text.includes('тоо') ||
    text.includes('ооо')
  );
}

function isPersonalScopeQuestion(text: string): boolean {
  return (
    text.includes('personal') ||
    text.includes('private') ||
    text.includes('личн') ||
    text.includes('физ')
  );
}

function isPaymentQuestion(text: string): boolean {
  return (
    text.includes('платеж') ||
    text.includes('платёж') ||
    text.includes('оплат') ||
    text.includes('ипотек') ||
    text.includes('кредит') ||
    text.includes('долг') ||
    text.includes('хватит') ||
    text.includes('нужно перев') ||
    text.includes('конверт') ||
    text.includes('payment') ||
    text.includes('bill') ||
    text.includes('mortgage') ||
    text.includes('loan') ||
    text.includes('due') ||
    text.includes('cover')
  );
}

type WalletChain = 'aptos' | 'solana';

const WALLET_CHAIN_SOURCES: Record<WalletChain, string> = {
  aptos: 'aptos_public_wallet',
  solana: 'solana_public_wallet',
};

function chainFromAccountSource(source?: string | null): WalletChain | null {
  if (source === WALLET_CHAIN_SOURCES.aptos) return 'aptos';
  if (source === WALLET_CHAIN_SOURCES.solana) return 'solana';
  return null;
}

// Robust per-account chain detection. The canonical `source` tag is only set on
// synced wallets — user-created wallets ("Aptos DeFi Show") may carry source
// 'manual', so we fall back to the account name. This is why a second Aptos
// wallet was being missed in the count.
function chainFromAccount(account: { source?: string | null; name?: string | null }): WalletChain | null {
  const bySource = chainFromAccountSource(account.source);
  if (bySource) return bySource;
  const name = (account.name || '').toLowerCase();
  if (name.includes('aptos') || name.includes('аптос')) return 'aptos';
  if (name.includes('solana') || name.includes('солана')) return 'solana';
  return null;
}

function getMentionedChains(text: string): WalletChain[] {
  const chains: WalletChain[] = [];
  // Normalize "Apto's" / "Aptos wallets" so chain detection is reliable.
  const chainText = text
    .replace(/\bapto?s(?:'s|'s|s)?\b/gi, 'aptos')
    .replace(/\bsolana(?:'s|'s|s)?\b/gi, 'solana');

  if (/\baptos\b|аптос/.test(chainText)) chains.push('aptos');
  // Match Solana explicitly; avoid bare "sol" (e.g. false positives in edge cases).
  if (/\bsolana\b|солана/.test(chainText)) chains.push('solana');
  return chains;
}

function isWalletListQuestion(text: string): boolean {
  return (
    text.includes('дай') ||
    text.includes('покаж') ||
    text.includes('список') ||
    text.includes('какие') ||
    text.includes('list') ||
    text.includes('show') ||
    text.includes('give me') ||
    /\bwallets?\b/.test(text) ||
    text.includes('кошел')
  );
}

function isCountQuestion(text: string): boolean {
  // "how many wallets", "сколько ... кошельков/счетов" — counting items, not balance.
  return (
    /\bhow many\b/.test(text) ||
    /\bnumber of\b/.test(text) ||
    (text.includes('сколько') &&
      (text.includes('кошельк') || text.includes('счетов') || /\bwallets?\b/.test(text)))
  );
}

function ruWalletWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'кошельков';
  if (mod10 === 1) return 'кошелёк';
  if (mod10 >= 2 && mod10 <= 4) return 'кошелька';
  return 'кошельков';
}

function buildWalletCountAnswer(
  accounts: ReturnType<typeof getLatestBalances>,
  isRussian: boolean,
  mentionedChains: WalletChain[]
): string {
  const count = accounts.length;
  const chainPrefix = mentionedChains.length === 1 ? `${chainLabel(mentionedChains[0])} ` : '';

  if (count === 0) {
    return isRussian
      ? `${chainPrefix ? chainPrefix : 'Публичных '}кошельков пока нет.`
      : `You have no ${chainPrefix}wallets yet.`;
  }

  const lines = accounts.map(formatWalletAccountLine);
  const total = formatUsd(totalUsd(accounts));

  if (isRussian) {
    return `У тебя ${count} ${chainPrefix}${ruWalletWord(count)}:\n${lines.join('\n')}\n\nИтого: $${total}.`;
  }
  const noun = count === 1 ? 'wallet' : 'wallets';
  return `You have ${count} ${chainPrefix}${noun}:\n${lines.join('\n')}\n\nTotal: $${total}.`;
}

function isCryptoWalletScopeQuestion(text: string): boolean {
  if (getMentionedChains(text).length > 0) return false;
  const hasCryptoScope =
    text.includes('крипто') ||
    text.includes('crypto') ||
    text.includes('on-chain') ||
    text.includes('onchain') ||
    text.includes('блокчейн') ||
    text.includes('blockchain');
  if (!hasCryptoScope) return false;
  return isBalanceReadQuestion(text) || isWalletListQuestion(text) || isAccountOnlyReadQuestion(text);
}

function isAllPublicWalletsQuestion(text: string): boolean {
  if (isCryptoWalletScopeQuestion(text)) return true;

  const mentionedChains = getMentionedChains(text);
  if (mentionedChains.length > 0) return false;
  const hasWalletWord = text.includes('кошел') || /\bwallets?\b/.test(text);
  if (
    hasWalletWord &&
    mentionedChains.length === 0 &&
    (isBalanceReadQuestion(text) || isWalletListQuestion(text))
  ) {
    return true;
  }

  return (
    ((text.includes('все') || text.includes('all')) && hasWalletWord) ||
    text.includes('crypto wallet') ||
    text.includes('крипто кош')
  );
}

function isWalletScopeReadQuestion(
  text: string,
  mentionedChains: WalletChain[],
  allWallets: boolean
): boolean {
  if (allWallets) {
    return isBalanceReadQuestion(text) || isWalletListQuestion(text);
  }
  if (mentionedChains.length === 0) return false;
  return (
    isBalanceReadQuestion(text) ||
    isAccountOnlyReadQuestion(text) ||
    isWalletListQuestion(text)
  );
}

function isPublicWalletAccount(account: ReturnType<typeof getLatestBalances>[number]): boolean {
  if (chainFromAccount(account) !== null) return true;
  return account.type === 'crypto_wallet';
}

function getPublicWalletAccounts(
  accounts: ReturnType<typeof getLatestBalances>,
  chains?: WalletChain[] | null
): ReturnType<typeof getLatestBalances> {
  const wallets = accounts.filter(isPublicWalletAccount);
  if (!chains || chains.length === 0) return wallets;
  const allowed = new Set(chains);
  return wallets.filter((account) => {
    const chain = chainFromAccount(account);
    return chain !== null && allowed.has(chain);
  });
}

function chainLabel(chain: WalletChain): string {
  return chain === 'aptos' ? 'Aptos' : 'Solana';
}

function formatWalletAccountLine(account: ReturnType<typeof getLatestBalances>[number]): string {
  const nativeBalance = formatMoney(account.amount || 0, account.currency || 'USD');
  const usdValue = formatUsd(account.usd_value || 0);
  const needsUsdEquivalent = (account.currency || 'USD').toUpperCase() !== 'USD';
  return needsUsdEquivalent
    ? `- ${account.name}: ${nativeBalance} (≈ $${usdValue})`
    : `- ${account.name}: $${usdValue}`;
}

function buildWalletScopeAnswer(
  accounts: ReturnType<typeof getLatestBalances>,
  isRussian: boolean,
  mentionedChains: WalletChain[]
): string {
  if (accounts.length === 0) {
    if (mentionedChains.length === 1) {
      return isRussian
        ? `${chainLabel(mentionedChains[0])}-кошельков пока нет.`
        : `No ${chainLabel(mentionedChains[0])} wallets yet.`;
    }
    return isRussian ? 'Публичных кошельков пока нет.' : 'No public wallets yet.';
  }

  if (accounts.length === 1) {
    return buildAccountBalanceAnswer(accounts[0], isRussian);
  }

  const chainsPresent = [...new Set(
    accounts
      .map((account) => chainFromAccount(account))
      .filter((chain): chain is WalletChain => chain !== null)
  )];

  const groupByChain = chainsPresent.length > 1 || mentionedChains.length > 1;

  if (!groupByChain) {
    const lines = accounts.map(formatWalletAccountLine);
    const total = formatUsd(totalUsd(accounts));
    const label = chainLabel(chainsPresent[0] || mentionedChains[0] || 'aptos');
    return isRussian
      ? `${label}:\n${lines.join('\n')}\n\nИтого: $${total}.`
      : `${label}:\n${lines.join('\n')}\n\nTotal: $${total}.`;
  }

  const sections: string[] = [];
  for (const chain of chainsPresent) {
    const chainAccounts = accounts.filter((account) => chainFromAccount(account) === chain);
    if (chainAccounts.length === 0) continue;
    const lines = chainAccounts.map(formatWalletAccountLine);
    const subtotal = formatUsd(totalUsd(chainAccounts));
    sections.push(
      isRussian
        ? `${chainLabel(chain)}:\n${lines.join('\n')}\nИтого ${chainLabel(chain)}: $${subtotal}.`
        : `${chainLabel(chain)}:\n${lines.join('\n')}\n${chainLabel(chain)} subtotal: $${subtotal}.`
    );
  }

  const grandTotal = formatUsd(totalUsd(accounts));
  return isRussian
    ? `${sections.join('\n\n')}\n\nВсего по кошелькам: $${grandTotal}.`
    : `${sections.join('\n\n')}\n\nTotal wallets: $${grandTotal}.`;
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
  const usdValue = formatUsd(account.usd_value || 0);
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
      : ` (≈ $${formatUsd(account.usd_value || 0)})`;
    return `- ${account.name}: ${nativeBalance}${usdSuffix}`;
  });

  const total = formatUsd(totalUsd(accounts));
  return isRussian
    ? `Сейчас по счетам:\n${lines.join('\n')}\n\nИтого в USD-эквиваленте: $${total}.`
    : `Current balances:\n${lines.join('\n')}\n\nTotal USD equivalent: $${total}.`;
}

function buildAccountBalanceAnswer(account: any, isRussian: boolean): string {
  const nativeBalance = formatMoney(account.amount || 0, account.currency || 'USD');
  const usdValue = formatUsd(account.usd_value || 0);
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
  const totalText = formatUsd(total);
  const remainingText = formatUsd(remaining);

  return isRussian
    ? `До цели осталось примерно $${remainingText}. Сейчас есть $${totalText} из $${formatUsd(target)}.`
    : `About $${remainingText} remains. Current total is $${totalText} of $${formatUsd(target)}.`;
}

function buildGroupedBalanceAnswer(isRussian: boolean): string {
  const groups = getBalanceGroups();
  if (isRussian) {
    return [
      `Личные счета: $${formatUsd(groups.personalUsd)}.`,
      `Счета компании: $${formatUsd(groups.companyUsd)}.`,
      `Твоя доля в company-счетах: $${formatUsd(groups.companyOwnedUsd)}.`,
      `Личные деньги + твоя доля компании: $${formatUsd(groups.totalOwnedUsd)}.`,
    ].join('\n');
  }

  return [
    `Personal accounts: $${formatUsd(groups.personalUsd)}.`,
    `Company accounts: $${formatUsd(groups.companyUsd)}.`,
    `Your company share: $${formatUsd(groups.companyOwnedUsd)}.`,
    `Personal + owned company share: $${formatUsd(groups.totalOwnedUsd)}.`,
  ].join('\n');
}

function buildPaymentCoverageAnswer(question: string, isRussian: boolean): string {
  const text = normalizeQuestion(question);
  const ownerType = isCompanyScopeQuestion(text)
    ? 'company'
    : isPersonalScopeQuestion(text)
      ? 'personal'
      : undefined;
  const summary = getPaymentCoverageSummary(31, ownerType as any);
  const scopeLabel = ownerType === 'company'
    ? (isRussian ? 'компании' : 'company')
    : ownerType === 'personal'
      ? (isRussian ? 'личным счетам' : 'personal')
      : (isRussian ? 'всем счетам' : 'all accounts');

  if (summary.payments.length === 0) {
    return isRussian
      ? `На ближайшие ${summary.daysAhead} дней платежей по ${scopeLabel} нет.`
      : `No upcoming payments for ${scopeLabel} in the next ${summary.daysAhead} days.`;
  }

  const paymentLines = summary.payments.map((payment: any) => {
    const due = new Date(payment.due_date_iso).toLocaleDateString();
    const account = payment.account_name ? `, ${isRussian ? 'счет' : 'account'}: ${payment.account_name}` : '';
    return `- ${payment.title}: ${formatMoney(payment.amount, payment.currency)}, ${isRussian ? 'до' : 'due'} ${due}${account}`;
  });

  if (summary.isCovered) {
    return isRussian
      ? `На ближайшие ${summary.daysAhead} дней по ${scopeLabel} платежи покрыты.\n${paymentLines.join('\n')}\n\nИтого платежей: ~$${formatUsd(summary.totalDueUsd)}.`
      : `Upcoming payments for ${scopeLabel} are covered for the next ${summary.daysAhead} days.\n${paymentLines.join('\n')}\n\nTotal due: ~$${formatUsd(summary.totalDueUsd)}.`;
  }

  const deficitLines = summary.deficits.map((deficit: any) => {
    const conversion = deficit.suggested_from_currency
      ? isRussian
        ? ` Можно перевести примерно ${formatMoney(deficit.suggested_from_amount, deficit.suggested_from_currency)} в ${deficit.currency}.`
        : ` Convert about ${formatMoney(deficit.suggested_from_amount, deficit.suggested_from_currency)} to ${deficit.currency}.`
      : isRussian
        ? ' Свободной суммы в другой валюте не хватает для полного покрытия.'
        : ' There is not enough surplus in another currency to fully cover it.';
    return isRussian
      ? `- ${deficit.owner_type}: не хватает ${formatMoney(deficit.missing, deficit.currency)}.${conversion}`
      : `- ${deficit.owner_type}: missing ${formatMoney(deficit.missing, deficit.currency)}.${conversion}`;
  });

  return isRussian
    ? `На ближайшие ${summary.daysAhead} дней есть риск по платежам ${scopeLabel}.\n${paymentLines.join('\n')}\n\nДефицит:\n${deficitLines.join('\n')}`
    : `There is payment coverage risk for ${scopeLabel} in the next ${summary.daysAhead} days.\n${paymentLines.join('\n')}\n\nDeficits:\n${deficitLines.join('\n')}`;
}

// Currency detection for deterministic exchange-rate / conversion answers.
// Cyrillic aliases use plain substrings (\b is ASCII-only); ASCII codes use
// word boundaries so short codes (sol, apt, eth) don't match inside words.
const CURRENCY_PATTERNS: { code: string; re: RegExp }[] = [
  { code: 'USD', re: /\$|\busd\b|\bdollars?\b|доллар|бакс/ },
  { code: 'RUB', re: /₽|\brub\b|\brubles?\b|рубл|руб\b|руб\./ },
  { code: 'KZT', re: /₸|\bkzt\b|\btenge\b|тенге|\bтг\b/ },
  { code: 'EUR', re: /€|\beur\b|\beuros?\b|евро/ },
  { code: 'BTC', re: /\bbtc\b|bitcoin|биткоин|биток/ },
  { code: 'ETH', re: /\beth\b|ethereum|эфир/ },
  { code: 'SOL', re: /\bsol\b|solana|солана/ },
  { code: 'APT', re: /\bapt\b|aptos|аптос/ },
];

function detectCurrencies(text: string): string[] {
  const hits: { code: string; idx: number }[] = [];
  for (const { code, re } of CURRENCY_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ code, idx: m.index });
  }
  hits.sort((a, b) => a.idx - b.idx);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (!seen.has(h.code)) { seen.add(h.code); out.push(h.code); }
  }
  return out;
}

function formatRateAmount(value: number, code: string): string {
  if (code === 'USD') return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 })} ${code}`;
}

/**
 * Deterministic answer for "exchange rate" / currency-conversion questions
 * (e.g. "RUB to USD", "rub exchange rate", "how much does USD cost in rub",
 * "convert 100 eur to kzt"). Runs before account matching so currency codes
 * are not mistaken for account names (e.g. the "Cash USD" account).
 * Returns null when it isn't a rate question, letting the cascade continue.
 */
function answerExchangeRateQuestion(text: string): string | null {
  // Balance intents (how much do I have / balance) are handled elsewhere.
  const isBalanceIntent =
    /\bbalance\b|\bhave\b|\bowe\b/.test(text) ||
    text.includes('баланс') || text.includes('у меня') ||
    text.includes('на счет') || text.includes('сколько у меня');
  if (isBalanceIntent) return null;

  const currencies = detectCurrencies(text);
  if (currencies.length === 0) return null;

  const hasRateWord =
    /\bexchange\b|\brate\b|\bconvert\b|\bworth\b|\bcosts?\b/.test(text) ||
    text.includes('курс') || text.includes('конверт') ||
    text.includes('стоит') || text.includes('сколько будет');
  const hasPairConnector =
    /\bto\b|\bin\b/.test(text) || text.includes(' в ') || text.includes(' на ');

  const rates = getRatesMap();
  const rateToUsd = (code: string) => (code === 'USD' ? 1 : rates[code] || 0);

  const amountMatch = text.match(/\d[\d\s.,]*\d|\d/);
  const amount = amountMatch
    ? parseFloat(amountMatch[0].replace(/\s/g, '').replace(',', '.'))
    : null;

  // Pair / conversion: two currencies + a connector or rate word.
  if (currencies.length >= 2 && (hasRateWord || hasPairConnector)) {
    const [from, to] = currencies;
    const rFrom = rateToUsd(from);
    const rTo = rateToUsd(to);
    if (!rFrom || !rTo) return null; // no rate data — let the LLM try
    const unit = rFrom / rTo;
    if (amount && amount > 0) {
      return `${amount.toLocaleString()} ${from} = ${formatRateAmount(amount * unit, to)}`;
    }
    return `1 ${from} = ${formatRateAmount(unit, to)}`;
  }

  // Single currency + explicit rate word: quote against USD.
  if (currencies.length === 1 && hasRateWord) {
    const code = currencies[0];
    if (code === 'USD') return null;
    const r = rateToUsd(code);
    if (!r) return null;
    if (amount && amount > 0) {
      return `${amount.toLocaleString()} ${code} = ${formatRateAmount(amount * r, 'USD')}`;
    }
    return `1 ${code} = ${formatRateAmount(r, 'USD')}`;
  }

  return null;
}

function answerScopedAccountQuestion(
  question: string,
  accounts: ReturnType<typeof getLatestBalances>,
  isRussian: boolean,
  aiContext?: AiContext | null
): string | null {
  const account = getContextAccount(accounts, aiContext);
  if (!account) return null;

  const text = normalizeQuestion(question);

  // Chain-scope ("...aptos...") and count ("how many wallets") questions must be
  // answered by the wallet-scope handler across ALL matching wallets — not
  // collapsed to the single account the UI auto-bound from a chain keyword.
  if (isCountQuestion(text) || getMentionedChains(text).length > 0) return null;

  const explicitMatch = findMatchingAccount(text, accounts);
  const explicitCurrentAccount =
    explicitMatch.account &&
    explicitMatch.confidence >= 0.78 &&
    explicitMatch.account.id === account.id;

  if (
    explicitMatch.account &&
    explicitMatch.confidence >= 0.78 &&
    explicitMatch.account.id !== account.id
  ) {
    return null;
  }

  const isScopedRead =
    (isContextReferenceQuestion(text) || explicitCurrentAccount) &&
    (
      isBalanceReadQuestion(text) ||
      text.includes('\u043b\u0435\u0436') ||
      text.includes('\u0441\u0447\u0435\u0442') ||
      text.includes('\u043a\u043e\u0448') ||
      /\bwhat\b|\bhow much\b|\bbalance\b|\bhave\b/.test(text)
    );

  if (!isScopedRead || isOverviewQuestion(text)) return null;
  return buildAccountBalanceAnswer(account, isRussian);
}

function answerSimpleReadQuestion(question: string, accounts: ReturnType<typeof getLatestBalances>, isRussian: boolean): string | null {
  const text = normalizeQuestion(question);

  const accountMatch = findMatchingAccount(text, accounts);
  if (
    accountMatch.account &&
    accountMatch.confidence >= 0.78 &&
    (isBalanceReadQuestion(text) || isAccountOnlyReadQuestion(text))
  ) {
    return buildAccountBalanceAnswer(accountMatch.account, isRussian);
  }

  if (isPaymentQuestion(text)) {
    return buildPaymentCoverageAnswer(question, isRussian);
  }

  const rateAnswer = answerExchangeRateQuestion(text);
  if (rateAnswer) return rateAnswer;

  if (
    (isCompanyScopeQuestion(text) || isPersonalScopeQuestion(text)) &&
    (isOverviewQuestion(text) || text.includes('счет') || text.includes('account') || text.includes('money') || text.includes('деньг'))
  ) {
    return buildGroupedBalanceAnswer(isRussian);
  }

  if (isGoalRemainingQuestion(text)) {
    return buildGoalRemainingAnswer(accounts, isRussian);
  }

  if (isLargestBalanceQuestion(text)) {
    return buildLargestBalanceAnswer(accounts, isRussian);
  }

  if (isOverviewQuestion(text)) {
    return buildOverviewAnswer(accounts, isRussian);
  }

  return null;
}

const COMMAND_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['none', 'clarify', 'btc_price', 'update_balance', 'update_goal'],
    },
    accountName: { type: 'string' },
    accountId: { type: 'string' },
    amount: { type: 'number' },
    currency: { type: 'string' },
    type: {
      type: 'string',
      enum: ['add', 'subtract', 'set'],
    },
    targetValue: { type: 'number' },
    title: { type: 'string' },
    newName: { type: 'string' },
    confidence: { type: 'number' },
    clarifyingQuestion: { type: 'string' },
  },
  required: ['action'],
};

type StructuredWriteResult =
  | { kind: 'command'; command: ParsedCommand }
  | { kind: 'clarify'; message: string }
  | { kind: 'none' };

function getAccountListString(accounts: ReturnType<typeof getLatestBalances>): string {
  return accounts
    .map((account) => `- ${account.name}: id=${account.id}, owner=${account.owner_type || 'personal'}, share=${account.ownership_percent || 100}%, currency=${account.currency || 'USD'}, note=${account.model_note || ''}`)
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

function normalizeCommandQuestion(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAnyCommandPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasSetBalanceCue(question: string): boolean {
  const text = normalizeCommandQuestion(question);
  return hasAnyCommandPattern(text, [
    /\bset\b.*\bbalance\b/,
    /\bbalance\b.*\b(to|is|now)\b/,
    /\bmake\b\s+\w*\s*\b(balance|it)\b/,
    /\bnow\b.*\b(has|is)\b/,
    /\bcurrent\b.*\bbalance\b/,
    /баланс/,
    /теперь/,
    /сейчас/,
    /стало/,
    /установ/,
    /постав/,
  ]);
}

function hasSubtractCue(question: string): boolean {
  const text = normalizeCommandQuestion(question);
  return hasAnyCommandPattern(text, [
    /\bsubtract\b/,
    /\bspen[dt]\b/,
    /\bminus\b/,
    /\bpaid\b/,
    /\bpay\b\s+(?!pal\b)/,
    /\bwithdraw\b/,
    /\bwithdrew\b/,
    /\bcharged\b/,
    /спиш/,
    /спис/,
    /минус/,
    /потрат/,
    /оплат/,
    /снял/,
    /снят/,
    /вывел/,
    /купил/,
  ]);
}

function hasAddCue(question: string): boolean {
  const text = normalizeCommandQuestion(question);
  return hasAnyCommandPattern(text, [
    /\badd\b/,
    /\bplus\b/,
    /\bdeposit\b/,
    /\breceived\b/,
    /\btop\s+up\b/,
    /\btopped\s+up\b/,
    /добав/,
    /плюс/,
    /пополн/,
    /пришл/,
    /получ/,
    /зачисл/,
  ]);
}

function validateStructuredOperation(
  question: string,
  operation: unknown
): 'add' | 'subtract' | 'set' | 'clarify' | null {
  if (operation !== 'add' && operation !== 'subtract' && operation !== 'set') return null;

  const hasSet = hasSetBalanceCue(question);
  const hasSubtract = hasSubtractCue(question);
  const hasAdd = hasAddCue(question);

  if (hasSet && !hasSubtract && !hasAdd) return 'set';
  if (operation === 'subtract' && !hasSubtract) return 'clarify';
  if (operation === 'add' && !hasAdd && hasSet) return 'set';

  return operation;
}

function structuredResultToWriteResult(
  data: any,
  accounts: ReturnType<typeof getLatestBalances>,
  question: string,
  aiContext?: AiContext | null
): StructuredWriteResult {
  if (!data || data.action === 'none') return { kind: 'none' };

  if (data.action === 'clarify') {
    return {
      kind: 'clarify',
      message: typeof data.clarifyingQuestion === 'string' && data.clarifyingQuestion.trim()
        ? data.clarifyingQuestion.trim()
        : 'Please clarify the account, amount, and action.',
    };
  }

  const confidence = Number(data.confidence);
  if (Number.isFinite(confidence) && confidence < 0.68) {
    return {
      kind: 'clarify',
      message: 'Please clarify the account, amount, and action.',
    };
  }

  if (data.action === 'btc_price') {
    return { kind: 'command', command: { action: 'btc_price', confidence: 0.8 } };
  }

  if (data.action === 'update_goal') {
    const targetValue = Number(data.targetValue ?? data.amount);
    if (!Number.isFinite(targetValue) || targetValue <= 0) return { kind: 'none' };
    return {
      kind: 'command',
      command: {
        action: 'update_goal',
        targetValue,
        title: typeof data.title === 'string' && data.title.trim()
          ? data.title.trim()
          : `Reach $${targetValue.toLocaleString()} in liquid assets`,
        currency: normalizeCurrency(data.currency || 'USD'),
        confidence: 0.76,
      },
    };
  }

  if (data.action === 'create_account') {
    return { kind: 'none' };
  }

  if (data.action === 'update_balance') {
    const account = accounts.find((item) => item.id === data.accountId) || getContextAccount(accounts, aiContext);
    const amount = Number(data.amount);
    if (!account || !Number.isFinite(amount) || amount < 0) {
      return {
        kind: 'clarify',
        message: 'Which account and amount should I update?',
      };
    }

    const operation = validateStructuredOperation(question, data.type);
    if (operation === 'clarify') {
      return {
        kind: 'clarify',
        message: `Do you want to set ${account.name} to ${amount} ${normalizeCurrency(data.currency || account.currency || 'USD')}, add it, or subtract it?`,
      };
    }
    if (!operation) return { kind: 'none' };

    return {
      kind: 'command',
      command: {
        action: 'update_balance',
        accountId: account.id,
        amount,
        currency: normalizeCurrency(data.currency || account.currency || 'USD'),
        type: operation,
        confidence: 0.76,
      },
    };
  }

  if (data.action === 'rename_account') {
    return { kind: 'none' };
  }

  return { kind: 'none' };
}

async function askStructuredCommandFallback(
  question: string,
  accounts: ReturnType<typeof getLatestBalances>,
  modelType: ModelId,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[],
  aiContext?: AiContext | null
): Promise<{ result: StructuredWriteResult; stats?: InferenceStats }> {
  const systemPrompt = `Extract a short personal-finance WRITE command. Return JSON only.
If the user is asking a normal read/advice question, return {"action":"none"}.
If the command looks like a write command but account, amount, or action is unclear, return {"action":"clarify","clarifyingQuestion":"..."}.
Allowed actions:
- btc_price
- update_balance with accountId, amount, currency, type add|subtract|set
- update_goal with targetValue, title, currency

Rules:
- If ACTIVE UI CONTEXT has an account and the user says here/this/current account, use that accountId unless they explicitly name another account.
- If the user asks to create/add/open a new account, return {"action":"none"}. Account creation is handled only in the Accounts UI.
- Use only accountId values from the account list. Never invent an accountId.
- set means current balance/state. "set balance to", "balance is", "now has", "теперь", "стало" => type "set".
- add means deposit/received/plus/top up. Use it only for incoming money.
- subtract means spend/withdraw/minus/paid/bought. Use it only for outgoing money.
- Brand names are not verbs: PayPal is an account name, not "pay".
- Account rename is disabled in chat. If the user asks to rename an account, return {"action":"none"}.
- If the user says company/business/corporate, prefer owner=company accounts. If they do not, prefer owner=personal for ambiguous bank names like Kaspi or BCC.
- If more than one account could match, return clarify.
- If the user names an account that is not in the account list, return {"action":"none"}. Never substitute a different existing account just because the currency matches.`;

  const recentTool = chatHistory
    ?.slice()
    .reverse()
    .map((item) => item.content.match(/"accountId"\s*:\s*"([^"]+)"/)?.[1])
    .find(Boolean);

  const activeContextLine = isAccountContext(aiContext)
    ? `Active account context: ${aiContext.accountName}, accountId=${aiContext.accountId}, currency=${aiContext.currency}`
    : 'Active account context: none';

  const userPrompt = `Accounts:
${getAccountListString(accounts)}

${activeContextLine}

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
    return {
      result: structuredResultToWriteResult(parseJsonObject(response.message), accounts, question, aiContext),
      stats: response.stats,
    };
  } catch (error) {
    console.warn('[MuffinAI] Structured command fallback failed:', error);
    return { result: { kind: 'none' } };
  }
}

// ---------------------------------------------------------------------------
// READ ROUTER: the model classifies a read question into a structured intent
// (its strength), then deterministic code runs the actual SQLite query and
// formats the answer (the model never does the arithmetic/counting). Ambiguous
// questions resolve to `clarify`, which surfaces tappable follow-up chips.
// ---------------------------------------------------------------------------

export type Clarification = { label: string; prompt: string };

type ReadIntentAction =
  | 'count_wallets'
  | 'wallet_balance'
  | 'list_wallets'
  | 'account_balance'
  | 'largest_balance'
  | 'overview'
  | 'grouped_balance'
  | 'goal_remaining'
  | 'payments'
  | 'exchange_rate'
  | 'btc_price'
  | 'freeform'
  | 'clarify';

const READ_ACTIONS: ReadIntentAction[] = [
  'count_wallets', 'wallet_balance', 'list_wallets', 'account_balance',
  'largest_balance', 'overview', 'grouped_balance', 'goal_remaining',
  'payments', 'exchange_rate', 'btc_price', 'freeform', 'clarify',
];

type ReadIntent = {
  action: ReadIntentAction;
  chain?: WalletChain | null;
  scope?: 'personal' | 'company' | null;
  account?: string | null;
};

type ReadExecution =
  | { kind: 'answer'; message: string }
  | { kind: 'toolcall'; message: string }
  | { kind: 'clarify'; message: string; clarifications: Clarification[] }
  | { kind: 'freeform' };

const READ_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: READ_ACTIONS },
    chain: { type: 'string', enum: ['aptos', 'solana', ''] },
    scope: { type: 'string', enum: ['personal', 'company', ''] },
    account: { type: 'string' },
  },
  required: ['action'],
};

async function classifyReadIntent(
  question: string,
  accounts: ReturnType<typeof getLatestBalances>,
  modelType: ModelId,
  aiContext?: AiContext | null
): Promise<{ intent: ReadIntent; stats?: InferenceStats }> {
  const systemPrompt = `You classify a personal-finance READ question into ONE action. Return JSON only.
Actions:
- count_wallets: HOW MANY wallets/accounts (a count). e.g. "how many aptos wallets".
- wallet_balance: total balance of crypto wallets, optionally for one chain.
- list_wallets: show the list of wallets.
- account_balance: balance of ONE specific named account (set "account" to its name).
- largest_balance: which account holds the most.
- overview: all balances / total assets / overall financial status.
- grouped_balance: personal vs company breakdown (set "scope").
- goal_remaining: how much is left to reach the savings goal.
- payments: upcoming payments / can I cover bills.
- exchange_rate: a currency rate or conversion.
- btc_price: bitcoin price.
- freeform: advice, explanations, anything needing reasoning.
- clarify: too vague to choose (e.g. just a chain or account name with no clear verb).
Set "chain" to aptos or solana only if the user names it, else "".
Set "scope" to personal or company only if the user implies it, else "".
Set "account" to the account name only if the user names a specific account, else "".
Rules: "how many"/"сколько ... кошельков" => count_wallets. A chain name with "how much"/"balance" => wallet_balance with that chain. A bare chain/account name with no verb => clarify.`;

  const activeLine = isAccountContext(aiContext)
    ? `Active account (resolve "here"/"this"/"тут"/"здесь" to it): ${aiContext.accountName}`
    : 'Active account: none';

  const userPrompt = `Accounts:
${accounts.map((a) => `- ${a.name}`).join('\n')}

${activeLine}

Question:
${question}`;

  try {
    const response = await askLocalQVAC(systemPrompt, userPrompt, modelType, undefined, [], {
      generationParams: {
        temp: 0,
        top_p: 0.1,
        predict: 80,
        reasoning_budget: 0,
        json_schema: READ_INTENT_SCHEMA,
      },
    });
    const data = parseJsonObject(response.message) || {};
    const action: ReadIntentAction = READ_ACTIONS.includes(data.action) ? data.action : 'freeform';
    const chain = data.chain === 'aptos' || data.chain === 'solana' ? data.chain : null;
    const scope = data.scope === 'personal' || data.scope === 'company' ? data.scope : null;
    const account = typeof data.account === 'string' && data.account.trim() ? data.account.trim() : null;
    return { intent: { action, chain, scope, account }, stats: response.stats };
  } catch (error) {
    console.warn('[MuffinAI] Read intent classification failed:', error);
    return { intent: { action: 'freeform' } };
  }
}

function buildClarification(
  chain: WalletChain | null | undefined,
  isRussian: boolean
): ReadExecution {
  if (chain) {
    const label = chainLabel(chain);
    const clarifications: Clarification[] = isRussian
      ? [
          { label: `Сколько ${label}-кошельков`, prompt: `How many ${label} wallets do I have?` },
          { label: `Баланс ${label}`, prompt: `What is my total ${label} balance?` },
          { label: `Список ${label}`, prompt: `List my ${label} wallets` },
        ]
      : [
          { label: `How many ${label} wallets`, prompt: `How many ${label} wallets do I have?` },
          { label: `${label} balance`, prompt: `What is my total ${label} balance?` },
          { label: `List ${label} wallets`, prompt: `List my ${label} wallets` },
        ];
    return {
      kind: 'clarify',
      message: isRussian ? `Что показать по ${label}?` : `What would you like to know about ${label}?`,
      clarifications,
    };
  }

  const clarifications: Clarification[] = isRussian
    ? [
        { label: 'Все балансы', prompt: 'What is my current financial status?' },
        { label: 'Где больше всего', prompt: 'Which account has the most money?' },
        { label: 'Сколько до цели', prompt: 'How much is left until my goal?' },
      ]
    : [
        { label: 'All balances', prompt: 'What is my current financial status?' },
        { label: 'Biggest account', prompt: 'Which account has the most money?' },
        { label: 'Goal progress', prompt: 'How much is left until my goal?' },
      ];
  return {
    kind: 'clarify',
    message: isRussian ? 'Уточни, что показать:' : 'What would you like to see?',
    clarifications,
  };
}

function executeReadIntent(
  intent: ReadIntent,
  question: string,
  accounts: ReturnType<typeof getLatestBalances>,
  isRussian: boolean,
  aiContext?: AiContext | null
): ReadExecution {
  const chains: WalletChain[] = intent.chain ? [intent.chain] : [];
  const walletFilter = chains.length ? chains : null;

  switch (intent.action) {
    case 'btc_price':
      return { kind: 'toolcall', message: commandToToolCall({ action: 'btc_price', confidence: 1 }) };

    case 'count_wallets':
      return {
        kind: 'answer',
        message: buildWalletCountAnswer(getPublicWalletAccounts(accounts, walletFilter), isRussian, chains),
      };

    case 'wallet_balance':
    case 'list_wallets':
      return {
        kind: 'answer',
        message: buildWalletScopeAnswer(getPublicWalletAccounts(accounts, walletFilter), isRussian, chains),
      };

    case 'largest_balance':
      return { kind: 'answer', message: buildLargestBalanceAnswer(accounts, isRussian) };

    case 'overview':
      return { kind: 'answer', message: buildOverviewAnswer(accounts, isRussian) };

    case 'grouped_balance':
      return { kind: 'answer', message: buildGroupedBalanceAnswer(isRussian) };

    case 'goal_remaining': {
      const message = buildGoalRemainingAnswer(accounts, isRussian);
      return message ? { kind: 'answer', message } : { kind: 'freeform' };
    }

    case 'payments':
      return { kind: 'answer', message: buildPaymentCoverageAnswer(question, isRussian) };

    case 'exchange_rate': {
      const rate = answerExchangeRateQuestion(normalizeQuestion(question));
      return rate ? { kind: 'answer', message: rate } : { kind: 'freeform' };
    }

    case 'account_balance': {
      const match = findMatchingAccount(normalizeQuestion(intent.account || question), accounts);
      if (match.account && match.confidence >= 0.6) {
        return { kind: 'answer', message: buildAccountBalanceAnswer(match.account, isRussian) };
      }
      const ctxAccount = getContextAccount(accounts, aiContext);
      if (ctxAccount) {
        return { kind: 'answer', message: buildAccountBalanceAnswer(ctxAccount, isRussian) };
      }
      return buildClarification(intent.chain, isRussian);
    }

    case 'clarify':
      return buildClarification(intent.chain, isRussian);

    case 'freeform':
    default:
      return { kind: 'freeform' };
  }
}

export async function askMuffinAi(
  question: string,
  modelType: ModelId = DEFAULT_MODEL_ID,
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[],
  aiContext?: AiContext | null
): Promise<{ message: string; stats?: InferenceStats; clarifications?: Clarification[] }> {
  const accounts = getLatestBalances();
  const langSetting = getSetting('language', 'ru');
  const isRussian = langSetting === 'ru';

  // 1. WRITE extraction for command-like text. The local model maps natural
  // language onto the account list, then deterministic validation gates the
  // result before any tool card is shown.
  if (isPotentialCommand(question)) {
    const { result: structuredResult, stats: structuredStats } = await askStructuredCommandFallback(question, accounts, modelType, chatHistory, aiContext);
    if (structuredResult.kind === 'command') {
      console.log(`[MuffinAI] Structured command parsed: ${structuredResult.command.action}`);
      return { message: commandToToolCall(structuredResult.command), stats: structuredStats };
    }
    if (structuredResult.kind === 'clarify') {
      return { message: structuredResult.message, stats: structuredStats };
    }
  }

  // 2. Deterministic fallback if the structured extractor is unavailable.
  const parsedCommand = parseFinanceCommand(question, accounts, chatHistory, aiContext);
  if (parsedCommand) {
    console.log(`[MuffinAI] Deterministic command parsed: ${parsedCommand.action}`);
    return { message: commandToToolCall(parsedCommand) };
  }

  // 3a. High-precision deterministic shortcut for the clearest read — counting
  // wallets. Guarantees the flagship "how many X wallets" works instantly and
  // never depends on the 3B classifier (which can misroute it to freeform).
  const normalized = normalizeQuestion(question);
  if (isPaymentQuestion(normalized)) {
    console.log('[MuffinAI] payment coverage shortcut.');
    return {
      message: buildPaymentCoverageAnswer(question, isRussian),
      stats: instantStats(),
    };
  }

  if (
    isCountQuestion(normalized) &&
    (getMentionedChains(normalized).length > 0 || /\bwallets?\b/.test(normalized) || normalized.includes('кошел'))
  ) {
    const chains = getMentionedChains(normalized);
    const wallets = getPublicWalletAccounts(accounts, chains.length ? chains : null);
    console.log(
      `[MuffinAI] count shortcut. chains=${chains.join(',') || 'all'}, matched=${wallets.length}. ` +
        `All: ${accounts.map((a) => `${a.name}[src=${a.source}]`).join(' | ')}`
    );
    return { message: buildWalletCountAnswer(wallets, isRussian, chains) };
  }

  // 3b. READ router: model classifies the intent, deterministic code runs the
  // SQLite query. Ambiguous questions return tappable clarification chips.
  const { intent, stats: intentStats } = await classifyReadIntent(question, accounts, modelType, aiContext);
  console.log(`[MuffinAI] Read intent: ${intent.action}${intent.chain ? ` (${intent.chain})` : ''}`);
  const execution = executeReadIntent(intent, question, accounts, isRussian, aiContext);
  if (execution.kind === 'answer' || execution.kind === 'toolcall') {
    return { message: execution.message, stats: intentStats };
  }
  if (execution.kind === 'clarify') {
    return { message: execution.message, stats: intentStats, clarifications: execution.clarifications };
  }
  // execution.kind === 'freeform' → fall through to the full advice LLM below.

  const context = buildContextString(aiContext);

  let instructions = '';
  if (isRussian) {
    instructions = `You are a private local financial assistant on iPhone. You MUST respond in Russian. Keep answers concise.
Tool calls allowed:
- [TOOL_CALL: BTC_PRICE] (для запроса цены BTC)
- [TOOL_CALL: UPDATE_BALANCE: {"accountId": "ACCOUNT_ID", "amount": NUMBER, "currency": "CURRENCY", "type": "add"|"subtract"|"set"}] (для изменения баланса)
- [TOOL_CALL: UPDATE_GOAL: {"targetValue": NUMBER, "title": "GOAL_TITLE", "currency": "USD"}] (для целей сбережений)

UPDATE_BALANCE Type Rules:
0. Account creation and account rename are disabled in chat. If the user asks to create/open/add a new account or rename one, reply with text telling them to use the Accounts UI.
1. UPDATE_BALANCE is ONLY for existing accounts from LOCAL FINANCIAL MEMORY. The account name must clearly match an account ID from the context.
2. Never update another existing account just because the requested account is missing or the currency matches. If the named account is not in the list, answer with text asking which existing account to use.
3. "type": "set" is DEFAULT для сообщения баланса/состояния счета (e.g. "на Bybit X", "баланс X", "теперь X", "установи X", "сделай X").
4. "type": "add" ONLY для пополнения/получения (e.g. "добавь X", "плюс X", "пришло X", "получил X", "пополнил X", "зачислили X").
5. "type": "subtract" ONLY для списания/траты (e.g. "потратил X", "минус X", "купил за X", "списал X", "оплатил X", "вывел X", "снял X").
6. CORRECTION RULE: Если пользователь вводит только число/коррекцию (e.g. "567", "нет, 567"), и предыдущим шагом был UPDATE_BALANCE, повторите UPDATE_BALANCE для того же счета с новым amount и "type": "set".

Выводите ТОЛЬКО TOOL_CALL, если уверены, без текста. Для обычных вопросов (e.g. "сколько осталось до цели?") отвечайте текстом.
CRITICAL: Не копируйте числа из примеров. Вычисляйте динамически по LOCAL FINANCIAL MEMORY. Остаток до цели = (Goal Target - Total Assets) рассчитывайте точно.
Если пользователь называет блокчейн/сеть вроде Aptos или Solana, суммируйте все подходящие счета из LOCAL FINANCIAL MEMORY, а не только первый совпавший счет.

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
0. Account creation and account rename are disabled in chat. If the user asks to create/open/add a new account or rename one, reply with text telling them to use the Accounts UI.
1. UPDATE_BALANCE is ONLY for existing accounts from LOCAL FINANCIAL MEMORY. The account name must clearly match an account ID from the context.
2. Never update another existing account just because the requested account is missing or the currency matches. If the named account is not in the list, reply with text asking which existing account to use.
3. "type": "set" is DEFAULT for reporting balance/account state (e.g. "on Bybit X", "my balance is X", "set balance to X", "make it X").
4. "type": "add" ONLY for depositing/receiving (e.g. "add X", "plus X", "received X", "topped up X").
5. "type": "subtract" ONLY for spending/withdrawing (e.g. "spent X", "minus X", "paid X", "bought X", "charged X").
6. CORRECTION RULE: If user provides only a number/correction (e.g. "567", "no, 567"), and the last turn was a balance tool call, repeat UPDATE_BALANCE for the same account with the new amount and "type": "set".

Only output the TOOL_CALL if sure, without any conversational text. For chat questions (e.g. "how much is left?"), reply in plain text.
CRITICAL: Never copy numbers from examples. Use LOCAL FINANCIAL MEMORY. Compute remaining goal as (Goal Target - Total Assets) accurately.
If the user names a blockchain/network such as Aptos or Solana, summarize all matching accounts from LOCAL FINANCIAL MEMORY, not just the first matching account.

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
  // Enable the on-disk KV cache so multi-turn chats reuse the prefilled prefix
  // (system prompt + prior turns) instead of reprocessing it every message.
  // A miss is harmless — it just falls back to a full prefill.
  return await askLocalQVAC(instructions, userPrompt, modelType, onChunk, chatHistory, {
    kvCache: true,
  });
}

export async function continueMuffinAi(
  originalQuestion: string, 
  systemMessage: string, 
  modelType: ModelId = DEFAULT_MODEL_ID,
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ message: string; stats?: InferenceStats }> {
  const context = buildContextString();
  const langSetting = getSetting('language', 'ru');
  const isRussian = langSetting === 'ru';

  const instructions = isRussian
    ? `Вы — локальный финансовый помощник на iPhone. Отвечайте на русском языке. Ответы должны быть краткими.`
    : `You are a private local AI on an iPhone. Keep answers concise.`;
  
  const userPrompt = `${context}\n\nUSER QUESTION:\n${originalQuestion}\n\n${systemMessage}`;
  
  console.log(`Continuing prompt to Edge AI (Model: ${modelType})...`);
  return await askLocalQVAC(instructions, userPrompt, modelType, onChunk, chatHistory, {
    kvCache: true,
  });
}
