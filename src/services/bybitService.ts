import CryptoJS from 'crypto-js';
import { getRatesMap } from '../db/database';

const RECV_WINDOW = '5000';
const STABLECOINS = new Set(['USDT', 'USDC', 'USD', 'DAI', 'BUSD', 'TUSD', 'FDUSD']);

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
    accounts: Array<{
      accountType: string;
      totalUsd: number;
      coins: Array<{
        coin: string;
        balance: number;
        usdValue?: number;
      }>;
    }>;
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
 * and falls back to SPOT account type (for classic Spot accounts) if UNIFIED is not available,
 * then adds Funding wallet balances from the Asset endpoint.
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
export async function fetchBybitBalanceDetails(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean
): Promise<BybitBalanceResult> {
  const baseUrl = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';

  try {
    const accounts = [await fetchUnifiedOrSpotBalance(baseUrl, apiKey, apiSecret)];

    try {
      accounts.push(await fetchFundingBalance(baseUrl, apiKey, apiSecret));
    } catch (fundingError: any) {
      console.warn('[Bybit API] Funding balance fetch failed:', fundingError?.message || fundingError);
    }

    const totalUsd = accounts.reduce((sum, account) => sum + account.totalUsd, 0);
    const coins = accounts.flatMap((account) => account.coins);

    return {
      totalUsd,
      details: {
        accountType: accounts.map((account) => account.accountType).join('+'),
        accounts,
        coins,
      },
    };
  } catch (error: any) {
    console.error('[Bybit API] Request failed:', error?.message || error);
    throw error;
  }
}

async function fetchUnifiedOrSpotBalance(
  baseUrl: string,
  apiKey: string,
  apiSecret: string
): Promise<BybitBalanceResult['details']['accounts'][number]> {
  let accountType = 'UNIFIED';
  let data = await signedGet(baseUrl, '/v5/account/wallet-balance', `accountType=${accountType}`, apiKey, apiSecret);

  // If Bybit returns code indicating that this account type is not supported/unified,
  // fallback to SPOT account type for classic accounts.
  if (data.retCode !== 0) {
    console.log(`[Bybit API] UNIFIED balance fetch returned code ${data.retCode}: ${data.retMsg}. Retrying with SPOT...`);
    accountType = 'SPOT';
    data = await signedGet(baseUrl, '/v5/account/wallet-balance', `accountType=${accountType}`, apiKey, apiSecret);
  }

  if (data.retCode !== 0) {
    throw new Error(`Bybit API returned error: [${data.retCode}] ${data.retMsg}`);
  }

  const list = data.result?.list || [];
  if (list.length === 0) {
    return { accountType, totalUsd: 0, coins: [] };
  }

  const accountData = list[0];
  const coinsList = accountData.coin || [];

  const coins = coinsList.map((c: any) => ({
    coin: c.coin as string,
    balance: parseFloat(c.walletBalance || '0'),
    usdValue: c.usdValue ? parseFloat(c.usdValue) : undefined,
  }));

  let totalUsd = 0;
  if (accountType === 'UNIFIED') {
    if (accountData.totalEquity && parseFloat(accountData.totalEquity) > 0) {
      totalUsd = parseFloat(accountData.totalEquity);
    } else if (accountData.totalWalletBalance && parseFloat(accountData.totalWalletBalance) > 0) {
      totalUsd = parseFloat(accountData.totalWalletBalance);
    } else {
      totalUsd = sumCoinsUsd(coins);
    }
  } else {
    totalUsd = sumCoinsUsd(coins);
  }

  return { accountType, totalUsd, coins };
}

async function fetchFundingBalance(
  baseUrl: string,
  apiKey: string,
  apiSecret: string
): Promise<BybitBalanceResult['details']['accounts'][number]> {
  const accountType = 'FUND';
  const queryString = `accountType=${accountType}`;
  const data = await signedGet(baseUrl, '/v5/asset/transfer/query-account-coins-balance', queryString, apiKey, apiSecret);

  if (data.retCode !== 0) {
    throw new Error(`Bybit Funding API returned error: [${data.retCode}] ${data.retMsg}`);
  }

  const prices = await safeFetchSpotPrices(baseUrl);
  const rates = getRatesMap();
  const coins = (data.result?.balance || []).map((c: any) => {
    const coin = c.coin as string;
    const balance = parseFloat(c.walletBalance || '0');
    return {
      coin,
      balance,
      usdValue: estimateCoinUsdValue(coin, balance, prices, rates),
    };
  });

  return {
    accountType,
    totalUsd: sumCoinsUsd(coins),
    coins,
  };
}

async function signedGet(
  baseUrl: string,
  path: string,
  queryString: string,
  apiKey: string,
  apiSecret: string
): Promise<any> {
  const timestamp = Date.now().toString();
  const signature = generateBybitSignature(timestamp, apiKey, RECV_WINDOW, queryString, apiSecret);
  const response = await fetch(`${baseUrl}${path}?${queryString}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function safeFetchSpotPrices(baseUrl: string): Promise<Record<string, number>> {
  try {
    return await fetchSpotPrices(baseUrl);
  } catch (error: any) {
    console.warn('[Bybit API] Spot ticker fetch failed, using local rates only:', error?.message || error);
    return {};
  }
}

async function fetchSpotPrices(baseUrl: string): Promise<Record<string, number>> {
  const response = await fetch(`${baseUrl}/v5/market/tickers?category=spot`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Bybit ticker HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit ticker API returned error: [${data.retCode}] ${data.retMsg}`);
  }

  const prices: Record<string, number> = {};
  for (const item of data.result?.list || []) {
    if (!item?.symbol || item?.lastPrice === undefined) continue;
    const price = parseFloat(item.lastPrice);
    if (!isNaN(price)) {
      prices[String(item.symbol).toUpperCase()] = price;
    }
  }

  return prices;
}

function estimateCoinUsdValue(
  coin: string,
  balance: number,
  prices: Record<string, number>,
  rates: Record<string, number>
): number | undefined {
  if (balance <= 0) return 0;

  const coinName = coin.toUpperCase();
  if (STABLECOINS.has(coinName)) {
    return balance;
  }

  const directUsdt = prices[`${coinName}USDT`];
  if (directUsdt !== undefined) {
    return balance * directUsdt;
  }

  const directUsdc = prices[`${coinName}USDC`];
  if (directUsdc !== undefined) {
    return balance * directUsdc;
  }

  const btcPair = prices[`${coinName}BTC`];
  const btcUsdt = prices.BTCUSDT;
  if (btcPair !== undefined && btcUsdt !== undefined) {
    return balance * btcPair * btcUsdt;
  }

  const ethPair = prices[`${coinName}ETH`];
  const ethUsdt = prices.ETHUSDT;
  if (ethPair !== undefined && ethUsdt !== undefined) {
    return balance * ethPair * ethUsdt;
  }

  const localRate = rates[coinName];
  if (localRate !== undefined) {
    return balance * localRate;
  }

  console.warn(`[Bybit API] No USD price found for ${coin}, skipping in USD calculation.`);
  return undefined;
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
        if (STABLECOINS.has(coinName)) {
          sum += c.balance;
        } else {
          console.warn(`[Bybit API] No exchange rate found for ${c.coin}, skipping in USD calculation.`);
        }
      }
    }
  }

  return sum;
}
