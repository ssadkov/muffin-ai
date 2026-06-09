import { getAll, executeSql, getFirst } from '../db/database';

export function upsertAccountBalance(
  name: string,
  amount: number,
  currency: string,
  rawText?: string,
  screenshotPath?: string
) {
  const now = new Date().toISOString();
  
  // 1. Find account by name
  let account = getFirst('SELECT * FROM accounts WHERE name = ? COLLATE NOCASE', [name]);
  
  let accountId: string;
  if (!account) {
    // Create new account
    accountId = 'acc_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    executeSql(
      'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [accountId, name, 'bank', 'screenshot', currency, null, null, now]
    );
  } else {
    accountId = account.id;
  }
  
  // 2. Insert new balance snapshot
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const usdValue = estimateUsdValue(amount, currency);
  
  executeSql(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, raw_text, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [snapshotId, accountId, amount, currency, usdValue, 'screenshot', 0.95, rawText || null, screenshotPath || null, now]
  );
  
  return { accountId, snapshotId, usdValue };
}

function estimateUsdValue(amount: number, currency: string): number {
  const upper = currency.toUpperCase();
  if (upper === 'USD') return amount;
  if (upper === 'EUR') return amount * 1.08;
  if (upper === 'GBP') return amount * 1.27;
  if (upper === 'RUB') return amount * 0.011;
  if (upper === 'KZT') return amount * 0.0022;
  return amount; // default fallback
}

export function convertCurrency(amount: number, from: string, to: string): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  
  // Convert from -> USD
  let usdValue = amount;
  if (f === 'EUR') usdValue = amount * 1.08;
  else if (f === 'GBP') usdValue = amount * 1.27;
  else if (f === 'RUB') usdValue = amount * 0.011;
  else if (f === 'KZT') usdValue = amount * 0.0022;
  
  // Convert USD -> to
  if (t === 'USD') return usdValue;
  if (t === 'EUR') return usdValue / 1.08;
  if (t === 'GBP') return usdValue / 1.27;
  if (t === 'RUB') return usdValue / 0.011;
  if (t === 'KZT') return usdValue / 0.0022;
  
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
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, 'crypto_wallet', source, 'USD', address, null, now]
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
  // Simple approximation: join accounts and latest balance
  return getAll(`
    SELECT a.id, a.name, a.source, a.address, b.amount, b.currency, b.usd_value, b.created_at
    FROM accounts a
    LEFT JOIN balance_snapshots b ON a.id = b.account_id
    WHERE b.id IN (
      SELECT id FROM balance_snapshots
      GROUP BY account_id
      HAVING max(created_at)
    )
  `);
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

export function getActiveGoals() {
  return getAll('SELECT * FROM goals WHERE is_active = 1');
}

export function getActiveRules() {
  return getAll('SELECT * FROM rules WHERE is_active = 1');
}
