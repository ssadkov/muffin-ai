import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  SectionList,
  TouchableOpacity, 
  Modal, 
  TextInput, 
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  Switch
} from 'react-native';
import { 
  getLatestBalances, 
  updateAccountAddress, 
  createWalletAccount, 
  getAccountHistory,
  addExchangeConnection,
  syncExchangeBalance,
  deleteExchangeConnection,
  syncAllExchanges,
  getSetting
} from '../tools/databaseTools';
import { testBybitConnection } from '../services/bybitService';
import { syncPublicWallets } from '../services/walletSyncService';
import { useIsFocused } from '@react-navigation/native';
import { t, Language } from '../localization/localization';

export default function AccountsScreen() {
  const isFocused = useIsFocused();
  const [lang, setLang] = useState<Language>('ru');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [addressInput, setAddressInput] = useState('');

  useEffect(() => {
    if (isFocused) {
      setLang(getSetting('language', 'ru') as Language);
    }
  }, [isFocused]);

  // Add Wallet state
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletNetwork, setNewWalletNetwork] = useState('solana_public_wallet');
  const [newWalletAddress, setNewWalletAddress] = useState('');

  // Connect Exchange state
  const [isConnectModalVisible, setIsConnectModalVisible] = useState(false);
  const [exchangeLabel, setExchangeLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // History state
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [historyAccount, setHistoryAccount] = useState<any>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);

  useEffect(() => {
    setAccounts(getLatestBalances());
  }, []);

  const openEditModal = (account: any) => {
    setSelectedAccount(account);
    setAddressInput(account.address || '');
    setIsEditModalVisible(true);
  };

  const openHistoryModal = (account: any) => {
    setHistoryAccount(account);
    const history = getAccountHistory(account.id);
    setHistoryData(history);
    setIsHistoryVisible(true);
  };

  const saveAddress = () => {
    if (!selectedAccount) return;
    
    const trimmedAddress = addressInput.trim();
    
    try {
      updateAccountAddress(selectedAccount.id, trimmedAddress);
      
      // Refresh state
      setAccounts(getLatestBalances());
      
      setIsEditModalVisible(false);
      setSelectedAccount(null);
      setAddressInput('');
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

    if (!trimmedLabel || !trimmedKey || !trimmedSecret) {
      Alert.alert(t('validationGoalTitle', lang), t('validationExchangeDesc', lang));
      return;
    }

    setIsTestingConnection(true);
    try {
      // 1. Verify credentials by making a test API call
      const isValid = await testBybitConnection(trimmedKey, trimmedSecret, isTestnet);
      if (!isValid) {
        throw new Error("Invalid credentials or response from Bybit.");
      }

      // 2. Add connection and account to SQLite & SecureStore
      const accountId = await addExchangeConnection(trimmedLabel, 'Bybit', trimmedKey, trimmedSecret, isTestnet);

      // 3. Perform initial sync
      await syncExchangeBalance(accountId);

      // 4. Reset form & refresh list
      setExchangeLabel('');
      setApiKey('');
      setApiSecret('');
      setIsTestnet(false);
      setIsConnectModalVisible(false);
      setAccounts(getLatestBalances());
      
      Alert.alert(t('success', lang), t('bybitSuccess', lang));
    } catch (e: any) {
      console.error(e);
      Alert.alert(t('exchangeConnError', lang), t('exchangeConnErrorDesc', lang));
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

    return (
      <TouchableOpacity 
        style={[styles.card, ownerType === 'company' && styles.companyCard]} 
        onPress={() => openHistoryModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.name}>{item.name}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.ownerBadge, ownerType === 'company' && styles.companyBadge]}>
                {ownerType === 'company' ? 'Company' : 'Personal'}
              </Text>
              {ownerType === 'company' && (
                <Text style={styles.shareBadge}>{ownershipPercent}% share</Text>
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
            <Text style={styles.addressLabel}>{lang === 'ru' ? 'Адрес кошелька:' : 'Wallet Address:'}</Text>
            <View style={styles.addressRow}>
              <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
                {item.address || (lang === 'ru' ? 'Не настроен' : 'Not Configured')}
              </Text>
              <TouchableOpacity 
                style={styles.editButton} 
                onPress={() => openEditModal(item)}
              >
                <Text style={styles.editButtonText}>{lang === 'ru' ? '✏️ Изменить' : '✏️ Edit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isExchange && (
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>{lang === 'ru' ? 'API интеграция:' : 'API Integration:'}</Text>
            <View style={styles.addressRow}>
              <Text style={styles.addressText} numberOfLines={1}>
                {item.source === 'bybit_api' ? t('bybitApiLabel', lang) : t('exchangeApi', lang)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity 
                  style={[styles.editButton, { backgroundColor: '#4CAF50' }]} 
                  onPress={() => handleSyncSingleExchange(item.id)}
                  disabled={syncingAccountId === item.id}
                >
                  {syncingAccountId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.editButtonText}>{lang === 'ru' ? '🔄 Синхр.' : '🔄 Sync'}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.editButton, { backgroundColor: '#d32f2f' }]} 
                  onPress={() => handleDeleteExchange(item.id, item.name)}
                >
                  <Text style={styles.editButtonText}>{t('deleteButton', lang)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.source}>{item.source}</Text>
          <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</Text>
        </View>
        <Text style={styles.tapTip}>{t('tapToViewHistory', lang)}</Text>
      </TouchableOpacity>
    );
  };

  const renderHistoryItem = ({ item }: { item: any }) => (
    <View style={styles.historyRow}>
      <View>
        <Text style={styles.historySource}>{t('sourceLabel', lang)}: {item.source}</Text>
        <Text style={styles.historyDate}>{new Date(item.created_at).toLocaleString()}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.historyAmount}>{item.amount} {item.currency}</Text>
        <Text style={styles.historyUsd}>${item.usd_value?.toFixed(2)}</Text>
      </View>
    </View>
  );

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

  return (
    <View style={styles.container}>
      {/* Header Add Buttons */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
        <TouchableOpacity 
          style={[styles.addButton, { flex: 1, marginBottom: 0 }]} 
          onPress={() => setIsAddModalVisible(true)}
        >
          <Text style={styles.addButtonText}>{t('addWallet', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.addButton, { flex: 1, marginBottom: 0, borderColor: '#2196F3' }]} 
          onPress={() => setIsConnectModalVisible(true)}
        >
          <Text style={[styles.addButtonText, { color: '#2196F3' }]}>{t('connectBybit', lang)}</Text>
        </TouchableOpacity>
      </View>

      {/* Sync All Button */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: '#888', fontSize: 13 }}>{t('connectedAccounts', lang)}</Text>
        {isSyncingAll ? (
          <ActivityIndicator size="small" color="#4CAF50" />
        ) : (
          <TouchableOpacity onPress={handleSyncAll}>
            <Text style={{ color: '#4CAF50', fontSize: 13, fontWeight: 'bold' }}>{t('syncAll', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryLabel}>{lang === 'ru' ? 'Личные' : 'Personal'}</Text>
          <Text style={styles.summaryValue}>${personalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.summaryLabel}>{lang === 'ru' ? 'Компания' : 'Company'}</Text>
          <Text style={styles.summaryValue}>${companyUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
          <Text style={styles.summarySub}>
            {lang === 'ru' ? 'доля' : 'share'} ${companyOwnedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        </View>
      </View>

      <SectionList
        sections={accountSections}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={{ gap: 12, paddingBottom: 20 }}
        stickySectionHeadersEnabled={false}
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
              <Text style={styles.modalTitle}>
                {t('editAddress', lang)}: {selectedAccount?.name}
              </Text>
              
              <TextInput
                style={styles.modalInput}
                placeholder={t('publicAddressPlaceholder', lang)}
                placeholderTextColor="#666"
                value={addressInput}
                onChangeText={setAddressInput}
                autoCapitalize="none"
                autoCorrect={false}
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
                  onPress={saveAddress}
                >
                  <Text style={styles.buttonText}>{t('save', lang)}</Text>
                </TouchableOpacity>
              </View>
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
              
              <Text style={styles.inputLabel}>{t('newWalletNameLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('newWalletNamePlaceholder', lang)}
                placeholderTextColor="#666"
                value={newWalletName}
                onChangeText={setNewWalletName}
              />

              <Text style={styles.inputLabel}>{t('walletNetworkLabel', lang)}</Text>
              <View style={styles.networkSelector}>
                <TouchableOpacity 
                  style={[styles.networkButton, newWalletNetwork === 'solana_public_wallet' && styles.networkButtonActive]}
                  onPress={() => setNewWalletNetwork('solana_public_wallet')}
                >
                  <Text style={[styles.networkButtonText, newWalletNetwork === 'solana_public_wallet' && styles.networkButtonTextActive]}>Solana</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.networkButton, newWalletNetwork === 'aptos_public_wallet' && styles.networkButtonActive]}
                  onPress={() => setNewWalletNetwork('aptos_public_wallet')}
                >
                  <Text style={[styles.networkButtonText, newWalletNetwork === 'aptos_public_wallet' && styles.networkButtonTextActive]}>Aptos</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.networkButton, newWalletNetwork === 'ethereum_public_wallet' && styles.networkButtonActive]}
                  onPress={() => setNewWalletNetwork('ethereum_public_wallet')}
                >
                  <Text style={[styles.networkButtonText, newWalletNetwork === 'ethereum_public_wallet' && styles.networkButtonTextActive]}>Ethereum / Other</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>{t('walletAddressLabel', lang)}</Text>
              <TextInput
                style={[styles.modalInput, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}
                placeholder={t('walletAddressPlaceholder', lang)}
                placeholderTextColor="#666"
                value={newWalletAddress}
                onChangeText={setNewWalletAddress}
                autoCapitalize="none"
                autoCorrect={false}
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

      {/* Connect Bybit Exchange Modal */}
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
              <Text style={styles.modalTitle}>{lang === 'ru' ? 'Подключение биржи Bybit' : 'Connect Bybit Exchange'}</Text>
              
              <Text style={styles.inputLabel}>{t('exchangeLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('exchangePlaceholder', lang)}
                placeholderTextColor="#666"
                value={exchangeLabel}
                onChangeText={setExchangeLabel}
              />

              <Text style={styles.inputLabel}>{t('apiKeyLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={lang === 'ru' ? 'Введите API Key Bybit' : 'Enter Bybit API Key'}
                placeholderTextColor="#666"
                value={apiKey}
                onChangeText={setApiKey}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>{t('apiSecretLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={lang === 'ru' ? 'Введите API Secret Bybit' : 'Enter Bybit API Secret'}
                placeholderTextColor="#666"
                value={apiSecret}
                onChangeText={setApiSecret}
                secureTextEntry={true}
                autoCapitalize="none"
                autoCorrect={false}
              />

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
                    <Text style={{ color: '#888', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
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
  container: { flex: 1, padding: 16, backgroundColor: '#121212' },
  addButton: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16
  },
  addButtonText: {
    color: '#4CAF50',
    fontSize: 15,
    fontWeight: 'bold'
  },
  card: { backgroundColor: '#1E1E1E', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  name: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  value: { color: '#4CAF50', fontSize: 16, fontWeight: 'bold' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  source: { color: '#888', fontSize: 12 },
  date: { color: '#888', fontSize: 12 },
  tapTip: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic'
  },
  
  addressContainer: {
    backgroundColor: '#151515',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#252525',
    marginVertical: 4
  },
  addressLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  addressText: {
    color: '#CCC',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    flex: 1
  },
  editButton: {
    backgroundColor: '#333',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6
  },
  editButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '500'
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.75)'
  },
  modalContent: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderWidth: 1,
    borderColor: '#333'
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16
  },
  inputLabel: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#444'
  },
  networkSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16
  },
  networkButton: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  networkButtonActive: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.1)'
  },
  networkButtonText: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: '600'
  },
  networkButtonTextActive: {
    color: '#4CAF50'
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center'
  },
  cancelButton: {
    backgroundColor: '#333'
  },
  saveButton: {
    backgroundColor: '#4CAF50'
  },
  buttonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15
  },
  summaryCard: {
    backgroundColor: '#181818',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2E2E2E',
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  summaryLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4
  },
  summaryValue: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold'
  },
  summarySub: {
    color: '#9CCC65',
    fontSize: 12,
    marginTop: 2
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 2
  },
  sectionTitle: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  sectionTotal: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700'
  },
  sectionOwned: {
    color: '#888',
    fontSize: 11,
    marginTop: 2
  },
  companyCard: {
    borderColor: '#3F51B5'
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap'
  },
  ownerBadge: {
    color: '#BDBDBD',
    backgroundColor: '#2A2A2A',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700'
  },
  companyBadge: {
    color: '#C5CAE9',
    backgroundColor: '#28335F'
  },
  shareBadge: {
    color: '#9CCC65',
    backgroundColor: '#20301E',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700'
  },
  ownedValue: {
    color: '#9CCC65',
    fontSize: 11,
    marginTop: 3
  },
  modelNote: {
    color: '#AAA',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10
  },

  // History styles
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    alignItems: 'center'
  },
  historySource: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize'
  },
  historyDate: {
    color: '#888',
    fontSize: 12,
    marginTop: 4
  },
  historyAmount: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: 'bold'
  },
  historyUsd: {
    color: '#AAA',
    fontSize: 12,
    marginTop: 4
  }
});
