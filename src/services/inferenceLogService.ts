import * as FileSystem from 'expo-file-system/legacy';

const LOG_FILE_NAME = 'inference_audit_log.json';
const LOG_FILE_PATH = `${FileSystem.documentDirectory}${LOG_FILE_NAME}`;

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
export async function addAuditLog(log: AuditLogInput): Promise<void> {
  const timestamp = new Date().toISOString();
  const fullLog: AuditLog = { ...log, timestamp } as AuditLog;

  try {
    const logs = await getAuditLogs();
    logs.push(fullLog);
    
    // Write back to file system
    await FileSystem.writeAsStringAsync(LOG_FILE_PATH, JSON.stringify(logs, null, 2));
    console.log("[Audit Logger] Log entry saved successfully to:", LOG_FILE_PATH);
  } catch (error) {
    console.error("[Audit Logger] Failed to save audit log:", error);
  }
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
