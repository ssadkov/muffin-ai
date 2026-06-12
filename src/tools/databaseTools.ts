import { getAll, executeSql, getFirst, getRatesMap } from '../db/database';
import { saveExchangeCredentials, deleteExchangeCredentials, getExchangeCredentials } from '../services/secureStoreService';
import { fetchBybitBalance } from '../services/bybitService';

export { getRatesMap };

export type OwnerType = 'personal' | 'company';

export function normalizeCurrency(currency: string | null | undefined): string {
  if (!currency) return 'USD';
  const clean = currency.trim().toUpperCase();
  switch (clean) {
    case '$':
    case 'USD':
      return 'USD';
    case '₽':
    case 'RUB':
    case 'RUR':
    case 'РУБ':
    case 'РУБ.':
      return 'RUB';
    case '₸':
    case 'KZT':
    case 'ТГ':
    case 'ТЕНГЕ':
      return 'KZT';
    case '€':
    case 'EUR':
    case 'ЕВРО':
      return 'EUR';
    default:
      return clean;
  }
}

function estimateUsdValue(amount: number | null | undefined, currency: string | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const curr = normalizeCurrency(currency);
  const rates = getRatesMap();
  const rate = rates[curr];
  if (rate !== undefined) {
    return amount * rate;
  }
  return amount; // default fallback
}

export function convertCurrency(amount: number, from: string, to: string): number {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) return amount;
  
  const rates = getRatesMap();
  
  // Convert from -> USD
  const fromRate = rates[f];
  const usdValue = fromRate !== undefined ? amount * fromRate : amount;
  
  // Convert USD -> to
  const toRate = rates[t];
  if (toRate !== undefined && toRate > 0) {
    return usdValue / toRate;
  }
  
  return amount; // fallback
}

export function executeBalanceUpdate(
  accountId: string,
  amount: number,
  currency: string,
  operation: 'add' | 'subtract' | 'set'
) {
  const now = new Date().toISOString();
  
  const account = getFirst('SELECT name, currency FROM accounts WHERE id = ?', [accountId]);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }
  
  const latestSnapshot = getFirst(
    'SELECT amount, currency FROM balance_snapshots WHERE account_id = ? ORDER BY created_at DESC LIMIT 1',
    [accountId]
  );
  
  const currentAmount = latestSnapshot ? latestSnapshot.amount : 0;
  const accountCurrency = account.currency || 'USD';
  
  let newAmount: number;
  if (operation === 'set') {
    newAmount = convertCurrency(amount, currency, accountCurrency);
  } else {
    const changeInAccountCurrency = convertCurrency(amount, currency, accountCurrency);
    if (operation === 'add') {
      newAmount = currentAmount + changeInAccountCurrency;
    } else if (operation === 'subtract') {
      newAmount = currentAmount - changeInAccountCurrency;
    } else {
      newAmount = currentAmount;
    }
  }
  
  const usdValue = estimateUsdValue(newAmount, accountCurrency);
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  
  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, accountId, newAmount, accountCurrency, usdValue, 'manual', 1.0, now]
  );
  
  return {
    accountName: account.name,
    newAmount,
    currency: accountCurrency,
    newUsdValue: usdValue
  };
}

export function updateAccountAddress(id: string, address: string) {
  executeSql(
    'UPDATE accounts SET address = ? WHERE id = ?',
    [address, id]
  );
}

export function createWalletAccount(name: string, source: string, address: string) {
  const now = new Date().toISOString();
  const id = 'acc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  
  executeSql(
    'INSERT INTO accounts (id, name, type, owner_type, model_note, ownership_percent, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, 'crypto_wallet', 'personal', 'Personal crypto wallet created by the user.', 100, source, 'USD', address, null, now]
  );
  
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, id, 0, 'USD', 0, source, 1.0, now]
  );
  
  return id;
}

export function listAccounts() {
  return getAll('SELECT * FROM accounts');
}

export function getLatestBalances() {
  // Retrieve the latest balance snapshot for each account by selecting the snapshot ID
  // with the maximum creation timestamp for that account.
  const rows = getAll(`
    SELECT a.id, a.name, a.type, a.owner_type, a.model_note, a.ownership_percent, a.source, a.address, b.amount, b.currency, b.usd_value, b.created_at
    FROM accounts a
    LEFT JOIN balance_snapshots b ON a.id = b.account_id
    WHERE b.id = (
      SELECT id FROM balance_snapshots b2
      WHERE b2.account_id = a.id
      ORDER BY b2.created_at DESC
      LIMIT 1
    ) OR b.id IS NULL
  `);
  
  return rows
    .map((r: any) => {
      const usdValue = parseFloat(estimateUsdValue(r.amount, r.currency).toFixed(2));
      const ownershipPercent = Number(r.ownership_percent ?? 100);
      return {
        ...r,
        owner_type: r.owner_type || 'personal',
        ownership_percent: Number.isFinite(ownershipPercent) && ownershipPercent > 0 ? ownershipPercent : 100,
        usd_value: usdValue,
        owned_usd_value: parseFloat((usdValue * ((Number.isFinite(ownershipPercent) && ownershipPercent > 0 ? ownershipPercent : 100) / 100)).toFixed(2))
      };
    })
    .sort((a, b) => b.usd_value - a.usd_value);
}

export function getTotalLiquidAssets() {
  const balances = getLatestBalances();
  let total = 0;
  for (const b of balances) {
    if (b.usd_value) {
      total += b.usd_value;
    }
  }
  return total;
}

export function getBalanceGroups() {
  const balances = getLatestBalances();
  const personal = balances.filter((item) => (item.owner_type || 'personal') !== 'company');
  const company = balances.filter((item) => item.owner_type === 'company');
  const sumUsd = (items: any[], field: 'usd_value' | 'owned_usd_value' = 'usd_value') =>
    parseFloat(items.reduce((sum, item) => sum + Number(item[field] || 0), 0).toFixed(2));

  return {
    personal,
    company,
    personalUsd: sumUsd(personal),
    companyUsd: sumUsd(company),
    companyOwnedUsd: sumUsd(company, 'owned_usd_value'),
    totalUsd: sumUsd(balances),
    totalOwnedUsd: parseFloat((sumUsd(personal) + sumUsd(company, 'owned_usd_value')).toFixed(2)),
  };
}

export function getPaymentObligations(ownerType?: OwnerType) {
  const params: any[] = [];
  let where = 'WHERE p.is_active = 1';
  if (ownerType) {
    where += ' AND p.owner_type = ?';
    params.push(ownerType);
  }

  return getAll(`
    SELECT p.*, a.name as account_name, a.currency as account_currency
    FROM payment_obligations p
    LEFT JOIN accounts a ON a.id = p.account_id
    ${where}
    ORDER BY p.due_day ASC, p.title ASC
  `, params);
}

function nextMonthlyDueDate(dueDay: number, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const clampedDay = Math.max(1, Math.min(28, Math.floor(dueDay || 1)));
  let due = new Date(year, month, clampedDay, 9, 0, 0, 0);
  if (due < now) {
    due = new Date(year, month + 1, clampedDay, 9, 0, 0, 0);
  }
  return due;
}

export function getUpcomingPaymentObligations(daysAhead = 31, ownerType?: OwnerType) {
  const now = new Date();
  const horizonMs = daysAhead * 24 * 60 * 60 * 1000;
  return getPaymentObligations(ownerType)
    .map((payment: any) => {
      const dueDate = nextMonthlyDueDate(Number(payment.due_day), now);
      const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return {
        ...payment,
        currency: normalizeCurrency(payment.currency),
        dueDate,
        due_date_iso: dueDate.toISOString(),
        days_until_due: daysUntilDue,
        usd_value: parseFloat(estimateUsdValue(Number(payment.amount || 0), payment.currency).toFixed(2)),
      };
    })
    .filter((payment: any) => payment.dueDate.getTime() - now.getTime() <= horizonMs)
    .sort((a: any, b: any) => a.dueDate.getTime() - b.dueDate.getTime());
}

function addToNestedTotals(
  totals: Record<string, Record<string, number>>,
  ownerType: string,
  currency: string,
  amount: number
) {
  if (!totals[ownerType]) totals[ownerType] = {};
  const normalizedCurrency = normalizeCurrency(currency);
  totals[ownerType][normalizedCurrency] = parseFloat(((totals[ownerType][normalizedCurrency] || 0) + amount).toFixed(2));
}

export function getPaymentCoverageSummary(daysAhead = 31, ownerType?: OwnerType) {
  const balances = getLatestBalances();
  const payments = getUpcomingPaymentObligations(daysAhead, ownerType);
  const availableByOwnerCurrency: Record<string, Record<string, number>> = {};
  const dueByOwnerCurrency: Record<string, Record<string, number>> = {};

  for (const account of balances) {
    const owner = account.owner_type || 'personal';
    if (ownerType && owner !== ownerType) continue;
    addToNestedTotals(availableByOwnerCurrency, owner, account.currency || 'USD', Number(account.amount || 0));
  }

  for (const payment of payments) {
    const owner = payment.owner_type || 'personal';
    addToNestedTotals(dueByOwnerCurrency, owner, payment.currency || 'USD', Number(payment.amount || 0));
  }

  const deficits: Array<{
    owner_type: string;
    currency: string;
    due: number;
    available: number;
    missing: number;
    missing_usd: number;
    suggested_from_currency?: string;
    suggested_from_amount?: number;
  }> = [];

  for (const [owner, dueByCurrency] of Object.entries(dueByOwnerCurrency)) {
    for (const [currency, due] of Object.entries(dueByCurrency)) {
      const available = availableByOwnerCurrency[owner]?.[currency] || 0;
      const missing = parseFloat(Math.max(0, due - available).toFixed(2));
      if (missing <= 0) continue;

      const suggestion = Object.entries(availableByOwnerCurrency[owner] || {})
        .filter(([sourceCurrency]) => sourceCurrency !== currency)
        .map(([sourceCurrency, sourceAmount]) => ({
          sourceCurrency,
          sourceAmount,
          sourceUsd: estimateUsdValue(sourceAmount, sourceCurrency),
          neededSourceAmount: convertCurrency(missing, currency, sourceCurrency),
        }))
        .filter((item) => item.sourceAmount >= item.neededSourceAmount)
        .sort((a, b) => b.sourceUsd - a.sourceUsd)[0];

      deficits.push({
        owner_type: owner,
        currency,
        due,
        available,
        missing,
        missing_usd: parseFloat(estimateUsdValue(missing, currency).toFixed(2)),
        suggested_from_currency: suggestion?.sourceCurrency,
        suggested_from_amount: suggestion ? parseFloat(suggestion.neededSourceAmount.toFixed(2)) : undefined,
      });
    }
  }

  const totalDueUsd = parseFloat(payments.reduce((sum: number, payment: any) => sum + Number(payment.usd_value || 0), 0).toFixed(2));

  return {
    daysAhead,
    payments,
    availableByOwnerCurrency,
    dueByOwnerCurrency,
    deficits,
    totalDueUsd,
    isCovered: deficits.length === 0,
  };
}

export function getActiveGoals() {
  return getAll('SELECT * FROM goals WHERE is_active = 1');
}

export function getActiveRules() {
  return getAll('SELECT * FROM rules WHERE is_active = 1');
}

export function getAccountHistory(accountId: string) {
  const rows = getAll('SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY created_at DESC', [accountId]);
  return rows.map((r: any) => {
    return {
      ...r,
      usd_value: parseFloat(estimateUsdValue(r.amount, r.currency).toFixed(2))
    };
  });
}

export function updateGoal(targetValue: number, title?: string, currency?: string) {
  const now = new Date().toISOString();
  const activeGoal = getFirst('SELECT id, title, currency FROM goals WHERE is_active = 1 LIMIT 1');
  
  if (activeGoal) {
    const newTitle = title || `Reach $${targetValue.toLocaleString()} in liquid assets`;
    const newCurrency = currency || activeGoal.currency || 'USD';
    executeSql(
      'UPDATE goals SET target_value = ?, title = ?, currency = ?, created_at = ? WHERE id = ?',
      [targetValue, newTitle, newCurrency, now, activeGoal.id]
    );
    return { id: activeGoal.id, title: newTitle, targetValue, currency: newCurrency };
  } else {
    const id = 'goal_' + Date.now();
    const newTitle = title || `Reach $${targetValue.toLocaleString()} in liquid assets`;
    const newCurrency = currency || 'USD';
    executeSql(
      'INSERT INTO goals (id, title, target_value, currency, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [id, newTitle, targetValue, newCurrency, now]
    );
    return { id, title: newTitle, targetValue, currency: newCurrency };
  }
}

export function upsertAccountBalance(
  name: string,
  amount: number,
  currency: string,
  rawText?: string,
  screenshotPath?: string,
  source?: string
) {
  const now = new Date().toISOString();
  const normCurrency = normalizeCurrency(currency);
  
  // 1. Find account by name
  let account = getFirst('SELECT * FROM accounts WHERE name = ? COLLATE NOCASE', [name]);
  
  let accountId: string;
  let resolvedSource = source;
  if (!account) {
    // Create new account
    accountId = 'acc_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    resolvedSource = resolvedSource || 'screenshot';
    executeSql(
      'INSERT INTO accounts (id, name, type, owner_type, model_note, ownership_percent, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [accountId, name, 'bank', 'personal', 'Personal account imported from OCR/screenshot.', 100, resolvedSource, normCurrency, null, null, now]
    );
  } else {
    accountId = account.id;
    resolvedSource = resolvedSource || account.source || 'screenshot';
  }
  
  // 2. Insert new balance snapshot
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const usdValue = estimateUsdValue(amount, normCurrency);
  
  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, raw_text, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, accountId, amount, normCurrency, usdValue, resolvedSource, 0.95, rawText || null, screenshotPath || null, now]
  );
  
  return { accountId, snapshotId, usdValue };
}

export async function addExchangeConnection(
  label: string,
  exchange: string,
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean
): Promise<string> {
  const now = new Date().toISOString();
  const connectionId = 'conn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

  // 1. Save keys to SecureStore
  await saveExchangeCredentials(connectionId, apiKey, apiSecret);

  // 2. Insert connection record into SQLite
  const permissions = isTestnet ? 'read_only_testnet' : 'read_only';
  executeSql(
    'INSERT INTO exchange_connections (id, exchange, label, api_key_ref, api_secret_ref, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [connectionId, exchange, label, connectionId, connectionId, permissions, now]
  );

  // 3. Create corresponding account
  const accountId = 'acc_ex_' + connectionId;
  const accountName = `${exchange.charAt(0).toUpperCase() + exchange.slice(1).toLowerCase()} (${label})`;
  executeSql(
    'INSERT INTO accounts (id, name, type, owner_type, model_note, ownership_percent, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [accountId, accountName, 'exchange', 'personal', `Personal ${exchange} exchange account connected by API.`, 100, `${exchange.toLowerCase()}_api`, 'USD', null, null, now]
  );

  // 4. Initial balance snapshot (0 USD)
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, accountId, 0, 'USD', 0, `${exchange.toLowerCase()}_api`, 1.0, now]
  );

  return accountId;
}

export async function syncExchangeBalance(accountId: string): Promise<number> {
  const now = new Date().toISOString();

  // Find the account to get the source/type
  const account = getFirst('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // Parse connection ID from account ID. The format is 'acc_ex_conn_...'
  const connectionId = accountId.replace('acc_ex_', '');
  
  // Find connection metadata
  const conn = getFirst('SELECT * FROM exchange_connections WHERE id = ?', [connectionId]);
  if (!conn) {
    throw new Error(`Exchange connection metadata not found for connection: ${connectionId}`);
  }

  // Retrieve credentials from SecureStore
  const creds = await getExchangeCredentials(connectionId);
  if (!creds) {
    throw new Error(`API credentials not found in secure storage for connection: ${connectionId}`);
  }

  let balance = 0;
  const isTestnet = conn.permissions === 'read_only_testnet';

  if (conn.exchange.toLowerCase() === 'bybit') {
    balance = await fetchBybitBalance(creds.apiKey, creds.apiSecret, isTestnet);
  } else {
    throw new Error(`Exchange ${conn.exchange} is not supported yet.`);
  }

  // Save new balance snapshot
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const usdValue = estimateUsdValue(balance, 'USD');

  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, accountId, balance, 'USD', usdValue, `${conn.exchange.toLowerCase()}_api`, 1.0, now]
  );

  return balance;
}

export async function deleteExchangeConnection(accountId: string): Promise<void> {
  const connectionId = accountId.replace('acc_ex_', '');

  // 1. Delete credentials from SecureStore
  try {
    await deleteExchangeCredentials(connectionId);
  } catch (e) {
    console.warn(`[DatabaseTools] Failed to delete credentials from SecureStore: ${e}`);
  }

  // 2. Delete from exchange_connections
  executeSql('DELETE FROM exchange_connections WHERE id = ?', [connectionId]);

  // 3. Delete balance snapshots associated with account
  executeSql('DELETE FROM balance_snapshots WHERE account_id = ?', [accountId]);

  // 4. Delete account
  executeSql('DELETE FROM accounts WHERE id = ?', [accountId]);
}

export async function syncAllExchanges(): Promise<void> {
  const accounts = getAll("SELECT id FROM accounts WHERE source LIKE '%_api' AND type = 'exchange'");
  console.log(`[Exchange Sync] Found ${accounts.length} exchange(s) to synchronize.`);

  for (const acc of accounts) {
    try {
      console.log(`[Exchange Sync] Synchronizing account: ${acc.id}`);
      await syncExchangeBalance(acc.id);
    } catch (e) {
      console.error(`[Exchange Sync] Failed to sync account ${acc.id}:`, e);
    }
  }
}

export function getSetting(key: string, defaultValue: string): string {
  try {
    const row = getFirst('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export function setSetting(key: string, value: string): void {
  executeSql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}
