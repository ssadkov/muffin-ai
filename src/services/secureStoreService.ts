import * as SecureStore from 'expo-secure-store';

/**
 * Saves exchange API key and secret securely using Expo SecureStore.
 * Key format:
 * - api_key: `ex_key_${connectionId}`
 * - api_secret: `ex_secret_${connectionId}`
 */
export async function saveExchangeCredentials(
  connectionId: string,
  apiKey: string,
  apiSecret: string
): Promise<void> {
  try {
    await SecureStore.setItemAsync(`ex_key_${connectionId}`, apiKey);
    await SecureStore.setItemAsync(`ex_secret_${connectionId}`, apiSecret);
  } catch (error) {
    console.error(`[SecureStore] Failed to save credentials for ${connectionId}:`, error);
    throw new Error('Failed to save API credentials securely.');
  }
}

/**
 * Retrieves exchange API key and secret from Expo SecureStore.
 */
export async function getExchangeCredentials(
  connectionId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  try {
    const apiKey = await SecureStore.getItemAsync(`ex_key_${connectionId}`);
    const apiSecret = await SecureStore.getItemAsync(`ex_secret_${connectionId}`);

    if (!apiKey || !apiSecret) {
      return null;
    }

    return { apiKey, apiSecret };
  } catch (error) {
    console.error(`[SecureStore] Failed to get credentials for ${connectionId}:`, error);
    return null;
  }
}

/**
 * Deletes exchange API credentials from Expo SecureStore.
 */
export async function deleteExchangeCredentials(connectionId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`ex_key_${connectionId}`);
    await SecureStore.deleteItemAsync(`ex_secret_${connectionId}`);
  } catch (error) {
    console.error(`[SecureStore] Failed to delete credentials for ${connectionId}:`, error);
    throw new Error('Failed to delete API credentials.');
  }
}
