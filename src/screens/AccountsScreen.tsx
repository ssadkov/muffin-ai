import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  SectionList,
  ScrollView,
  TouchableOpacity, 
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, spacing, fontSize, shadow } from '../theme/theme';
import StatusChip from '../components/StatusChip';
import FormInput from '../components/FormInput';
import EmptyState from '../components/EmptyState';
import {
  getLatestBalances,
  updateAccountAddress, 
  createManualAccount,
  getAccountHistory,
  addExchangeConnection,
  syncExchangeBalance,
  deleteExchangeConnection,
  deleteAccount,
  syncAllExchanges,
  getSetting,
  updateAccountMetadata,
  updateAccountName,
  executeBalanceUpdate,
  OwnerType,
  AccountType
} from '../tools/databaseTools';
import { testBybitConnection } from '../services/bybitService';
import { testBinanceConnection } from '../services/binanceService';
import { testOkxConnection } from '../services/okxService';
import { syncPublicWallets } from '../services/walletSyncService';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { t, Language } from '../localization/localization';

type ExchangeProvider = 'Bybit' | 'Binance' | 'OKX';
type ExchangeBreakdownToken = {
  accountType: string;
  coin: string;
  balance: number;
  usdValue: number;
};

type ProviderMarkKind = 'solana' | 'aptos' | 'ethereum' | 'bybit' | 'binance' | 'okx' | 'wallet' | 'exchange' | 'bank';
type ProviderMeta = { label: string; color: string; soft: string; abbr: string; mark: ProviderMarkKind };
type AccountVisual = { icon?: keyof typeof Ionicons.glyphMap; mark?: ProviderMarkKind; color: string; soft: string };

const NETWORK_META: Record<string, ProviderMeta> = {
  'solana_public_wallet':   { label: 'Solana',   color: '#14F195', soft: 'rgba(20,241,149,0.14)', abbr: 'SOL', mark: 'solana' },
  'aptos_public_wallet':    { label: 'Aptos',    color: '#00D0FF', soft: 'rgba(0,208,255,0.14)',  abbr: 'APT', mark: 'aptos' },
  'ethereum_public_wallet': { label: 'Ethereum', color: '#627EEA', soft: 'rgba(98,126,234,0.14)', abbr: 'ETH', mark: 'ethereum' },
};

const EXCHANGE_OPTIONS: ExchangeProvider[] = ['Bybit', 'Binance', 'OKX'];

const MANUAL_ACCOUNT_TYPES: Array<{ type: AccountType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { type: 'bank', label: 'Bank', icon: 'business-outline' },
  { type: 'cash', label: 'Cash', icon: 'cash-outline' },
  { type: 'card', label: 'Card', icon: 'card-outline' },
  { type: 'crypto_wallet', label: 'Wallet', icon: 'wallet-outline' },
  { type: 'other', label: 'Other', icon: 'apps-outline' },
];

const EXCHANGE_META: Record<ExchangeProvider, ProviderMeta> = {
  Bybit: { label: 'Bybit', color: '#F7A600', soft: 'rgba(247,166,0,0.15)', abbr: 'BB', mark: 'bybit' },
  Binance: { label: 'Binance', color: '#F3BA2F', soft: 'rgba(243,186,47,0.16)', abbr: 'BN', mark: 'binance' },
  OKX: { label: 'OKX', color: '#FFFFFF', soft: 'rgba(255,255,255,0.12)', abbr: 'OK', mark: 'okx' },
};

function getExchangeProvider(source?: string | null, name?: string | null): ExchangeProvider | null {
  const value = `${source || ''} ${name || ''}`.toLowerCase();
  if (value.includes('bybit')) return 'Bybit';
  if (value.includes('binance')) return 'Binance';
  if (value.includes('okx')) return 'OKX';
  return null;
}

function getAccountVisual(item: any): AccountVisual {
  const source = String(item.source || '').toLowerCase();
  const exchange = getExchangeProvider(source, item.name);
  if (exchange) {
    const meta = EXCHANGE_META[exchange];
    return { mark: meta.mark, color: meta.color, soft: meta.soft };
  }
  if (NETWORK_META[source]) {
    const meta = NETWORK_META[source];
    return { mark: meta.mark, color: meta.color, soft: meta.soft };
  }

  const isCryptoWallet = item.source?.endsWith('_wallet') || item.type === 'crypto_wallet';
  const isExchange = item.source?.endsWith('_api') || item.type === 'exchange';
  if (isExchange) return { mark: 'exchange', color: colors.info, soft: colors.infoSoft };
  if (isCryptoWallet) return { mark: 'wallet', color: colors.accent, soft: colors.accentSoft };
  return { mark: 'bank', color: colors.textSecondary, soft: colors.surfaceAlt };
}

function ProviderMark({ kind, color }: { kind?: ProviderMarkKind; color: string }) {
  if (kind === 'solana') {
    return (
      <View style={styles.solanaMark}>
        <View style={[styles.solanaBar, { backgroundColor: '#00FFA3' }]} />
        <View style={[styles.solanaBar, { backgroundColor: '#DC1FFF' }]} />
        <View style={[styles.solanaBar, { backgroundColor: '#00D1FF' }]} />
      </View>
    );
  }

  if (kind === 'binance') {
    return (
      <View style={styles.binanceMark}>
        <View style={[styles.binanceDiamond, styles.binanceDiamondTop, { backgroundColor: color }]} />
        <View style={[styles.binanceDiamond, styles.binanceDiamondLeft, { backgroundColor: color }]} />
        <View style={[styles.binanceDiamond, styles.binanceDiamondCenter, { backgroundColor: color }]} />
        <View style={[styles.binanceDiamond, styles.binanceDiamondRight, { backgroundColor: color }]} />
        <View style={[styles.binanceDiamond, styles.binanceDiamondBottom, { backgroundColor: color }]} />
      </View>
    );
  }

  if (kind === 'okx') {
    return (
      <View style={styles.okxMark}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
          <View
            key={cell}
            style={[
              styles.okxCell,
              cell === 1 || cell === 3 || cell === 5 || cell === 7 ? styles.okxCellDim : null,
            ]}
          />
        ))}
      </View>
    );
  }

  if (kind === 'ethereum') {
    return (
      <View style={styles.ethereumMark}>
        <View style={[styles.ethereumDiamond, { borderBottomColor: color }]} />
        <View style={[styles.ethereumDiamondLower, { borderTopColor: color }]} />
      </View>
    );
  }

  if (kind === 'aptos') {
    return (
      <View style={styles.aptosMark}>
        <View style={[styles.aptosLine, { backgroundColor: color, width: 18 }]} />
        <View style={[styles.aptosLine, { backgroundColor: color, width: 13 }]} />
        <View style={[styles.aptosLine, { backgroundColor: color, width: 16 }]} />
        <View style={[styles.aptosLine, { backgroundColor: color, width: 10 }]} />
      </View>
    );
  }

  if (kind === 'bybit') {
    return <Text style={[styles.bybitMark, { color }]}>B</Text>;
  }

  const fallbackIcon: keyof typeof Ionicons.glyphMap =
    kind === 'exchange' ? 'trending-up' : kind === 'bank' ? 'card' : 'wallet';
  return <Ionicons name={fallbackIcon} size={20} color={color} />;
}

function getExchangeApiLabel(source: string, lang: Language): string {
  if (source === 'bybit_api') return t('bybitApiLabel', lang);
  if (source === 'binance_api') return t('binanceApiLabel', lang);
  if (source === 'okx_api') return t('okxApiLabel', lang);
  return t('exchangeApi', lang);
}

function parseExchangeBreakdown(rawText?: string | null): ExchangeBreakdownToken[] {
  if (!rawText) return [];

  try {
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed?.accounts)) return [];

    const tokens: ExchangeBreakdownToken[] = [];
    for (const account of parsed.accounts) {
      for (const coin of account.coins || []) {
        const balance = Number(coin.balance || 0);
        const usdValue = Number(coin.usdValue || 0);
        if (balance <= 0 || usdValue <= 0) continue;
        tokens.push({
          accountType: String(account.accountType || ''),
          coin: String(coin.coin || ''),
          balance,
          usdValue,
        });
      }
    }

    return tokens.sort((a, b) => b.usdValue - a.usdValue);
  } catch {
    return [];
  }
}

function formatTokenAmount(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export default function AccountsScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();
  const [lang, setLang] = useState<Language>('ru');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [accountNameInput, setAccountNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [ownerTypeInput, setOwnerTypeInput] = useState<OwnerType>('personal');
  const [ownershipInput, setOwnershipInput] = useState('100');
  const [balanceAmountInput, setBalanceAmountInput] = useState('');
  const [currencyInput, setCurrencyInput] = useState('USD');
  const [modelNoteInput, setModelNoteInput] = useState('');

  useEffect(() => {
    if (isFocused) {
      setLang(getSetting('language', 'ru') as Language);
      setAccounts(getLatestBalances());
    }
  }, [isFocused]);

  // Add Wallet state
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newAccountType, setNewAccountType] = useState<AccountType>('bank');
  const [newAccountOwnerType, setNewAccountOwnerType] = useState<OwnerType>('personal');
  const [newAccountOwnership, setNewAccountOwnership] = useState('100');
  const [newAccountBalance, setNewAccountBalance] = useState('0');
  const [newAccountCurrency, setNewAccountCurrency] = useState('USD');
  const [newAccountNote, setNewAccountNote] = useState('');
  const [newWalletNetwork, setNewWalletNetwork] = useState('solana_public_wallet');
  const [newWalletAddress, setNewWalletAddress] = useState('');

  // Connect Exchange state
  const [isConnectModalVisible, setIsConnectModalVisible] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState<ExchangeProvider>('Bybit');
  const [exchangeLabel, setExchangeLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // History state
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [historyAccount, setHistoryAccount] = useState<any>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);

  const openEditModal = (account: any) => {
    setSelectedAccount(account);
    setAccountNameInput(account.name || '');
    setAddressInput(account.address || '');
    setOwnerTypeInput((account.owner_type === 'company' ? 'company' : 'personal') as OwnerType);
    setOwnershipInput(String(account.ownership_percent || 100));
    setBalanceAmountInput(String(account.amount ?? 0));
    setCurrencyInput(account.currency || 'USD');
    setModelNoteInput(account.model_note || '');
    setIsEditModalVisible(true);
  };

  const openHistoryModal = (account: any) => {
    setHistoryAccount(account);
    const history = getAccountHistory(account.id);
    setHistoryData(history);
    setIsHistoryVisible(true);
  };

  const openAccountChat = (account: any) => {
    navigation.navigate('Chat');
  };

  const resetEditModal = () => {
    setIsEditModalVisible(false);
    setSelectedAccount(null);
    setAccountNameInput('');
    setAddressInput('');
    setOwnerTypeInput('personal');
    setOwnershipInput('100');
    setBalanceAmountInput('');
    setCurrencyInput('USD');
    setModelNoteInput('');
  };

  const saveAccountConfig = () => {
    if (!selectedAccount) return;
    
    const trimmedName = accountNameInput.trim();
    const trimmedAddress = addressInput.trim();
    const parsedOwnership = parseFloat(ownershipInput);
    const normalizedBalanceInput = balanceAmountInput.replace(',', '.').trim();
    const parsedBalanceAmount = Number(normalizedBalanceInput);
    const normalizedCurrency = currencyInput.trim().toUpperCase() || 'USD';

    if (!trimmedName) {
      Alert.alert(
        t('validationGoalTitle', lang),
        lang === 'ru' ? 'Пожалуйста, введите название счета.' : 'Please enter an account name.'
      );
      return;
    }

    if (!normalizedBalanceInput || !Number.isFinite(parsedBalanceAmount) || parsedBalanceAmount < 0) {
      Alert.alert(
        t('validationGoalTitle', lang),
        lang === 'ru' ? 'Пожалуйста, введите корректную сумму баланса.' : 'Please enter a valid balance amount.'
      );
      return;
    }
    
    try {
      updateAccountName(selectedAccount.id, trimmedName);
      updateAccountAddress(selectedAccount.id, trimmedAddress);
      updateAccountMetadata(
        selectedAccount.id,
        ownerTypeInput,
        Number.isFinite(parsedOwnership) ? parsedOwnership : 100,
        modelNoteInput,
        normalizedCurrency,
        trimmedAddress
      );

      const previousAmount = Number(selectedAccount.amount ?? 0);
      const previousCurrency = String(selectedAccount.currency || 'USD').toUpperCase();
      const didBalanceChange = Math.abs(parsedBalanceAmount - previousAmount) > 0.00000001;
      const didCurrencyChange = normalizedCurrency !== previousCurrency;
      if (didBalanceChange || didCurrencyChange) {
        executeBalanceUpdate(selectedAccount.id, parsedBalanceAmount, normalizedCurrency, 'set');
      }
      
      // Refresh state
      setAccounts(getLatestBalances());
      
      resetEditModal();
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), t('saveAddressError', lang));
    }
  };

  const handleCreateWallet = () => {
    const trimmedName = newWalletName.trim();
    const trimmedAddress = newWalletAddress.trim();
    const normalizedBalanceInput = newAccountBalance.replace(',', '.').trim();
    const parsedBalance = Number(normalizedBalanceInput);
    const parsedOwnership = Number(newAccountOwnership.replace(',', '.').trim());
    const normalizedCurrency = newAccountCurrency.trim().toUpperCase() || 'USD';

    if (!trimmedName) {
      Alert.alert(t('validationGoalTitle', lang), lang === 'ru' ? 'Пожалуйста, введите имя кошелька.' : 'Please enter a wallet name.');
      return;
    }

    if (!normalizedBalanceInput || !Number.isFinite(parsedBalance) || parsedBalance < 0) {
      Alert.alert(t('validationGoalTitle', lang), lang === 'ru' ? 'Введите корректный баланс.' : 'Please enter a valid balance.');
      return;
    }

    try {
      createManualAccount({
        name: trimmedName,
        type: newAccountType,
        ownerType: newAccountOwnerType,
        ownershipPercent: Number.isFinite(parsedOwnership) ? parsedOwnership : 100,
        amount: parsedBalance,
        currency: normalizedCurrency,
        modelNote: newAccountNote,
        address: trimmedAddress,
        source: newAccountType === 'crypto_wallet' ? newWalletNetwork : 'manual',
      });
      
      // Refresh state
      setAccounts(getLatestBalances());
      
      // Reset form
      setNewWalletName('');
      setNewAccountType('bank');
      setNewAccountOwnerType('personal');
      setNewAccountOwnership('100');
      setNewAccountBalance('0');
      setNewAccountCurrency('USD');
      setNewAccountNote('');
      setNewWalletNetwork('solana_public_wallet');
      setNewWalletAddress('');
      setIsAddModalVisible(false);
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), t('createWalletError', lang));
    }
  };

  const handleConnectExchange = async () => {
    const trimmedLabel = exchangeLabel.trim();
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();
    const trimmedPassphrase = apiPassphrase.trim();

    if (!trimmedLabel || !trimmedKey || !trimmedSecret || (selectedExchange === 'OKX' && !trimmedPassphrase)) {
      Alert.alert(t('validationGoalTitle', lang), t('validationExchangeDesc', lang));
      return;
    }

    setIsTestingConnection(true);
    try {
      // 1. Verify credentials by making a test API call
      let isValid = false;
      if (selectedExchange === 'Bybit') {
        isValid = await testBybitConnection(trimmedKey, trimmedSecret, isTestnet);
      } else if (selectedExchange === 'Binance') {
        isValid = await testBinanceConnection(trimmedKey, trimmedSecret, isTestnet);
      } else {
        isValid = await testOkxConnection(trimmedKey, trimmedSecret, trimmedPassphrase, isTestnet);
      }
      if (!isValid) {
        throw new Error(`Invalid credentials or response from ${selectedExchange}.`);
      }

      // 2. Add connection and account to SQLite & SecureStore
      const accountId = await addExchangeConnection(
        trimmedLabel,
        selectedExchange,
        trimmedKey,
        trimmedSecret,
        isTestnet,
        selectedExchange === 'OKX' ? trimmedPassphrase : undefined
      );

      // 3. Perform initial sync
      await syncExchangeBalance(accountId);

      // 4. Reset form & refresh list
      setExchangeLabel('');
      setApiKey('');
      setApiSecret('');
      setApiPassphrase('');
      setIsTestnet(false);
      setIsConnectModalVisible(false);
      setAccounts(getLatestBalances());
      
      Alert.alert(t('success', lang), t('exchangeSuccess', lang, { exchange: selectedExchange }));
    } catch (e: any) {
      console.error(e);
      Alert.alert(t('exchangeConnError', lang), t('exchangeConnErrorDesc', lang, { exchange: selectedExchange }));
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSyncSingleExchange = async (accountId: string) => {
    setSyncingAccountId(accountId);
    try {
      await syncExchangeBalance(accountId);
      setAccounts(getLatestBalances());
      Alert.alert(t('success', lang), t('syncSingleSuccess', lang));
    } catch (e: any) {
      console.error(e);
      Alert.alert(t('syncError', lang), t('syncErrorDesc', lang));
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleDeleteExchange = (accountId: string, accountName: string) => {
    Alert.alert(
      t('deleteConnectionTitle', lang),
      t('deleteConnectionDesc', lang, { name: accountName }),
      [
        { text: t('cancel', lang), style: "cancel" },
        { 
          text: t('clear', lang), 
          style: "destructive", 
          onPress: async () => {
            try {
              await deleteExchangeConnection(accountId);
              setAccounts(getLatestBalances());
              Alert.alert(t('deletedTitle', lang), t('deletedDesc', lang));
            } catch (e: any) {
              console.error(e);
              Alert.alert(t('error', lang), t('deleteError', lang));
            }
          }
        }
      ]
    );
  };

  const confirmDeleteSelectedAccount = () => {
    if (!selectedAccount) return;

    const accountId = selectedAccount.id;
    const accountName = selectedAccount.name || (lang === 'ru' ? 'счет' : 'account');

    Alert.alert(
      lang === 'ru' ? 'Удалить счет?' : 'Delete account?',
      lang === 'ru'
        ? `Удалить "${accountName}" и всю локальную историю балансов? Для API-подключений также удалятся локальные ключи. Это действие нельзя отменить.`
        : `Delete "${accountName}" and all local balance history? API connections will also remove local credentials. This cannot be undone.`,
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: lang === 'ru' ? 'Удалить' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount(accountId);
              setAccounts(getLatestBalances());
              resetEditModal();
              Alert.alert(
                t('deletedTitle', lang),
                lang === 'ru' ? 'Счет удален.' : 'Account deleted.'
              );
            } catch (e: any) {
              console.error(e);
              Alert.alert(
                t('error', lang),
                lang === 'ru' ? 'Не удалось удалить счет.' : 'Failed to delete account.'
              );
            }
          },
        },
      ]
    );
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      await Promise.all([
        syncPublicWallets(),
        syncAllExchanges()
      ]);
      setAccounts(getLatestBalances());
      Alert.alert(t('success', lang), t('syncSuccess', lang));
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось синхронизировать все балансы.' : 'Failed to update all balances.');
    } finally {
      setIsSyncingAll(false);
    }
  };


  const renderItem = ({ item }: { item: any }) => {
    const isCryptoWallet = item.source.endsWith('_wallet') || item.type === 'crypto_wallet';
    const isExchange = item.source.endsWith('_api') || item.type === 'exchange';
    const ownerType = item.owner_type || 'personal';
    const ownershipPercent = Number(item.ownership_percent || 100);
    const exchangeBreakdown = isExchange ? parseExchangeBreakdown(item.raw_text) : [];

    const visual = getAccountVisual(item);

    return (
      <TouchableOpacity
        style={[styles.card, ownerType === 'company' && styles.companyCard]}
        onPress={() => openHistoryModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.accountIcon, { backgroundColor: visual.soft }]}>
            {visual.mark ? (
              <ProviderMark kind={visual.mark} color={visual.color} />
            ) : (
              <Ionicons name={visual.icon || 'wallet'} size={20} color={visual.color} />
            )}
          </View>
          <View style={{ flex: 1, paddingHorizontal: spacing(2) }}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <View style={styles.metaRow}>
              <StatusChip
                label={ownerType === 'company' ? 'Company' : 'Personal'}
                tone={ownerType === 'company' ? 'info' : 'neutral'}
                icon={ownerType === 'company' ? 'business' : 'person'}
              />
              {ownerType === 'company' && (
                <StatusChip label={`${ownershipPercent}%`} tone="success" icon="pie-chart" />
              )}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.value}>${item.usd_value}</Text>
            {ownerType === 'company' && (
              <Text style={styles.ownedValue}>owned ≈ ${item.owned_usd_value}</Text>
            )}
          </View>
        </View>

        {item.model_note ? (
          <Text style={styles.modelNote}>{item.model_note}</Text>
        ) : null}

        {isCryptoWallet && (
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>{lang === 'ru' ? 'Адрес кошелька' : 'Wallet Address'}</Text>
            <View style={styles.addressRow}>
              <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
                {item.address || (lang === 'ru' ? 'Не настроен' : 'Not Configured')}
              </Text>
              <TouchableOpacity style={styles.iconButton} onPress={() => openEditModal(item)}>
                <Ionicons name="pencil" size={15} color={colors.accent} />
              </TouchableOpacity>
            </View>
            {exchangeBreakdown.length > 0 && (
              <View style={styles.tokenBreakdown}>
                {exchangeBreakdown.slice(0, 6).map((token) => (
                  <View key={`${token.accountType}-${token.coin}`} style={styles.tokenRow}>
                    <Text style={styles.tokenName} numberOfLines={1}>
                      {token.coin} {token.accountType ? `(${token.accountType})` : ''}
                    </Text>
                    <Text style={styles.tokenValue} numberOfLines={1}>
                      {formatTokenAmount(token.balance)} ≈ ${token.usdValue.toFixed(2)}
                    </Text>
                  </View>
                ))}
                {exchangeBreakdown.length > 6 && (
                  <Text style={styles.tokenMore}>
                    {lang === 'ru' ? `Еще ${exchangeBreakdown.length - 6} ток.` : `+${exchangeBreakdown.length - 6} more`}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {isExchange && (
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>{lang === 'ru' ? 'API интеграция' : 'API Integration'}</Text>
            <View style={styles.addressRow}>
              <Text style={styles.addressText} numberOfLines={1}>
                {getExchangeApiLabel(item.source, lang)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={[styles.iconButton, { backgroundColor: colors.accentSoft }]}
                  onPress={() => handleSyncSingleExchange(item.id)}
                  disabled={syncingAccountId === item.id}
                >
                  {syncingAccountId === item.id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="sync" size={15} color={colors.accent} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconButton, { backgroundColor: colors.dangerSoft }]}
                  onPress={() => handleDeleteExchange(item.id, item.name)}
                >
                  <Ionicons name="trash" size={15} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</Text>
          </View>
          <TouchableOpacity style={styles.inlineAskButton} onPress={() => openAccountChat(item)}>
            <Ionicons name="sparkles" size={13} color={colors.accent} />
            <Text style={styles.inlineEditText}>Ask</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.inlineEditButton} onPress={() => openEditModal(item)}>
            <Ionicons name="settings-outline" size={13} color={colors.accent} />
            <Text style={styles.inlineEditText}>{lang === 'ru' ? 'Настроить' : 'Configure'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHistoryItem = ({ item }: { item: any }) => {
    const exchangeBreakdown = parseExchangeBreakdown(item.raw_text);
    return (
      <View style={styles.historyRow}>
        <View style={{ flex: 1, paddingRight: spacing(2) }}>
          <Text style={styles.historySource}>{t('sourceLabel', lang)}: {item.source}</Text>
          <Text style={styles.historyDate}>{new Date(item.created_at).toLocaleString()}</Text>
          {exchangeBreakdown.length > 0 && (
            <View style={styles.historyTokenList}>
              {exchangeBreakdown.slice(0, 10).map((token) => (
                <Text key={`${token.accountType}-${token.coin}`} style={styles.historyTokenText}>
                  {token.coin} {formatTokenAmount(token.balance)} ≈ ${token.usdValue.toFixed(2)}
                </Text>
              ))}
            </View>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.historyAmount}>{item.amount} {item.currency}</Text>
          <Text style={styles.historyUsd}>${item.usd_value?.toFixed(2)}</Text>
        </View>
      </View>
    );
  };

  const personalAccounts = accounts.filter((item) => (item.owner_type || 'personal') !== 'company');
  const companyAccounts = accounts.filter((item) => item.owner_type === 'company');
  const sumUsd = (items: any[], field = 'usd_value') =>
    items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  const personalUsd = sumUsd(personalAccounts);
  const companyUsd = sumUsd(companyAccounts);
  const companyOwnedUsd = sumUsd(companyAccounts, 'owned_usd_value');
  const accountSections = [
    { title: lang === 'ru' ? 'Личные счета' : 'Personal accounts', total: personalUsd, data: personalAccounts },
    { title: lang === 'ru' ? 'Счета компании' : 'Company accounts', total: companyUsd, ownedTotal: companyOwnedUsd, data: companyAccounts },
  ].filter((section) => section.data.length > 0);

  const renderSectionHeader = ({ section }: { section: any }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.sectionTotal}>${section.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
        {section.ownedTotal !== undefined && (
          <Text style={styles.sectionOwned}>
            {lang === 'ru' ? 'твоя доля' : 'owned'} ${section.ownedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        )}
      </View>
    </View>
  );

  const renderListHeader = () => (
    <>
      <LinearGradient
        colors={gradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.summaryCard}
      >
        <View style={styles.summaryTopRow}>
          <Text style={styles.summaryTotalLabel}>{lang === 'ru' ? 'Все счета' : 'All accounts'}</Text>
          {isSyncingAll ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <TouchableOpacity style={styles.syncPill} onPress={handleSyncAll}>
              <Ionicons name="sync" size={13} color="#FFF" />
              <Text style={styles.syncPillText}>{lang === 'ru' ? 'Синхр.' : 'Sync'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.summaryTotal}>
          ${(personalUsd + companyUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </Text>
        <View style={styles.summarySplitRow}>
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>{lang === 'ru' ? 'Личные' : 'Personal'}</Text>
            <Text style={styles.summarySplitValue}>${personalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>{lang === 'ru' ? 'Компания' : 'Company'}</Text>
            <Text style={styles.summarySplitValue}>${companyUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            <Text style={styles.summarySplitSub}>
              {lang === 'ru' ? 'доля' : 'share'} ${companyOwnedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => setIsAddModalVisible(true)}>
          <Ionicons name="wallet-outline" size={18} color={colors.accent} />
          <Text style={styles.actionButtonText}>{lang === 'ru' ? 'Добавить счет' : 'Add account'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: colors.info }]}
          onPress={() => setIsConnectModalVisible(true)}
        >
          <Ionicons name="link-outline" size={18} color={colors.info} />
          <Text style={[styles.actionButtonText, { color: colors.info }]}>{t('connectExchange', lang)}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.listHeading}>{t('connectedAccounts', lang)}</Text>
    </>
  );

  return (
    <View style={styles.container}>
      <SectionList
        style={styles.accountsList}
        sections={accountSections}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={renderListHeader}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <EmptyState
            icon="wallet-outline"
            title={lang === 'ru' ? 'Нет подключённых счетов' : 'No accounts connected'}
            subtitle={lang === 'ru' ? 'Добавьте кошелёк или подключите биржу выше' : 'Add a wallet or connect an exchange above'}
          />
        }
      />

      {/* Edit Address Modal */}
      <Modal
        visible={isEditModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={resetEditModal}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>
                  {lang === 'ru' ? 'Настройка счета' : 'Account settings'}
                </Text>

                <FormInput
                  label={lang === 'ru' ? 'Название счета' : 'Account name'}
                  placeholder={lang === 'ru' ? 'Например: Halyk Bank' : 'Example: Halyk Bank'}
                  value={accountNameInput}
                  onChangeText={setAccountNameInput}
                  autoCapitalize="words"
                />

                <Text style={styles.inputLabel}>{lang === 'ru' ? 'Владелец' : 'Owner'}</Text>
                <View style={styles.segmentedRow}>
                  <TouchableOpacity
                    style={[styles.segmentButton, ownerTypeInput === 'personal' && styles.segmentButtonActive]}
                    onPress={() => setOwnerTypeInput('personal')}
                  >
                    <Text style={[styles.segmentButtonText, ownerTypeInput === 'personal' && styles.segmentButtonTextActive]}>
                      Personal
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentButton, ownerTypeInput === 'company' && styles.segmentButtonActive]}
                    onPress={() => setOwnerTypeInput('company')}
                  >
                    <Text style={[styles.segmentButtonText, ownerTypeInput === 'company' && styles.segmentButtonTextActive]}>
                      Company
                    </Text>
                  </TouchableOpacity>
                </View>

                <FormInput
                  label={lang === 'ru' ? 'Твоя доля, %' : 'Your share, %'}
                  placeholder="100"
                  value={ownershipInput}
                  onChangeText={setOwnershipInput}
                  keyboardType="numeric"
                />

                <FormInput
                  label={lang === 'ru' ? 'Баланс' : 'Balance'}
                  placeholder="0"
                  value={balanceAmountInput}
                  onChangeText={setBalanceAmountInput}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.inputLabel}>{lang === 'ru' ? 'Валюта счета' : 'Account currency'}</Text>
                <View style={styles.segmentedRow}>
                  {['USD', 'KZT', 'RUB'].map((currency) => (
                    <TouchableOpacity
                      key={currency}
                      style={[styles.segmentButton, currencyInput === currency && styles.segmentButtonActive]}
                      onPress={() => setCurrencyInput(currency)}
                    >
                      <Text style={[styles.segmentButtonText, currencyInput === currency && styles.segmentButtonTextActive]}>
                        {currency}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <FormInput
                  label={lang === 'ru' ? 'Комментарий для AI' : 'AI note'}
                  placeholder={lang === 'ru' ? 'Например: деньги компании, мне принадлежит 40%, рубли' : 'Example: company money, my share is 40%, RUB'}
                  value={modelNoteInput}
                  onChangeText={setModelNoteInput}
                  multiline
                />

                <FormInput
                  label={lang === 'ru' ? 'Адрес / реквизиты' : 'Address / details'}
                  placeholder={t('publicAddressPlaceholder', lang)}
                  value={addressInput}
                  onChangeText={setAddressInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                />
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={resetEditModal}
                  >
                    <Text style={styles.buttonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.saveButton]} 
                    onPress={saveAccountConfig}
                  >
                    <Text style={styles.buttonText}>{t('save', lang)}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.deleteAccountButton}
                  onPress={confirmDeleteSelectedAccount}
                >
                  <Ionicons name="trash" size={15} color={colors.danger} />
                  <Text style={styles.deleteAccountText}>
                    {lang === 'ru' ? 'Удалить счет' : 'Delete account'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Add Account Modal */}
      <Modal
        visible={isAddModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsAddModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{lang === 'ru' ? 'Добавить счет' : 'Add account'}</Text>
              
              <FormInput
                label={lang === 'ru' ? 'Название счета' : 'Account name'}
                placeholder={lang === 'ru' ? 'Например: Halyk Bank' : 'Example: Halyk Bank'}
                value={newWalletName}
                onChangeText={setNewWalletName}
                autoCapitalize="words"
              />

              <Text style={styles.inputLabel}>{lang === 'ru' ? 'Тип счета' : 'Account type'}</Text>
              <View style={styles.segmentedWrap}>
                {MANUAL_ACCOUNT_TYPES.map((item) => {
                  const isActive = newAccountType === item.type;
                  return (
                    <TouchableOpacity
                      key={item.type}
                      style={[styles.segmentButton, styles.segmentButtonCompact, isActive && styles.segmentButtonActive]}
                      onPress={() => setNewAccountType(item.type)}
                    >
                      <Ionicons name={item.icon} size={14} color={isActive ? colors.accent : colors.textSecondary} />
                      <Text style={[styles.segmentButtonText, isActive && styles.segmentButtonTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>{lang === 'ru' ? 'Владелец' : 'Owner'}</Text>
              <View style={styles.segmentedRow}>
                {(['personal', 'company'] as OwnerType[]).map((owner) => (
                  <TouchableOpacity
                    key={owner}
                    style={[styles.segmentButton, newAccountOwnerType === owner && styles.segmentButtonActive]}
                    onPress={() => setNewAccountOwnerType(owner)}
                  >
                    <Text style={[styles.segmentButtonText, newAccountOwnerType === owner && styles.segmentButtonTextActive]}>
                      {owner === 'personal' ? 'Personal' : 'Company'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <FormInput
                label={lang === 'ru' ? 'Твоя доля, %' : 'Your share, %'}
                placeholder="100"
                value={newAccountOwnership}
                onChangeText={setNewAccountOwnership}
                keyboardType="numeric"
              />

              <FormInput
                label={lang === 'ru' ? 'Начальный баланс' : 'Opening balance'}
                placeholder="0"
                value={newAccountBalance}
                onChangeText={setNewAccountBalance}
                keyboardType="decimal-pad"
              />

              <Text style={styles.inputLabel}>{lang === 'ru' ? 'Валюта' : 'Currency'}</Text>
              <View style={styles.segmentedRow}>
                {['USD', 'KZT', 'RUB', 'EUR'].map((currency) => (
                  <TouchableOpacity
                    key={currency}
                    style={[styles.segmentButton, newAccountCurrency === currency && styles.segmentButtonActive]}
                    onPress={() => setNewAccountCurrency(currency)}
                  >
                    <Text style={[styles.segmentButtonText, newAccountCurrency === currency && styles.segmentButtonTextActive]}>
                      {currency}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {newAccountType === 'crypto_wallet' && (
                <>
                  <Text style={styles.inputLabel}>{t('walletNetworkLabel', lang)}</Text>
                  <View style={styles.networkSelector}>
                    {Object.entries(NETWORK_META).map(([key, meta]) => {
                      const isActive = newWalletNetwork === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[styles.networkOptionRow, isActive && { borderColor: meta.color, backgroundColor: meta.soft }]}
                          onPress={() => setNewWalletNetwork(key)}
                        >
                          <View style={[styles.networkBadge, { backgroundColor: meta.soft, borderColor: meta.color }]}>
                            <ProviderMark kind={meta.mark} color={meta.color} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.networkOptionLabel, isActive && { color: meta.color }]}>{meta.label}</Text>
                            <Text style={styles.networkOptionSub}>{meta.abbr}</Text>
                          </View>
                          {isActive && <Ionicons name="checkmark-circle" size={18} color={meta.color} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <FormInput
                label={lang === 'ru' ? 'Адрес / реквизиты' : 'Address / details'}
                placeholder={lang === 'ru' ? 'Опционально' : 'Optional'}
                value={newWalletAddress}
                onChangeText={setNewWalletAddress}
                autoCapitalize="none"
                autoCorrect={false}
                mono
              />

              <FormInput
                label={lang === 'ru' ? 'Комментарий для AI' : 'AI note'}
                placeholder={lang === 'ru' ? 'Например: деньги компании, RUB' : 'Example: company money, RUB'}
                value={newAccountNote}
                onChangeText={setNewAccountNote}
                multiline
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setIsAddModalVisible(false)}
                >
                  <Text style={styles.buttonText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButton]} 
                  onPress={handleCreateWallet}
                >
                  <Text style={styles.buttonText}>{lang === 'ru' ? 'Добавить счет' : 'Add account'}</Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Connect Exchange Modal */}
      <Modal
        visible={isConnectModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsConnectModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <Text style={styles.modalTitle}>
                {t('connectExchangeTitle', lang, { exchange: selectedExchange })}
              </Text>

              <Text style={styles.inputLabel}>{t('exchangeProviderLabel', lang)}</Text>
              <View style={styles.segmentedRow}>
                {EXCHANGE_OPTIONS.map((exchange) => {
                  const isActive = selectedExchange === exchange;
                  const meta = EXCHANGE_META[exchange];
                  return (
                    <TouchableOpacity
                      key={exchange}
                      style={[styles.segmentButton, isActive && styles.segmentButtonActive]}
                      onPress={() => setSelectedExchange(exchange)}
                      disabled={isTestingConnection}
                    >
                      <View style={styles.exchangeOptionContent}>
                        <View style={[styles.exchangeMiniMark, { backgroundColor: meta.soft, borderColor: isActive ? meta.color : colors.border }]}>
                          <ProviderMark kind={meta.mark} color={meta.color} />
                        </View>
                        <Text style={[styles.segmentButtonText, isActive && styles.segmentButtonTextActive]}>
                          {exchange}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              
              <FormInput
                label={t('exchangeLabel', lang)}
                placeholder={t('exchangePlaceholder', lang)}
                value={exchangeLabel}
                onChangeText={setExchangeLabel}
              />

              <FormInput
                label={t('apiKeyLabel', lang)}
                placeholder={t('apiKeyPlaceholder', lang, { exchange: selectedExchange })}
                value={apiKey}
                onChangeText={setApiKey}
                autoCapitalize="none"
                autoCorrect={false}
                mono
              />

              <FormInput
                label={t('apiSecretLabel', lang)}
                placeholder={t('apiSecretPlaceholder', lang, { exchange: selectedExchange })}
                value={apiSecret}
                onChangeText={setApiSecret}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                mono
              />

              {selectedExchange === 'OKX' && (
                <FormInput
                  label={t('apiPassphraseLabel', lang)}
                  placeholder={t('apiPassphrasePlaceholder', lang)}
                  value={apiPassphrase}
                  onChangeText={setApiPassphrase}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                />
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <Text style={styles.inputLabel}>{t('testnetLabel', lang)}</Text>
                <Switch
                  value={isTestnet}
                  onValueChange={setIsTestnet}
                  trackColor={{ false: '#333', true: '#2196F3' }}
                  thumbColor={isTestnet ? '#FFF' : '#AAA'}
                />
              </View>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setIsConnectModalVisible(false)}
                  disabled={isTestingConnection}
                >
                  <Text style={styles.buttonText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButton, { backgroundColor: '#2196F3' }]} 
                  onPress={handleConnectExchange}
                  disabled={isTestingConnection}
                >
                  {isTestingConnection ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>{lang === 'ru' ? 'Подключить' : 'Connect'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Account History Modal */}
      <Modal
        visible={isHistoryVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsHistoryVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setIsHistoryVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { maxHeight: '80%' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={[styles.modalTitle, { marginBottom: 0 }]}>
                    {historyAccount?.name} {lang === 'ru' ? 'История балансов' : 'Balance History'}
                  </Text>
                  <TouchableOpacity onPress={() => setIsHistoryVisible(false)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                
                <FlatList
                  data={historyData}
                  keyExtractor={(item, index) => item.id || index.toString()}
                  renderItem={renderHistoryItem}
                  contentContainerStyle={{ gap: 12, paddingVertical: 10 }}
                  ListEmptyComponent={
                    <Text style={{ color: '#888', textAlign: 'center', marginVertical: 20 }}>
                      {lang === 'ru' ? 'История балансов не найдена.' : 'No balance history found.'}
                    </Text>
                  }
                />
                
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton, { marginTop: 16 }]} 
                  onPress={() => setIsHistoryVisible(false)}
                >
                  <Text style={styles.buttonText}>{t('close', lang)}</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing(4), backgroundColor: colors.bg },
  accountsList: { flex: 1 },
  listContent: { gap: 12, paddingBottom: spacing(5) },

  // Gradient summary
  summaryCard: {
    borderRadius: radius.xl,
    padding: spacing(5),
    marginBottom: spacing(4),
    ...shadow.floating,
  },
  summaryTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTotalLabel: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm, fontWeight: '600' },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  syncPillText: { color: '#FFF', fontSize: fontSize.xs, fontWeight: '700' },
  summaryTotal: { color: '#FFF', fontSize: fontSize.display, fontWeight: '900', letterSpacing: -0.5, marginTop: spacing(2) },
  summarySplitRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(3) },
  summarySplitItem: { flex: 1 },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: spacing(3) },
  summarySplitLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.xs },
  summarySplitValue: { color: '#FFF', fontSize: fontSize.lg, fontWeight: '800', marginTop: 2 },
  summarySplitSub: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.xs, marginTop: 2 },

  // Add actions
  actionRow: { flexDirection: 'row', gap: spacing(3), marginBottom: spacing(4) },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing(3),
  },
  actionButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  listHeading: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing(2),
  },

  // Account card
  card: { backgroundColor: colors.surface, padding: spacing(4), borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  companyCard: { borderColor: colors.info },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(3) },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  solanaMark: { width: 22, height: 18, justifyContent: 'space-between', transform: [{ rotate: '-8deg' }] },
  solanaBar: { width: 22, height: 4, borderRadius: 3 },
  aptosMark: { width: 22, height: 18, justifyContent: 'space-between', alignItems: 'center' },
  aptosLine: { height: 3, borderRadius: 3 },
  bybitMark: { fontSize: 20, fontWeight: '900' },
  ethereumMark: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  ethereumDiamond: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ethereumDiamondLower: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    opacity: 0.7,
  },
  binanceMark: { width: 22, height: 22 },
  binanceDiamond: {
    position: 'absolute',
    width: 6,
    height: 6,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
  },
  binanceDiamondTop: { left: 8, top: 1 },
  binanceDiamondLeft: { left: 1, top: 8 },
  binanceDiamondCenter: { left: 8, top: 8 },
  binanceDiamondRight: { right: 1, top: 8 },
  binanceDiamondBottom: { left: 8, bottom: 1 },
  okxMark: { width: 22, height: 22, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  okxCell: { width: 6, height: 6, backgroundColor: '#FFF', borderRadius: 1 },
  okxCellDim: { opacity: 0.35 },
  name: { color: colors.textPrimary, fontSize: fontSize.md, fontWeight: '700' },
  value: { color: colors.accent, fontSize: fontSize.lg, fontWeight: '800' },
  ownedValue: { color: colors.accent, fontSize: fontSize.xs, marginTop: 3 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  modelNote: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 17, marginBottom: spacing(2.5) },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing(3) },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  date: { color: colors.textMuted, fontSize: fontSize.xs },

  addressContainer: {
    backgroundColor: colors.bg,
    padding: spacing(2.5),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 4,
  },
  addressLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  addressText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    flex: 1,
  },
  tokenBreakdown: {
    marginTop: spacing(2),
    paddingTop: spacing(2),
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 5,
  },
  tokenRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  tokenName: { color: colors.textSecondary, fontSize: fontSize.xs, flex: 1 },
  tokenValue: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: '700', textAlign: 'right' },
  tokenMore: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  iconButton: {
    backgroundColor: colors.accentSoft,
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    paddingVertical: 5,
  },
  inlineAskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    paddingVertical: 5,
    marginRight: spacing(2),
  },
  inlineEditText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionTotal: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: '700' },
  sectionOwned: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },

  // Modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.75)' },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(6),
    paddingBottom: Platform.OS === 'ios' ? spacing(10) : spacing(6),
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing(4) },
  inputLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600', marginBottom: 6 },
  modalInput: {
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.sm,
    padding: spacing(3),
    color: colors.textPrimary,
    fontSize: fontSize.md,
    marginBottom: spacing(4),
    borderWidth: 1,
    borderColor: colors.border,
  },
  multilineInput: { minHeight: 78, textAlignVertical: 'top' },
  segmentedRow: { flexDirection: 'row', gap: 8, marginBottom: spacing(4) },
  segmentedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing(4) },
  segmentButton: {
    flex: 1,
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentButtonCompact: { flex: 0, minWidth: 92, paddingHorizontal: spacing(2) },
  segmentButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  segmentButtonText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  segmentButtonTextActive: { color: colors.accent },
  exchangeOptionContent: { alignItems: 'center', gap: 6 },
  exchangeMiniMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  networkSelector: { gap: 8, marginBottom: spacing(4) },
  networkOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(3),
  },
  networkBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  networkBadgeText: { color: '#FFF', fontSize: fontSize.sm, fontWeight: '800' },
  networkOptionLabel: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: '700' },
  networkOptionSub: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  modalButtons: { flexDirection: 'row', gap: spacing(3), marginTop: spacing(2) },
  modalButton: { flex: 1, paddingVertical: spacing(3), borderRadius: radius.sm, alignItems: 'center' },
  cancelButton: { backgroundColor: colors.surfaceAlt },
  saveButton: { backgroundColor: colors.accent },
  buttonText: { color: '#FFF', fontWeight: '700', fontSize: fontSize.md },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing(3),
    paddingVertical: spacing(3),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  deleteAccountText: { color: colors.danger, fontWeight: '800', fontSize: fontSize.md },

  // History styles
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  historySource: { color: colors.textPrimary, fontSize: fontSize.md, fontWeight: '600', textTransform: 'capitalize' },
  historyDate: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4 },
  historyTokenList: { marginTop: spacing(1.5), gap: 3 },
  historyTokenText: { color: colors.textSecondary, fontSize: fontSize.xs },
  historyAmount: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  historyUsd: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4 },
});
