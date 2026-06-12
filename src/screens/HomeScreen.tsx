import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Modal, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform, 
  TouchableWithoutFeedback, 
  Keyboard,
  Alert,
  ActivityIndicator,
  Share
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { 
  getTotalLiquidAssets, 
  getActiveGoals, 
  updateGoal, 
  syncAllExchanges, 
  getSetting, 
  setSetting,
  getBalanceGroups,
  getPaymentCoverageSummary
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';
import { fetchAndUpdateRates, getLastRatesUpdate } from '../services/exchangeRateService';
import { exportAuditLogs, clearAuditLogs } from '../services/inferenceLogService';
import { syncPublicWallets } from '../services/walletSyncService';
import { schedulePaymentReminders } from '../services/paymentReminderService';
import { t, Language } from '../localization/localization';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  
  const [assets, setAssets] = useState(0);
  const [goal, setGoal] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [lang, setLang] = useState<Language>('ru');
  const [balanceGroups, setBalanceGroups] = useState<any>(null);
  const [paymentSummary, setPaymentSummary] = useState<any>(null);

  // Goal modal states
  const [isGoalModalVisible, setIsGoalModalVisible] = useState(false);
  const [goalTitleInput, setGoalTitleInput] = useState('');
  const [goalTargetInput, setGoalTargetInput] = useState('');

  // Exchange rates states
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lastRatesUpdate, setLastRatesUpdate] = useState<string | null>(null);

  useEffect(() => {
    if (isFocused) {
      const currentLang = getSetting('language', 'ru') as Language;
      setLang(currentLang);
    }
  }, [isFocused]);

  useEffect(() => {
    if (isFocused) {
      refreshData();
      // Sync public wallets and exchange accounts in the background when the screen is focused
      Promise.all([
        syncPublicWallets(),
        syncAllExchanges()
      ])
        .then(() => {
          refreshData();
          schedulePaymentReminders();
        })
        .catch(err => console.error("Auto-sync error on load:", err));
    }
  }, [isFocused]);

  const refreshData = () => {
    setAssets(getTotalLiquidAssets());
    setBalanceGroups(getBalanceGroups());
    setPaymentSummary(getPaymentCoverageSummary(31));
    const goals = getActiveGoals();
    if (goals.length > 0) {
      setGoal(goals[0]);
    } else {
      setGoal(null);
    }
    setWarnings(checkMoneyRules());
    setLastRatesUpdate(getLastRatesUpdate());
  };

  const refreshExchangeRates = async () => {
    setIsRefreshingRates(true);
    try {
      const success = await fetchAndUpdateRates();
      if (success) {
        // Sync public wallet portfolios and exchange accounts
        await Promise.all([
          syncPublicWallets(),
          syncAllExchanges()
        ]);
        refreshData();
      } else {
        Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось обновить курсы валют. Пожалуйста, проверьте интернет-соединение.' : 'Failed to update exchange rates. Please check your internet connection.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось обновить курсы и балансы.' : 'Failed to update exchange rates and account balances.');
    } finally {
      setIsRefreshingRates(false);
    }
  };

  const openGoalModal = () => {
    setGoalTitleInput(goal ? goal.title : '');
    setGoalTargetInput(goal ? goal.target_value.toString() : '');
    setIsGoalModalVisible(true);
  };

  const saveGoalConfig = () => {
    const trimmedTitle = goalTitleInput.trim();
    const parsedTarget = parseFloat(goalTargetInput);

    if (isNaN(parsedTarget) || parsedTarget <= 0) {
      Alert.alert(t('validationGoalTitle', lang), t('validationGoalDesc', lang));
      return;
    }

    try {
      updateGoal(parsedTarget, trimmedTitle || undefined);
      refreshData();
      setIsGoalModalVisible(false);
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), t('saveGoalError', lang));
    }
  };

  const handleShareLogs = async () => {
    try {
      const { content } = await exportAuditLogs();
      if (!content || content === '[]') {
        Alert.alert(t('noLogsTitle', lang), t('noLogsDesc', lang));
        return;
      }
      await Share.share({
        message: content,
        title: 'QVAC Inference Audit Log'
      });
    } catch (e: any) {
      console.error(e);
      Alert.alert(t('error', lang), (lang === 'ru' ? 'Не удалось экспортировать логи: ' : 'Failed to share logs: ') + (e?.message || String(e)));
    }
  };

  const handleClearLogs = () => {
    Alert.alert(
      t('confirmClearLogsTitle', lang),
      t('confirmClearLogsDesc', lang),
      [
        { text: t('cancel', lang), style: "cancel" },
        { 
          text: t('clear', lang), 
          style: "destructive", 
          onPress: async () => {
            await clearAuditLogs();
            Alert.alert(t('success', lang), t('logsCleared', lang));
          } 
        }
      ]
    );
  };

  const progress = goal && goal.target_value > 0 ? ((assets / goal.target_value) * 100).toFixed(1) : "0.0";

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>{t('privateMemory', lang)}</Text>
          <View style={styles.langToggleContainer}>
            <TouchableOpacity 
              style={[styles.langToggleBtn, lang === 'ru' && styles.langToggleBtnActive]} 
              onPress={() => {
                setSetting('language', 'ru');
                setLang('ru');
              }}
            >
              <Text style={[styles.langToggleText, lang === 'ru' && styles.langToggleTextActive]}>RU</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.langToggleBtn, lang === 'en' && styles.langToggleBtnActive]} 
              onPress={() => {
                setSetting('language', 'en');
                setLang('en');
              }}
            >
              <Text style={[styles.langToggleText, lang === 'en' && styles.langToggleTextActive]}>EN</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity 
          style={styles.card} 
          onPress={() => navigation.navigate('Accounts')}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>{t('totalLiquidAssets', lang)}</Text>
            <TouchableOpacity 
              onPress={refreshExchangeRates} 
              style={[styles.miniEditButton, { backgroundColor: isRefreshingRates ? '#2E2E2E' : '#333' }]}
              disabled={isRefreshingRates}
            >
              <Text style={styles.miniEditButtonText}>
                {isRefreshingRates ? t('updatingRates', lang) : t('liveRates', lang)}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.cardValue}>${assets.toLocaleString()}</Text>
          {lastRatesUpdate && (
            <Text style={styles.ratesUpdateTime}>
              {t('ratesUpdated', lang)}: {new Date(lastRatesUpdate).toLocaleString()}
            </Text>
          )}
        </TouchableOpacity>

        {balanceGroups && (
          <View style={styles.splitGrid}>
            <TouchableOpacity
              style={styles.splitCard}
              onPress={() => navigation.navigate('Accounts')}
              activeOpacity={0.7}
            >
              <Text style={styles.splitLabel}>{lang === 'ru' ? 'Личные счета' : 'Personal'}</Text>
              <Text style={styles.splitValue}>${balanceGroups.personalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.splitCard, { borderColor: '#3F51B5' }]}
              onPress={() => navigation.navigate('Accounts')}
              activeOpacity={0.7}
            >
              <Text style={styles.splitLabel}>{lang === 'ru' ? 'Компания' : 'Company'}</Text>
              <Text style={styles.splitValue}>${balanceGroups.companyUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={styles.splitSub}>
                {lang === 'ru' ? 'твоя доля' : 'owned'} ${balanceGroups.companyOwnedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {paymentSummary && (
          <View style={[styles.card, paymentSummary.isCovered ? styles.paymentOkCard : styles.paymentRiskCard]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>{lang === 'ru' ? 'Payment Radar' : 'Payment Radar'}</Text>
              <Text style={paymentSummary.isCovered ? styles.paymentOkText : styles.paymentRiskText}>
                {paymentSummary.isCovered ? (lang === 'ru' ? 'Покрыто' : 'Covered') : (lang === 'ru' ? 'Риск' : 'Risk')}
              </Text>
            </View>
            <Text style={styles.paymentTitle}>
              {paymentSummary.payments.length} {lang === 'ru' ? 'платежей за 31 день' : 'payments in 31 days'}
            </Text>
            <Text style={styles.paymentSub}>
              {lang === 'ru' ? 'Итого' : 'Total'} ≈ ${paymentSummary.totalDueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </Text>
            {paymentSummary.deficits.slice(0, 2).map((deficit: any, index: number) => (
              <Text key={`${deficit.owner_type}-${deficit.currency}-${index}`} style={styles.paymentDeficit}>
                {lang === 'ru'
                  ? `${deficit.owner_type}: не хватает ${deficit.missing} ${deficit.currency}`
                  : `${deficit.owner_type}: missing ${deficit.missing} ${deficit.currency}`}
              </Text>
            ))}
          </View>
        )}

        {goal ? (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>{t('goalTitle', lang)}: {goal.title}</Text>
              <TouchableOpacity onPress={openGoalModal} style={styles.miniEditButton}>
                <Text style={styles.miniEditButtonText}>{lang === 'ru' ? '✏️ Изменить' : '✏️ Edit'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.cardValue}>
              {progress}% <Text style={styles.goalDetail}>(${assets.toLocaleString()} / ${goal.target_value?.toLocaleString()})</Text>
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.min(100, parseFloat(progress))}%` as any }]} />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>{t('savingGoal', lang)}</Text>
            </View>
            <Text style={[styles.cardValue, { fontSize: 15, color: '#888', fontWeight: 'normal', marginBottom: 12 }]}>
              {t('noActiveGoal', lang)}
            </Text>
            <TouchableOpacity 
              style={[styles.button, { backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: '#4CAF50', padding: 12 }]} 
              onPress={openGoalModal}
            >
              <Text style={[styles.buttonText, { color: '#4CAF50' }]}>{t('setSavingGoal', lang)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {warnings.length > 0 && (
          <View style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningTitle}>
              {warnings.length} {lang === 'ru' ? 'Предупреждений правил' : 'Rule Warnings'}
            </Text>
            {warnings.map((w, i) => (
              <Text key={i} style={styles.warningText}>• {w.message}</Text>
            ))}
          </View>
        )}

        <View style={[styles.card, { borderColor: '#4CAF50' }]}>
          <Text style={[styles.cardLabel, { color: '#4CAF50', fontWeight: 'bold' }]}>{t('hackathonLogs', lang)}</Text>
          <Text style={{ fontSize: 13, color: '#AAA', fontWeight: 'normal', marginTop: 4, marginBottom: 12 }}>
            {t('hackathonLogsDesc', lang)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity 
              style={[styles.button, { flex: 1, backgroundColor: '#333', padding: 12 }]} 
              onPress={handleShareLogs}
            >
              <Text style={[styles.buttonText, { fontSize: 14 }]}>{t('exportLogs', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.button, { backgroundColor: '#333', borderColor: '#D32F2F', borderWidth: 1, padding: 12 }]} 
              onPress={handleClearLogs}
            >
              <Text style={[styles.buttonText, { fontSize: 14, color: '#D32F2F' }]}>{t('clear', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.buttonGrid}>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Chat')}>
            <Text style={styles.buttonText}>{t('askMuffin', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Accounts')}>
            <Text style={styles.buttonText}>{t('viewAccounts', lang)}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Goal Edit Modal */}
      <Modal
        visible={isGoalModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsGoalModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <Text style={styles.modalTitle}>
                {goal ? t('editSavingGoal', lang) : t('setSavingGoal', lang)}
              </Text>
              
              <Text style={styles.inputLabel}>{t('goalNameLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('goalNamePlaceholder', lang)}
                placeholderTextColor="#666"
                value={goalTitleInput}
                onChangeText={setGoalTitleInput}
              />

              <Text style={styles.inputLabel}>{t('targetAmountLabel', lang)}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('targetAmountPlaceholder', lang)}
                placeholderTextColor="#666"
                value={goalTargetInput}
                onChangeText={setGoalTargetInput}
                keyboardType="numeric"
                autoCorrect={false}
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setIsGoalModalVisible(false)}
                >
                  <Text style={styles.buttonText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButton]} 
                  onPress={saveGoalConfig}
                >
                  <Text style={styles.buttonText}>{t('save', lang)}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  scrollContainer: { flex: 1, padding: 16 },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  subtitle: { color: '#888', fontSize: 16 },
  langToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    padding: 3,
  },
  langToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  langToggleBtnActive: {
    backgroundColor: '#4CAF50',
  },
  langToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  langToggleTextActive: {
    color: '#FFF',
  },
  card: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#2E2E2E' },
  cardLabel: { color: '#AAA', fontSize: 14 },
  cardValue: { color: '#FFF', fontSize: 28, fontWeight: 'bold' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  splitGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  splitCard: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2E2E2E'
  },
  splitLabel: { color: '#888', fontSize: 12, marginBottom: 6 },
  splitValue: { color: '#FFF', fontSize: 19, fontWeight: 'bold' },
  splitSub: { color: '#9CCC65', fontSize: 11, marginTop: 4 },
  paymentOkCard: { borderColor: '#2E7D32' },
  paymentRiskCard: { borderColor: '#D32F2F', backgroundColor: '#2A1A1A' },
  paymentOkText: { color: '#66BB6A', fontSize: 12, fontWeight: '700' },
  paymentRiskText: { color: '#EF5350', fontSize: 12, fontWeight: '700' },
  paymentTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  paymentSub: { color: '#AAA', fontSize: 13 },
  paymentDeficit: { color: '#FFAB91', fontSize: 12, marginTop: 6 },
  miniEditButton: { backgroundColor: '#333', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  miniEditButtonText: { color: '#FFF', fontSize: 12, fontWeight: '500' },
  goalDetail: { fontSize: 14, color: '#888', fontWeight: 'normal' },
  progressBarBg: { height: 8, backgroundColor: '#333', borderRadius: 4, marginTop: 12 },
  progressBarFill: { height: 8, backgroundColor: '#4CAF50', borderRadius: 4 },
  warningCard: { backgroundColor: '#3b2818', borderColor: '#ff9800', borderWidth: 1 },
  warningTitle: { color: '#ffb74d', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  warningText: { color: '#ffcc80', fontSize: 14, marginBottom: 4 },
  buttonGrid: { gap: 12, marginTop: 8, marginBottom: 40 },
  button: { backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  ratesUpdateTime: { color: '#666', fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  
  // Modal styles (identical to AccountsScreen)
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
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center'
  },
  cancelButton: {
    backgroundColor: '#333'
  },
  saveButton: {
    backgroundColor: '#4CAF50'
  }
});
