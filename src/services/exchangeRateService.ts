import { executeSql, getFirst } from '../db/database';

export async function fetchAndUpdateRates(): Promise<boolean> {
  console.log("Fetching live exchange rates from public APIs...");
  try {
    // 1. Fetch fiat rates (against USD)
    const fiatRes = await fetch('https://open.er-api.com/v6/latest/USD');
    const fiatData = await fiatRes.json();
    
    // 2. Fetch crypto rates (against USD)
    const cryptoRes = await fetch('https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH,SOL,APT&tsyms=USD');
    const cryptoData = await cryptoRes.json();
    
    const now = new Date().toISOString();

    // 3. Save fiat rates
    if (fiatData && fiatData.rates) {
      const currencies = ['EUR', 'RUB', 'KZT'];
      for (const curr of currencies) {
        const rateFromUsd = fiatData.rates[curr];
        if (rateFromUsd && rateFromUsd > 0) {
          const rateToUsd = 1 / rateFromUsd;
          executeSql(
            'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, ?, ?)',
            [curr, rateToUsd, now]
          );
        }
      }
    }

    // 4. Save crypto rates
    if (cryptoData) {
      const cryptos = ['BTC', 'ETH', 'SOL', 'APT'];
      for (const coin of cryptos) {
        const coinData = cryptoData[coin];
        if (coinData && coinData.USD && coinData.USD > 0) {
          const rateToUsd = coinData.USD;
          executeSql(
            'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, ?, ?)',
            [coin, rateToUsd, now]
          );
        }
      }
    }

    // Make sure USD itself is set to 1.0
    executeSql(
      'INSERT OR REPLACE INTO exchange_rates (currency, rate_to_usd, updated_at) VALUES (?, 1.0, ?)',
      ['USD', now]
    );

    console.log("Exchange rates updated successfully in database!");
    return true;
  } catch (e) {
    console.error("Failed to update exchange rates:", e);
    return false;
  }
}

export function getLastRatesUpdate(): string | null {
  try {
    const row = getFirst('SELECT max(updated_at) as last_update FROM exchange_rates');
    return row ? row.last_update : null;
  } catch (e) {
    console.error("Error reading last exchange rates update timestamp", e);
    return null;
  }
}
