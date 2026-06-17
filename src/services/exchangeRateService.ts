import { executeSql, getFirst } from '../db/database';

const FIAT_CURRENCIES = ['EUR', 'RUB', 'KZT'];
// Our currency symbol -> CoinGecko coin id. CryptoCompare now requires an API
// key, so we use CoinGecko's keyless simple/price endpoint.
const CRYPTO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  APT: 'aptos',
};
const CRYPTO_CURRENCIES = Object.keys(CRYPTO_IDS);

/**
 * Fetch live FX + crypto rates and persist them to the exchange_rates table.
 * Fiat and crypto are fetched independently so one failing endpoint does not
 * wipe out the other. Returns true if at least one rate was updated.
 */
export async function fetchAndUpdateRates(): Promise<boolean> {
  console.log('[rates] fetching live exchange rates…');
  const now = new Date().toISOString();
  let fiatUpdated = 0;
  let cryptoUpdated = 0;

  // 1. Fiat rates (USD base) — open.er-api.com, no key required.
  try {
    const fiatRes = await fetch('https://open.er-api.com/v6/latest/USD');
    const fiatData = await fiatRes.json();
    if (fiatData && fiatData.result === 'success' && fiatData.rates) {
      for (const curr of FIAT_CURRENCIES) {
        const rateFromUsd = fiatData.rates[curr];
        if (rateFromUsd && rateFromUsd > 0) {
          executeSql(
            'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, ?, ?)',
            [curr, 1 / rateFromUsd, now]
          );
          fiatUpdated++;
        } else {
          console.warn(`[rates] fiat: missing rate for ${curr}`);
        }
      }
    } else {
      console.warn('[rates] fiat: unexpected response', JSON.stringify(fiatData).slice(0, 200));
    }
  } catch (e) {
    console.error('[rates] fiat fetch failed:', e);
  }

  // 2. Crypto rates (USD) — CoinGecko simple/price, no key required.
  try {
    const ids = Object.values(CRYPTO_IDS).join(',');
    const cryptoRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    const cryptoData = await cryptoRes.json();
    if (cryptoData && !cryptoData.status && !cryptoData.error) {
      for (const coin of CRYPTO_CURRENCIES) {
        const usd = cryptoData[CRYPTO_IDS[coin]]?.usd;
        if (usd && usd > 0) {
          executeSql(
            'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, ?, ?)',
            [coin, usd, now]
          );
          cryptoUpdated++;
        } else {
          console.warn(`[rates] crypto: missing price for ${coin} (${CRYPTO_IDS[coin]})`);
        }
      }
    } else {
      console.warn('[rates] crypto: error response', JSON.stringify(cryptoData).slice(0, 200));
    }
  } catch (e) {
    console.error('[rates] crypto fetch failed:', e);
  }

  // Always keep USD anchored at 1.0.
  executeSql(
    'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, 1.0, ?)',
    ['USD', now]
  );

  console.log(`[rates] done: ${fiatUpdated}/${FIAT_CURRENCIES.length} fiat, ${cryptoUpdated}/${CRYPTO_CURRENCIES.length} crypto updated`);
  return fiatUpdated > 0 || cryptoUpdated > 0;
}

export function getLastRatesUpdate(): string | null {
  try {
    const row = getFirst('SELECT max(updated_at) as last_update FROM exchange_rates');
    return row ? row.last_update : null;
  } catch (e) {
    console.error('Error reading last exchange rates update timestamp', e);
    return null;
  }
}

/**
 * True when rates have never been fetched or are older than `maxAgeMinutes`.
 * Used to throttle automatic refresh-on-focus so we don't hammer the public
 * APIs (cryptocompare rate-limits) on every tab switch.
 */
export function areRatesStale(maxAgeMinutes = 10): boolean {
  const last = getLastRatesUpdate();
  if (!last) return true;
  const ageMs = Date.now() - new Date(last).getTime();
  if (Number.isNaN(ageMs)) return true;
  return ageMs > maxAgeMinutes * 60 * 1000;
}
