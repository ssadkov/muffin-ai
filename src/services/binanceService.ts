import CryptoJS from 'crypto-js';
import { getRatesMap } from '../db/database';

const BINANCE_BASE_URL = 'https://api.binance.com';
const BINANCE_TESTNET_BASE_URL = 'https://testnet.binance.vision';
const RECV_WINDOW = '5000';
const STABLECOINS = new Set(['USDT', 'USDC', 'USD', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

type QueryParam = [string, string | number | boolean];

interface BinanceWalletBalance {
  activate?: boolean;
  balance?: string;
  walletName?: string;
}

interface BinanceSpotBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceBalanceResult {
  totalUsd: number;
  details: {
    source: 'wallet_balance' | 'spot_account';
    wallets?: Array<{
      name: string;
      balanceUsd: number;
      active: boolean;
    }>;
    assets?: Array<{
      asset: string;
      amount: number;
      usdValue: number;
    }>;
  };
}

export function generateBinanceSignature(queryString: string, apiSecret: string): string {
  return CryptoJS.HmacSHA256(queryString, apiSecret).toString(CryptoJS.enc.Hex);
}

export async function fetchBinanceBalance(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean = false
): Promise<number> {
  const result = await fetchBinanceBalanceDetails(apiKey, apiSecret, isTestnet);
  return result.totalUsd;
}

export async function testBinanceConnection(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean = false
): Promise<boolean> {
  try {
    const result = await fetchBinanceBalanceDetails(apiKey, apiSecret, isTestnet);
    return typeof result.totalUsd === 'number' && !isNaN(result.totalUsd);
  } catch (error) {
    console.warn('[Binance API] Connection test failed:', error);
    throw error;
  }
}

async function fetchBinanceBalanceDetails(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean
): Promise<BinanceBalanceResult> {
  if (!isTestnet) {
    try {
      return await fetchWalletBalance(apiKey, apiSecret);
    } catch (error: any) {
      console.warn('[Binance API] Wallet balance failed, falling back to Spot account:', error?.message || error);
    }
  }

  return fetchSpotBalance(apiKey, apiSecret, isTestnet);
}

async function fetchWalletBalance(apiKey: string, apiSecret: string): Promise<BinanceBalanceResult> {
  const data = await signedGet<BinanceWalletBalance[]>(
    BINANCE_BASE_URL,
    '/sapi/v1/asset/wallet/balance',
    [
      ['quoteAsset', 'USDT'],
      ['recvWindow', RECV_WINDOW],
    ],
    apiKey,
    apiSecret
  );

  if (!Array.isArray(data)) {
    throw new Error('Unexpected Binance wallet balance response.');
  }

  const wallets = data.map((wallet) => ({
    name: wallet.walletName || 'Unknown',
    balanceUsd: parseFloat(wallet.balance || '0') || 0,
    active: wallet.activate !== false,
  }));

  const totalUsd = wallets.reduce((sum, wallet) => (
    wallet.active && wallet.balanceUsd > 0 ? sum + wallet.balanceUsd : sum
  ), 0);

  return {
    totalUsd,
    details: {
      source: 'wallet_balance',
      wallets,
    },
  };
}

async function fetchSpotBalance(
  apiKey: string,
  apiSecret: string,
  isTestnet: boolean
): Promise<BinanceBalanceResult> {
  const baseUrl = isTestnet ? BINANCE_TESTNET_BASE_URL : BINANCE_BASE_URL;
  const data = await signedGet<{ balances?: BinanceSpotBalance[] }>(
    baseUrl,
    '/api/v3/account',
    [
      ['omitZeroBalances', 'true'],
      ['recvWindow', RECV_WINDOW],
    ],
    apiKey,
    apiSecret
  );

  const balances = data.balances || [];
  const positiveBalances = balances
    .map((balance) => ({
      asset: balance.asset,
      amount: (parseFloat(balance.free || '0') || 0) + (parseFloat(balance.locked || '0') || 0),
    }))
    .filter((balance) => balance.amount > 0);

  if (positiveBalances.length === 0) {
    return {
      totalUsd: 0,
      details: {
        source: 'spot_account',
        assets: [],
      },
    };
  }

  let prices: Record<string, number> = {};
  try {
    prices = await fetchTickerPrices(baseUrl);
  } catch (error: any) {
    console.warn('[Binance API] Ticker price fetch failed, using local rates only:', error?.message || error);
  }

  const rates = getRatesMap();
  const assets = positiveBalances.map((balance) => {
    const usdValue = estimateAssetUsdValue(balance.asset, balance.amount, prices, rates);
    return {
      asset: balance.asset,
      amount: balance.amount,
      usdValue,
    };
  });

  return {
    totalUsd: assets.reduce((sum, asset) => sum + asset.usdValue, 0),
    details: {
      source: 'spot_account',
      assets,
    },
  };
}

async function signedGet<T>(
  baseUrl: string,
  path: string,
  params: QueryParam[],
  apiKey: string,
  apiSecret: string
): Promise<T> {
  const queryParams: QueryParam[] = [
    ...params,
    ['timestamp', Date.now()],
  ];
  const queryString = buildQueryString(queryParams);
  const signature = generateBinanceSignature(queryString, apiSecret);
  const response = await fetch(`${baseUrl}${path}?${queryString}&signature=${signature}`, {
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(formatBinanceError(response.status, data));
  }

  if (data && typeof data === 'object' && typeof data.code === 'number' && data.code < 0) {
    throw new Error(formatBinanceError(response.status, data));
  }

  return data as T;
}

async function fetchTickerPrices(baseUrl: string): Promise<Record<string, number>> {
  const response = await fetch(`${baseUrl}/api/v3/ticker/price`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(formatBinanceError(response.status, data));
  }

  if (!Array.isArray(data)) {
    return {};
  }

  const prices: Record<string, number> = {};
  for (const item of data) {
    if (!item?.symbol || item?.price === undefined) continue;
    const price = parseFloat(item.price);
    if (!isNaN(price)) {
      prices[String(item.symbol).toUpperCase()] = price;
    }
  }

  return prices;
}

function estimateAssetUsdValue(
  asset: string,
  amount: number,
  prices: Record<string, number>,
  rates: Record<string, number>
): number {
  const symbol = asset.toUpperCase();
  if (STABLECOINS.has(symbol)) {
    return amount;
  }

  const directUsdt = prices[`${symbol}USDT`];
  if (directUsdt !== undefined) {
    return amount * directUsdt;
  }

  const directUsdc = prices[`${symbol}USDC`];
  if (directUsdc !== undefined) {
    return amount * directUsdc;
  }

  const bnbPair = prices[`${symbol}BNB`];
  const bnbUsdt = prices.BNBUSDT;
  if (bnbPair !== undefined && bnbUsdt !== undefined) {
    return amount * bnbPair * bnbUsdt;
  }

  const localRate = rates[symbol];
  if (localRate !== undefined) {
    return amount * localRate;
  }

  console.warn(`[Binance API] No USD price found for ${asset}, skipping in USD calculation.`);
  return 0;
}

function buildQueryString(params: QueryParam[]): string {
  return params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { msg: text };
  }
}

function formatBinanceError(status: number, data: any): string {
  const code = data?.code !== undefined ? `[${data.code}] ` : '';
  const msg = data?.msg || data?.message || 'Unknown Binance API error';
  return `Binance API returned HTTP ${status}: ${code}${msg}`;
}
