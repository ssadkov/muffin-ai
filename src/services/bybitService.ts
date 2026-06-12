import CryptoJS from 'crypto-js';
import { getRatesMap } from '../tools/databaseTools';

/**
 * Generates the HMAC-SHA256 signature required by Bybit v5 API.
 * Formula: hex(HMAC_SHA256(secret, timestamp + api_key + recv_window + queryString))
 */
export function generateBybitSignature(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryString: string,
  apiSecret: string
): string {
  const message = timestamp + apiKey + recvWindow + queryString;
  return CryptoJS.HmacSHA256(message, apiSecret).toString(CryptoJS.enc.Hex);
}

interface BybitBalanceResult {
  totalUsd: number;
  details: {
    accountType: string;
    coins: Array<{
      coin: string;
      balance: number;
      usdValue?: number;
    }>;
  };
}

/**
 * Fetches the wallet balance for a given API Key and API Secret from Bybit V5 API.
 * It first tries UNIFIED account type (standard for modern Bybit accounts)
 * and falls back to SPOT account type (for classic Spot accounts) if UNIFIED is not available.
 */
export async function fetchBybitBalance(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean = false
): Promise<number> {
  const result = await fetchBybitBalanceDetails(apiKey, apiSecret, isTestnet);
  return result.totalUsd;
}

/**
 * Tests connection with the given credentials. Returns true if successful, false or throws if failed.
 */
export async function testBybitConnection(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean = false
): Promise<boolean> {
  try {
    const result = await fetchBybitBalanceDetails(apiKey, apiSecret, isTestnet);
    return typeof result.totalUsd === 'number' && !isNaN(result.totalUsd);
  } catch (error) {
    console.warn('[Bybit API] Connection test failed:', error);
    throw error;
  }
}

/**
 * Internal helper to fetch wallet balance details.
 */
async function fetchBybitBalanceDetails(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean
): Promise<BybitBalanceResult> {
  const baseUrl = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  // Step 1: Try UNIFIED account type first
  let accountType = 'UNIFIED';
  let queryString = `accountType=${accountType}`;
  let signature = generateBybitSignature(timestamp, apiKey, recvWindow, queryString, apiSecret);

  let response: Response;
  let data: any;

  try {
    response = await fetch(`${baseUrl}/v5/account/wallet-balance?${queryString}`, {
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    data = await response.json();

    // If Bybit returns code indicating that this account type is not supported/unified (e.g. 10001, 10016, or other codes)
    // we fallback to SPOT account type
    if (data.retCode !== 0) {
      console.log(`[Bybit API] UNIFIED balance fetch returned code ${data.retCode}: ${data.retMsg}. Retrying with SPOT...`);
      accountType = 'SPOT';
      queryString = `accountType=${accountType}`;
      signature = generateBybitSignature(timestamp, apiKey, recvWindow, queryString, apiSecret);

      response = await fetch(`${baseUrl}/v5/account/wallet-balance?${queryString}`, {
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error on SPOT retry! status: ${response.status}`);
      }

      data = await response.json();
    }

    if (data.retCode !== 0) {
      throw new Error(`Bybit API returned error: [${data.retCode}] ${data.retMsg}`);
    }

    const list = data.result?.list || [];
    if (list.length === 0) {
      return { totalUsd: 0, details: { accountType, coins: [] } };
    }

    const accountData = list[0];
    const coinsList = accountData.coin || [];
    
    const parsedCoins = coinsList.map((c: any) => ({
      coin: c.coin as string,
      balance: parseFloat(c.walletBalance || '0'),
      usdValue: c.usdValue ? parseFloat(c.usdValue) : undefined,
    }));

    // Calculate total USD value
    let totalUsd = 0;
    
    if (accountType === 'UNIFIED') {
      // For Unified accounts, we can use the account-level metrics directly
      if (accountData.totalEquity && parseFloat(accountData.totalEquity) > 0) {
        totalUsd = parseFloat(accountData.totalEquity);
      } else if (accountData.totalWalletBalance && parseFloat(accountData.totalWalletBalance) > 0) {
        totalUsd = parseFloat(accountData.totalWalletBalance);
      } else {
        totalUsd = sumCoinsUsd(parsedCoins);
      }
    } else {
      // For Classic/SPOT accounts, sum the individual coin values
      totalUsd = sumCoinsUsd(parsedCoins);
    }

    return {
      totalUsd,
      details: {
        accountType,
        coins: parsedCoins,
      },
    };
  } catch (error: any) {
    console.error('[Bybit API] Request failed:', error?.message || error);
    throw error;
  }
}

/**
 * Calculates sum of coins in USD. Falls back to local rates if Bybit doesn't provide usdValue.
 */
function sumCoinsUsd(coins: Array<{ coin: string; balance: number; usdValue?: number }>): number {
  let sum = 0;
  const rates = getRatesMap();

  for (const c of coins) {
    if (c.balance <= 0) continue;

    if (c.usdValue !== undefined && !isNaN(c.usdValue)) {
      sum += c.usdValue;
    } else {
      // Fallback: estimate using local DB exchange rates
      const coinName = c.coin.toUpperCase();
      const rate = rates[coinName];
      if (rate !== undefined) {
        sum += c.balance * rate;
      } else {
        // If we don't have exchange rate for this coin, treat it as 1:1 if it's a stablecoin, or skip
        if (['USDT', 'USDC', 'USD', 'DAI'].includes(coinName)) {
          sum += c.balance;
        } else {
          console.warn(`[Bybit API] No exchange rate found for ${c.coin}, skipping in USD calculation.`);
        }
      }
    }
  }

  return sum;
}
