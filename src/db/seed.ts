import { db, getFirst } from './database';

export function seedDatabase() {
  const result = getFirst('SELECT count(*) as count FROM accounts;');
  if (result && result.count > 0) {
    return; // Already seeded
  }

  console.log('Seeding demo database...');

  const now = new Date().toISOString();

  // Accounts
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_aptos', 'Aptos Wallet', 'crypto_wallet', 'aptos_public_wallet', 'USD', 'demo_aptos_address', null, now]
  );
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_solana', 'Solana Wallet', 'crypto_wallet', 'solana_public_wallet', 'USD', 'demo_solana_address', null, now]
  );
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_okx', 'OKX Account', 'exchange', 'exchange_readonly', 'USD', null, null, now]
  );
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_bybit', 'Bybit Card', 'crypto_card', 'manual', 'USD', null, null, now]
  );
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_kaspi', 'Kaspi Gold', 'bank', 'screenshot', 'KZT', null, 'kaspi://', now]
  );
  db.runSync(
    'INSERT INTO accounts (id, name, type, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['acc_cash', 'Cash USD', 'cash', 'manual', 'USD', null, null, now]
  );

  // Balance Snapshots
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_aptos', 'acc_aptos', 4250, 'USD', 4250, 'aptos_public_wallet', 1.0, now]
  );
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_solana', 'acc_solana', 1130, 'USD', 1130, 'solana_public_wallet', 1.0, now]
  );
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_okx', 'acc_okx', 6800, 'USD', 6800, 'exchange_readonly', 1.0, now]
  );
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_bybit', 'acc_bybit', 760, 'USD', 760, 'manual', 1.0, now]
  );
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_kaspi', 'acc_kaspi', 2420, 'USD', 2420, 'screenshot', 0.9, now]
  );
  db.runSync(
    'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['snap_cash', 'acc_cash', 3060, 'USD', 3060, 'manual', 1.0, now]
  );

  // Goals
  db.runSync(
    'INSERT INTO goals (id, title, target_value, currency, created_at) VALUES (?, ?, ?, ?, ?)',
    ['goal_1', 'Reach $100,000 in liquid assets', 100000, 'USD', now]
  );

  // Rules
  db.runSync(
    'INSERT INTO rules (id, title, rule_text, rule_type, threshold_value, threshold_currency, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['rule_1', 'Crypto cards should not hold more than $500.', 'Crypto cards limit', 'crypto_card_max_balance', 500, 'USD', 'warning', now]
  );
  db.runSync(
    'INSERT INTO rules (id, title, rule_text, rule_type, threshold_value, threshold_currency, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['rule_2', 'Balances should be updated at least weekly.', 'Stale balance check', 'stale_balance_check', 7, 'days', 'info', now]
  );
}
