import { db, getFirst } from './database';

function ensureAccountMetadataColumns() {
  const columns = db.getAllSync('PRAGMA table_info(accounts);') as Array<{ name: string }>;
  const hasColumn = (name: string) => columns.some((column) => column.name === name);
  if (!hasColumn('owner_type')) {
    console.log('Adding owner_type column to accounts...');
    db.runSync("ALTER TABLE accounts ADD COLUMN owner_type TEXT DEFAULT 'personal';");
  }
  if (!hasColumn('model_note')) {
    console.log('Adding model_note column to accounts...');
    db.runSync('ALTER TABLE accounts ADD COLUMN model_note TEXT;');
  }
  if (!hasColumn('ownership_percent')) {
    console.log('Adding ownership_percent column to accounts...');
    db.runSync('ALTER TABLE accounts ADD COLUMN ownership_percent REAL DEFAULT 100;');
  }
  db.runSync("UPDATE accounts SET owner_type = 'personal' WHERE owner_type IS NULL OR owner_type = '';");
  db.runSync('UPDATE accounts SET ownership_percent = 100 WHERE ownership_percent IS NULL OR ownership_percent <= 0;');
}

function ensureAccountWithSnapshot(
  id: string,
  name: string,
  type: string,
  ownerType: 'personal' | 'company',
  modelNote: string,
  ownershipPercent: number,
  source: string,
  currency: string,
  amount: number,
  usdValue: number,
  now: string,
  appUrl: string | null = null
) {
  const existing = getFirst('SELECT id FROM accounts WHERE id = ?;', [id]);
  if (!existing) {
    db.runSync(
      'INSERT INTO accounts (id, name, type, owner_type, model_note, ownership_percent, source, currency, address, app_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, type, ownerType, modelNote, ownershipPercent, source, currency, null, appUrl, now]
    );
  } else {
    db.runSync(
      'UPDATE accounts SET name = ?, type = ?, owner_type = ?, model_note = ?, ownership_percent = ?, source = ?, currency = ?, app_url = COALESCE(app_url, ?) WHERE id = ?',
      [name, type, ownerType, modelNote, ownershipPercent, source, currency, appUrl, id]
    );
  }

  const snapshot = getFirst('SELECT id FROM balance_snapshots WHERE account_id = ? LIMIT 1;', [id]);
  if (!snapshot) {
    db.runSync(
      'INSERT INTO balance_snapshots (id, account_id, amount, currency, usd_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`snap_${id}`, id, amount, currency, usdValue, source, 1.0, now]
    );
  }
}

function ensurePersonalAccounts(now: string) {
  ensureAccountWithSnapshot(
    'acc_bcc_personal_kzt',
    'BCC Personal KZT',
    'bank',
    'personal',
    'Personal CenterCredit/BCC KZT bank account. Use for personal KZT balances, not company money.',
    100,
    'manual',
    'KZT',
    0,
    0,
    now
  );
}

function ensureCompanyAccounts(now: string) {
  ensureAccountWithSnapshot('acc_company_paypal', 'Company PayPal', 'paypal', 'company', 'Company PayPal account. Treat as company USD money.', 40, 'manual', 'USD', 0, 0, now);
  ensureAccountWithSnapshot('acc_company_bcc_kzt', 'Company BCC Центркредитбанк KZT', 'bank', 'company', 'Company BCC/CenterCredit account in KZT. Do not confuse with personal BCC.', 40, 'manual', 'KZT', 0, 0, now);
  ensureAccountWithSnapshot('acc_company_kaspi_kzt', 'Company Kaspi KZT', 'bank', 'company', 'Company Kaspi account in KZT. Do not confuse with personal Kaspi Gold.', 40, 'manual', 'KZT', 0, 0, now, 'kaspi://');
  ensureAccountWithSnapshot('acc_company_tbank_rub', 'Company T-Bank RU', 'bank', 'company', 'Company T-Bank account in RUB. User economic share is 40%.', 40, 'manual', 'RUB', 0, 0, now);
  ensureAccountWithSnapshot('acc_company_alfa_rub', 'Company Alfa Bank RU', 'bank', 'company', 'Company Alfa Bank account in RUB. User economic share is 40%.', 40, 'manual', 'RUB', 0, 0, now);
}

function ensureAccountNotes() {
  const notes: Array<[string, string, number]> = [
    ['acc_aptos', 'Personal Aptos wallet. Use for personal crypto portfolio and on-chain DeFi balances.', 100],
    ['acc_solana', 'Personal Solana wallet. Use for personal crypto portfolio balances.', 100],
    ['acc_okx', 'Personal OKX exchange account in USD equivalent.', 100],
    ['acc_bybit', 'Personal Bybit card/account in USD equivalent.', 100],
    ['acc_kaspi', 'Personal Kaspi Gold account in KZT. Do not confuse with Company Kaspi.', 100],
    ['acc_cash', 'Personal cash reserve in USD.', 100],
  ];
  for (const [id, note, ownershipPercent] of notes) {
    db.runSync(
      'UPDATE accounts SET model_note = COALESCE(model_note, ?), ownership_percent = COALESCE(ownership_percent, ?) WHERE id = ?',
      [note, ownershipPercent, id]
    );
  }
  db.runSync(`
    UPDATE accounts
    SET model_note = CASE
      WHEN owner_type = 'company' THEN COALESCE(model_note, 'Company account. Keep separate from personal money.')
      ELSE COALESCE(model_note, 'Personal account. Use for personal balances.')
    END
    WHERE model_note IS NULL OR model_note = '';
  `);
}

function ensurePaymentObligation(
  id: string,
  title: string,
  ownerType: 'personal' | 'company',
  amount: number,
  currency: string,
  dueDay: number,
  accountId: string | null,
  remindDaysBefore: number,
  modelNote: string,
  now: string
) {
  db.runSync(
    `INSERT OR IGNORE INTO payment_obligations
      (id, title, owner_type, amount, currency, due_day, frequency, account_id, remind_days_before, model_note, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, 1, ?)`,
    [id, title, ownerType, amount, currency, dueDay, accountId, remindDaysBefore, modelNote, now]
  );
}

function ensurePaymentObligations(now: string) {
  ensurePaymentObligation(
    'pay_personal_mortgage_kzt',
    'Ипотека',
    'personal',
    450000,
    'KZT',
    25,
    'acc_kaspi',
    5,
    'Monthly personal mortgage payment in KZT. Usually paid from personal Kaspi.',
    now
  );
  ensurePaymentObligation(
    'pay_personal_alfa_credit_rub',
    'Кредит Альфа',
    'personal',
    120000,
    'RUB',
    10,
    null,
    3,
    'Personal RUB loan payment. Check RUB liquidity and suggest conversion if RUB is short.',
    now
  );
  ensurePaymentObligation(
    'pay_company_tbank_credit_rub',
    'Company T-Bank кредит',
    'company',
    250000,
    'RUB',
    15,
    'acc_company_tbank_rub',
    3,
    'Company RUB credit payment. Cover from company RUB accounts first.',
    now
  );
  ensurePaymentObligation(
    'pay_company_kaspi_tax_kzt',
    'Company KZT налоги',
    'company',
    300000,
    'KZT',
    20,
    'acc_company_kaspi_kzt',
    5,
    'Company KZT tax reserve. Cover from company KZT accounts first.',
    now
  );
}

export function seedDatabase() {
  const now = new Date().toISOString();
  ensureAccountMetadataColumns();

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

      ensurePersonalAccounts(now);
      ensureCompanyAccounts(now);
      ensureAccountNotes();
      ensurePaymentObligations(now);
    } catch (e) {
      console.error('Migration error:', e);
    }
    return; // Already seeded
  }

  console.log('Seeding demo database...');

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
  ensurePersonalAccounts(now);
  ensureCompanyAccounts(now);
  ensureAccountNotes();

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

  ensurePaymentObligations(now);
}
