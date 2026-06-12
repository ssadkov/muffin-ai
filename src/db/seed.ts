import { db, getFirst } from './database';

export function seedDatabase() {
  const result = getFirst('SELECT count(*) as count FROM accounts;');
  if (result && result.count > 0) {
    try {
      const kaspiSnap = getFirst("SELECT currency FROM balance_snapshots WHERE account_id = 'acc_kaspi' ORDER BY created_at ASC LIMIT 1;");
      if (kaspiSnap && kaspiSnap.currency === 'USD') {
        console.log('Fixing old incorrect seeded USD snapshot for Kaspi Gold...');
        db.runSync("UPDATE balance_snapshots SET amount = 1100000, currency = 'KZT', usd_value = 2420.00 WHERE account_id = 'acc_kaspi';");
      }
      
      // Fix snapshot sources that were incorrectly recorded as 'screenshot' for non-screenshot accounts
      console.log('Running migration to correct snapshot sources...');
      db.runSync(`
        UPDATE balance_snapshots
        SET source = (SELECT source FROM accounts WHERE accounts.id = balance_snapshots.account_id)
        WHERE source = 'screenshot'
          AND account_id IN (
            SELECT id FROM accounts
            WHERE source != 'screenshot'
          );
      `);

      // Fix snapshots and accounts that got saved with '₽' symbol instead of 'RUB'
      console.log('Running migration to correct Russian Ruble symbols...');
      db.runSync("UPDATE balance_snapshots SET currency = 'RUB' WHERE currency = '₽' OR currency = 'РУБ';");
      db.runSync("UPDATE accounts SET currency = 'RUB' WHERE currency = '₽' OR currency = 'РУБ';");
      
      // Update USD value for any RUB snapshots that got saved with incorrect 1:1 rate
      const rubRateRow = getFirst("SELECT rate_to_usd FROM exchange_rates WHERE currency = 'RUB';");
      const rubRate = rubRateRow ? rubRateRow.rate_to_usd : 0.011;
      db.runSync(`
        UPDATE balance_snapshots
        SET usd_value = amount * ?
        WHERE currency = 'RUB' AND ABS(usd_value - amount) < 0.001 AND amount > 0;
      `, [rubRate]);
    } catch (e) {
      console.error('Migration error:', e);
    }
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
    ['snap_kaspi', 'acc_kaspi', 1100000, 'KZT', 2420, 'screenshot', 0.9, now]
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

  // Exchange Rates Initial Fallbacks
  const fallbackRates = [
    ['USD', 1.0],
    ['EUR', 1.08],
    ['RUB', 0.011],
    ['KZT', 0.0022],
    ['BTC', 68000.0],
    ['ETH', 3500.0],
    ['SOL', 150.0],
    ['APT', 8.5]
  ];
  for (const [curr, rate] of fallbackRates) {
    db.runSync(
      'INSERT OR IGNORE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, ?, ?)',
      [curr, rate, now]
    );
  }

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
