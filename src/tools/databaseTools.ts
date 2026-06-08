import { getAll } from '../db/database';

export function listAccounts() {
  return getAll('SELECT * FROM accounts');
}

export function getLatestBalances() {
  // Simple approximation: join accounts and latest balance
  return getAll(`
    SELECT a.id, a.name, a.source, b.amount, b.currency, b.usd_value, b.created_at
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
