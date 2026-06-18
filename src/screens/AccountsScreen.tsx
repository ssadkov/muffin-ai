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
  createWalletAccount, 
  getAccountHistory,
  addExchangeConnection,
  syncExchangeBalance,
  deleteExchangeConnection,
  syncAllExchanges,
  getSetting,
  updateAccountMetadata,
  updateAccountName,
  executeBalanceUpdate,
  OwnerType
} from '../tools/databaseTools';
import { testBybitConnection } from '../services/bybitService';
import { testBinanceConnection } from '../services/binanceService';
import { testOkxConnection } from '../services/okxService';
import { syncPublicWallets } from '../services/walletSyncService';
import { useIsFocused } from '@react-navigation/native';
import { t, Language } from '../localization/localization';

type ExchangeProvider = 'Bybit' | 'Binance' | 'OKX';
type ExchangeBreakdownToken = {
  accountType: string;
  coin: string;
  balance: number;
  usdValue: number;
};

const NETWORK_META: Record<string, { label: string; color: string; soft: string; abbr: string }> = {
  'solana_public_wallet':   { label: 'Solana',   color: '#9945FF', soft: 'rgba(153,69,255,0.14)', abbr: 'SOL' },
  'aptos_public_wallet':    { label: 'Aptos',    color: '#00C8FF', soft: 'rgba(0,200,255,0.14)',   abbr: 'APT' },
  'ethereum_public_wallet': { label: 'Ethereum', color: '#627EEA', soft: 'rgba(98,126,234,0.14)',  abbr: 'ETH' },
};

const EXCHANGE_OPTIONS: ExchangeProvider[] = ['Bybit', 'Binance', 'OKX'];

function getAccountVisual(item: any): { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string } {
  const isCryptoWallet = item.source?.endsWith('_wallet') || item.type === 'crypto_wallet';
  const isExchange = item.source?.endsWith('_api') || item.type === 'exchange';
  if (isExchange) return { icon: 'trending-up', color: colors.info, soft: colors.infoSoft };
  if (isCryptoWallet) return { icon: 'wallet', color: colors.accent, soft: colors.accentSoft };
  return { icon: 'card', color: colors.textSecondary, soft: colors.surfaceAlt };
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
      
      setIsEditModalVisible(false);
      setSelectedAccount(null);
      setAccountNameInput('');
      setAddressInput('');
      setOwnershipInput('100');
      setBalanceAmountInput('');
      setCurrencyInput('USD');
      setModelNoteInput('');
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), t('saveAddressError', lang));
    }
  };

  const handleCreateWallet = () => {
    const trimmedName = newWalletName.trim();
    const trimmedAddress = newWalletAddress.trim();

    if (!trimmedName) {
      Alert.alert(t('validationGoalTitle', lang), lang === 'ru' ? 'Пожалуйста, введите имя кошелька.' : 'Please enter a wallet name.');
      return;
    }

    try {
      createWalletAccount(trimmedName, newWalletNetwork, trimmedAddress);
      
      // Refresh state
      setAccounts(getLatestBalances());
      
      // Reset form
      setNewWalletName('');
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
            <Ionicons name={visual.icon} size={20} color={visual.color} />
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
          <Text style={styles.actionButtonText}>{lang === 'ru' ? 'Добавить кошелёк' : 'Add wallet'}</Text>
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
        onRequestClose={() => setIsEditModalVisible(false)}
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
                    onPress={() => setIsEditModalVisible(false)}
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
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Add New Wallet Modal */}
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
              <Text style={styles.modalTitle}>{lang === 'ru' ? 'Добавить кошелек' : 'Add New Wallet'}</Text>
              
              <FormInput
                label={t('newWalletNameLabel', lang)}
                placeholder={t('newWalletNamePlaceholder', lang)}
                value={newWalletName}
                onChangeText={setNewWalletName}
              />

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
                      <View style={[styles.networkBadge, { backgroundColor: meta.color }]}>
                        <Text style={styles.networkBadgeText}>{meta.abbr.charAt(0)}</Text>
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

              <FormInput
                label={t('walletAddressLabel', lang)}
                placeholder={t('walletAddressPlaceholder', lang)}
                value={newWalletAddress}
                onChangeText={setNewWalletAddress}
                autoCapitalize="none"
                autoCorrect={false}
                mono
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
                  <Text style={styles.buttonText}>{t('addWallet', lang)}</Text>
                </TouchableOpacity>
              </View>
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
                  return (
                    <TouchableOpacity
                      key={exchange}
                      style={[styles.segmentButton, isActive && styles.segmentButtonActive]}
                      onPress={() => setSelectedExchange(exchange)}
                      disabled={isTestingConnection}
                    >
                      <Text style={[styles.segmentButtonText, isActive && styles.segmentButtonTextActive]}>
                        {exchange}
                      </Text>
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
  },
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
  segmentButton: {
    flex: 1,
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing(2.5),
    alignItems: 'center',
  },
  segmentButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  segmentButtonText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  segmentButtonTextActive: { color: colors.accent },
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
