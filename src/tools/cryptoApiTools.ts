/**
 * Mock / simple tool for getting Bitcoin price.
 */
export async function getBitcoinPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const data = await response.json();
    if (data && data.bitcoin && data.bitcoin.usd) {
      return data.bitcoin.usd;
    }
  } catch (error) {
    console.warn("Failed to fetch BTC price from API, using fallback.");
  }
  // Fallback if API fails
  return 92500; 
}
