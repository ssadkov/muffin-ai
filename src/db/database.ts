import * as SQLite from 'expo-sqlite';

// Open the database synchronously. This is the recommended API for Expo SDK 50+ and v56.
export const db = SQLite.openDatabaseSync('muffin.db');

// Helper to execute SQL queries.
export function executeSql(sql: string, params: any[] = []): any {
  return db.runSync(sql, params);
}

export function getAll(sql: string, params: any[] = []): any[] {
  return db.getAllSync(sql, params);
}

export function getFirst(sql: string, params: any[] = []): any {
  return db.getFirstSync(sql, params);
}

export function getRatesMap(): { [key: string]: number } {
  try {
    const rows = getAll('SELECT currency, rate_to_usd FROM exchange_rates');
    const map: { [key: string]: number } = {};
    rows.forEach((r: any) => {
      map[r.currency.toUpperCase()] = r.rate_to_usd;
    });
    return map;
  } catch (e) {
    console.error("Error reading exchange rates from DB", e);
    // fallback
    return {
      USD: 1.0,
      EUR: 1.08,
      RUB: 0.011,
      KZT: 0.0022,
      BTC: 68000.0,
      ETH: 3500.0,
      SOL: 150.0,
      APT: 8.5
    };
  }
}

