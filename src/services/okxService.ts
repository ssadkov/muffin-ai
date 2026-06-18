import CryptoJS from 'crypto-js';
import { getRatesMap } from '../db/database';

const OKX_BASE_URL = 'https://www.okx.com';
const STABLECOINS = new Set(['USDT', 'USDC', 'USD', 'DAI', 'BUSD', 'TUSD', 'FDUSD']);

interface OkxApiResponse<T> {
  code: string;
  msg: string;
  data: T;
}

interface OkxTradingBalance {
  totalEq?: string;
  details?: Array<{
    ccy?: string;
    eq?: string;
    eqUsd?: string;
    cashBal?: string;
  }>;
}

interface OkxFundingBalance {
  ccy?: string;
  bal?: string;
  availBal?: string;
  frozenBal?: string;
}

interface OkxTicker {
  instId?: string;
  last?: string;
}

interface OkxBalanceResult {
  totalUsd: number;
  details: {
    tradingUsd: number;
    fundingUsd: number;
    tradingAssets: Array<{
      asset: string;
      amount: number;
      usdValue: number;
    }>;
    fundingAssets: Array<{
      asset: string;
      amount: number;
      usdValue: number;
    }>;
  };
}

export function generateOkxSignature(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  apiSecret: string
): string {
  const prehash = timestamp + method.toUpperCase() + requestPath + body;
  return CryptoJS.HmacSHA256(prehash, apiSecret).toString(CryptoJS.enc.Base64);
}

export async function fetchOkxBalance(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean = false
): Promise<number> {
  const result = await fetchOkxBalanceDetails(apiKey, apiSecret, passphrase, isDemo);
  return result.totalUsd;
}

export async function testOkxConnection(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean = false
): Promise<boolean> {
  try {
    const result = await fetchOkxBalanceDetails(apiKey, apiSecret, passphrase, isDemo);
    return typeof result.totalUsd === 'number' && !isNaN(result.totalUsd);
  } catch (error) {
    console.warn('[OKX API] Connection test failed:', error);
    throw error;
  }
}

async function fetchOkxBalanceDetails(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean
): Promise<OkxBalanceResult> {
  const prices = await safeFetchSpotPrices();

  let tradingResult: { totalUsd: number; assets: OkxBalanceResult['details']['tradingAssets'] } | null = null;
  let fundingResult: { totalUsd: number; assets: OkxBalanceResult['details']['fundingAssets'] } | null = null;
  let firstError: unknown = null;

  try {
    tradingResult = await fetchTradingBalance(apiKey, apiSecret, passphrase, isDemo);
  } catch (error: any) {
    firstError = error;
    console.warn('[OKX API] Trading balance fetch failed:', error?.message || error);
  }

  try {
    fundingResult = await fetchFundingBalance(apiKey, apiSecret, passphrase, isDemo, prices);
  } catch (error: any) {
    firstError = firstError || error;
    console.warn('[OKX API] Funding balance fetch failed:', error?.message || error);
  }

  if (!tradingResult && !fundingResult) {
    throw firstError || new Error('OKX balance sync failed.');
  }

  const tradingUsd = tradingResult?.totalUsd || 0;
  const fundingUsd = fundingResult?.totalUsd || 0;

  return {
    totalUsd: tradingUsd + fundingUsd,
    details: {
      tradingUsd,
      fundingUsd,
      tradingAssets: tradingResult?.assets || [],
      fundingAssets: fundingResult?.assets || [],
    },
  };
}

async function fetchTradingBalance(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean
): Promise<{ totalUsd: number; assets: OkxBalanceResult['details']['tradingAssets'] }> {
  const data = await signedGet<OkxTradingBalance[]>(
    '/api/v5/account/balance',
    apiKey,
    apiSecret,
    passphrase,
    isDemo
  );

  const account = data[0];
  if (!account) {
    return { totalUsd: 0, assets: [] };
  }

  const details = account.details || [];
  const assets = details
    .map((item) => ({
      asset: item.ccy || 'UNKNOWN',
      amount: parseFloat(item.eq || item.cashBal || '0') || 0,
      usdValue: parseFloat(item.eqUsd || '0') || 0,
    }))
    .filter((asset) => asset.amount > 0 || asset.usdValue > 0);

  const totalEq = parseFloat(account.totalEq || '0');
  const totalUsd = totalEq > 0 ? totalEq : assets.reduce((sum, asset) => sum + asset.usdValue, 0);

  return { totalUsd, assets };
}

async function fetchFundingBalance(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean,
  prices: Record<string, number>
): Promise<{ totalUsd: number; assets: OkxBalanceResult['details']['fundingAssets'] }> {
  const data = await signedGet<OkxFundingBalance[]>(
    '/api/v5/asset/balances',
    apiKey,
    apiSecret,
    passphrase,
    isDemo
  );

  const rates = getRatesMap();
  const assets = (data || [])
    .map((item) => {
      const asset = item.ccy || 'UNKNOWN';
      const directBalance = parseFloat(item.bal || '');
      const available = parseFloat(item.availBal || '0') || 0;
      const frozen = parseFloat(item.frozenBal || '0') || 0;
      const amount = !isNaN(directBalance) ? directBalance : available + frozen;
      return {
        asset,
        amount,
        usdValue: estimateAssetUsdValue(asset, amount, prices, rates),
      };
    })
    .filter((asset) => asset.amount > 0 || asset.usdValue > 0);

  return {
    totalUsd: assets.reduce((sum, asset) => sum + asset.usdValue, 0),
    assets,
  };
}

async function signedGet<T>(
  requestPath: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isDemo: boolean
): Promise<T> {
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const body = '';
  const signature = generateOkxSignature(timestamp, method, requestPath, body, apiSecret);
  const response = await fetch(`${OKX_BASE_URL}${requestPath}`, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      ...(isDemo ? { 'x-simulated-trading': '1' } : {}),
    },
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(formatOkxError(response.status, data));
  }

  if (!data || data.code !== '0') {
    throw new Error(formatOkxError(response.status, data));
  }

  return data.data as T;
}

async function safeFetchSpotPrices(): Promise<Record<string, number>> {
  try {
    return await fetchSpotPrices();
  } catch (error: any) {
    console.warn('[OKX API] Spot ticker fetch failed, using local rates only:', error?.message || error);
    return {};
  }
}

async function fetchSpotPrices(): Promise<Record<string, number>> {
  const response = await fetch(`${OKX_BASE_URL}/api/v5/market/tickers?instType=SPOT`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(formatOkxError(response.status, data));
  }

  if (!data || data.code !== '0' || !Array.isArray(data.data)) {
    return {};
  }

  const prices: Record<string, number> = {};
  for (const ticker of data.data as OkxTicker[]) {
    if (!ticker.instId || ticker.last === undefined) continue;
    const price = parseFloat(ticker.last);
    if (!isNaN(price)) {
      prices[ticker.instId.toUpperCase()] = price;
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
  if (amount <= 0) return 0;
  if (STABLECOINS.has(symbol)) return amount;

  const usdtPair = prices[`${symbol}-USDT`];
  if (usdtPair !== undefined) return amount * usdtPair;

  const usdcPair = prices[`${symbol}-USDC`];
  if (usdcPair !== undefined) return amount * usdcPair;

  const btcPair = prices[`${symbol}-BTC`];
  const btcUsdt = prices['BTC-USDT'];
  if (btcPair !== undefined && btcUsdt !== undefined) return amount * btcPair * btcUsdt;

  const ethPair = prices[`${symbol}-ETH`];
  const ethUsdt = prices['ETH-USDT'];
  if (ethPair !== undefined && ethUsdt !== undefined) return amount * ethPair * ethUsdt;

  const localRate = rates[symbol];
  if (localRate !== undefined) return amount * localRate;

  console.warn(`[OKX API] No USD price found for ${asset}, skipping in USD calculation.`);
  return 0;
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

function formatOkxError(status: number, data: any): string {
  const code = data?.code ? `[${data.code}] ` : '';
  const msg = data?.msg || data?.message || 'Unknown OKX API error';
  return `OKX API returned HTTP ${status}: ${code}${msg}`;
}
