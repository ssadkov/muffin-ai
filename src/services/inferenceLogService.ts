import * as FileSystem from 'expo-file-system/legacy';

const LOG_FILE_NAME = 'inference_audit_log.json';
const LOG_FILE_PATH = `${FileSystem.documentDirectory}${LOG_FILE_NAME}`;

/** Keep at most this many entries on disk; older ones are dropped (FIFO). */
const MAX_LOG_ENTRIES = 200;
/** Truncate very long prompt/response text so a single entry can't bloat the file. */
const MAX_FIELD_CHARS = 4000;

function truncateField(value: string): string {
  if (typeof value !== 'string' || value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS)}…[truncated ${value.length - MAX_FIELD_CHARS} chars]`;
}

export interface ModelLoadLog {
  type: 'model_load' | 'model_unload';
  modelName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface InferenceLog {
  type: 'inference';
  modelName: string;
  prompt: string;
  response: string;
  tokenCount: number;
  ttftMs: number;
  generationTimeMs: number;
  tokensPerSec: number;
  timestamp: string;
}

export type AuditLog = ModelLoadLog | InferenceLog;

export type AuditLogInput = 
  | Omit<ModelLoadLog, 'timestamp'>
  | Omit<InferenceLog, 'timestamp'>;

/**
 * Persist an audit log to the app's local document directory.
 */
export function addAuditLog(log: AuditLogInput): void {
  const timestamp = new Date().toISOString();
  const rawLog = { ...log, timestamp } as AuditLog;

  // Cap the largest fields (prompt embeds the full financial context; response
  // can be long) so no single entry can bloat the file.
  const fullLog: AuditLog = rawLog.type === 'inference'
    ? { ...rawLog, prompt: truncateField(rawLog.prompt), response: truncateField(rawLog.response) }
    : rawLog;

  // Fire-and-forget: never block the chat response on disk I/O. Errors are
  // logged but swallowed so a logging failure can't break inference.
  void (async () => {
    try {
      const logs = await getAuditLogs();
      logs.push(fullLog);

      // FIFO rotation: keep only the most recent MAX_LOG_ENTRIES so the file
      // (which persists across app launches) stays bounded over time.
      const bounded = logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs;

      await FileSystem.writeAsStringAsync(LOG_FILE_PATH, JSON.stringify(bounded, null, 2));
      console.log("[Audit Logger] Log entry saved successfully to:", LOG_FILE_PATH);
    } catch (error) {
      console.error("[Audit Logger] Failed to save audit log:", error);
    }
  })();
}

/**
 * Retrieve all persisted audit logs.
 */
export async function getAuditLogs(): Promise<AuditLog[]> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(LOG_FILE_PATH);
    if (!fileInfo.exists) {
      return [];
    }
    const content = await FileSystem.readAsStringAsync(LOG_FILE_PATH);
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[Audit Logger] Error reading audit logs, returning empty array:", error);
    return [];
  }
}

/**
 * Clear all audit logs from the device.
 */
export async function clearAuditLogs(): Promise<void> {
  try {
    await FileSystem.deleteAsync(LOG_FILE_PATH, { idempotent: true });
    console.log("[Audit Logger] Audit logs cleared.");
  } catch (error) {
    console.error("[Audit Logger] Failed to clear audit logs:", error);
  }
}

/**
 * Exports the logs path and formatted JSON string.
 */
export async function exportAuditLogs(): Promise<{ path: string; content: string }> {
  const logs = await getAuditLogs();
  return {
    path: LOG_FILE_PATH,
    content: JSON.stringify(logs, null, 2)
  };
}
