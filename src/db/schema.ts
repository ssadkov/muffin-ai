import { db } from './database';

export function initializeDatabase() {
  db.execSync(`
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

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      target_value REAL NOT NULL,
      currency TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      currency TEXT PRIMARY KEY,
      rate_to_usd REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
