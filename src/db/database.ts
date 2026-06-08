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
