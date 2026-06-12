import { listAccounts, upsertAccountBalance } from '../tools/databaseTools';

export async function syncPublicWallets(): Promise<void> {
  const apiKey = process.env.EXPO_PUBLIC_YIELD_AI_API_KEY;
  if (!apiKey) {
    console.warn("[Wallet Sync] EXPO_PUBLIC_YIELD_AI_API_KEY is not defined. Skipping wallet synchronization.");
    return;
  }

  try {
    const accounts = listAccounts();
    const wallets = accounts.filter(
      (a: any) =>
        a.source === 'solana_public_wallet' ||
        a.source === 'aptos_public_wallet' ||
        a.type === 'crypto_wallet'
    );

    if (wallets.length === 0) {
      console.log("[Wallet Sync] No public crypto wallets found in the local database.");
      return;
    }

    console.log(`[Wallet Sync] Found ${wallets.length} wallet(s) to synchronize.`);

    // Perform requests in parallel for all wallets
    const syncPromises = wallets.map(async (wallet: any) => {
      if (!wallet.address) {
        console.warn(`[Wallet Sync] Wallet "${wallet.name}" is missing a public address. Skipping.`);
        return;
      }

      const address = wallet.address.trim();
      const baseUrl = 'https://yieldai.app';
      const headers = {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      };

      console.log(`[Wallet Sync] Syncing wallet "${wallet.name}" (${wallet.source}) for address: ${address}`);

      try {
        const [balanceRes, protocolsRes] = await Promise.all([
          fetch(`${baseUrl}/api/public/v1/wallet/${address}/balance`, { headers }),
          fetch(`${baseUrl}/api/public/v1/wallet/${address}/protocols`, { headers }),
        ]);

        if (!balanceRes.ok) {
          throw new Error(`Spot balance API returned HTTP ${balanceRes.status}`);
        }
        if (!protocolsRes.ok) {
          throw new Error(`DeFi protocols API returned HTTP ${protocolsRes.status}`);
        }

        const balanceData = await balanceRes.json();
        const protocolsData = await protocolsRes.json();

        // Calculate Spot Balance sum
        const tokensList = balanceData.tokens || [];
        const walletUSD = tokensList.reduce((sum: number, t: any) => sum + (t.valueUSD || 0), 0);

        // DeFi position sum
        const defiUSD = protocolsData.totalDeFiValueUSD || 0;

        const totalUSD = walletUSD + defiUSD;
        console.log(`[Wallet Sync] Wallet "${wallet.name}" sync success. Spot: $${walletUSD.toFixed(2)}, DeFi: $${defiUSD.toFixed(2)}, Total Portfolio: $${totalUSD.toFixed(2)}`);

        // Save new balance snapshot to the SQLite database
        // This will update the latest balance snapshot for the wallet account
        upsertAccountBalance(
          wallet.name,
          totalUSD,
          'USD',
          JSON.stringify({
            spotTokensCount: tokensList.length,
            protocolsCount: (protocolsData.protocols || []).length,
            defiUSDComplete: protocolsData.totalDeFiValueUSDComplete
          }),
          undefined,
          wallet.source
        );
      } catch (err: any) {
        console.error(`[Wallet Sync] Failed to sync wallet "${wallet.name}":`, err?.message || err);
      }
    });

    await Promise.all(syncPromises);
    console.log("[Wallet Sync] Wallet synchronization cycle completed.");
  } catch (e: any) {
    console.error("[Wallet Sync] Synchronization cycle encountered an error:", e?.message || e);
  }
}
