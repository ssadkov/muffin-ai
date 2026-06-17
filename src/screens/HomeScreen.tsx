import React, { useState, useEffect } from 'react';
import { 
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform, 
  TouchableWithoutFeedback, 
  Keyboard,
  Alert,
  ActivityIndicator,
  Share
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { colors, gradients, radius, spacing, fontSize, shadow } from '../theme/theme';
import Card from '../components/Card';
import ProgressRing from '../components/ProgressRing';
import StatusChip from '../components/StatusChip';
import FormInput from '../components/FormInput';
import EmptyState from '../components/EmptyState';
import { 
  getTotalLiquidAssets, 
  getActiveGoals, 
  updateGoal, 
  syncAllExchanges, 
  getSetting, 
  setSetting,
  getBalanceGroups,
  getPaymentCoverageSummary,
  getPaymentObligations,
  savePaymentObligation,
  deletePaymentObligation,
  OwnerType
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';
import { fetchAndUpdateRates, getLastRatesUpdate, areRatesStale } from '../services/exchangeRateService';
import { exportAuditLogs, clearAuditLogs } from '../services/inferenceLogService';
import { syncPublicWallets } from '../services/walletSyncService';
import { schedulePaymentReminders } from '../services/paymentReminderService';
import { t, Language } from '../localization/localization';

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : 'embedded';
}

function getBuildInfoText() {
  const channel = Updates.channel || 'no-channel';
  const runtime = Updates.runtimeVersion || 'dev';
  const updateId = shortId(Updates.updateId);
  const createdAt = Updates.createdAt ? Updates.createdAt.toLocaleString() : 'local/dev';
  const source = Updates.isEmbeddedLaunch ? 'embedded' : 'ota';
  return `build ${runtime} · ${channel} · ${source}:${updateId} · ${createdAt}`;
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  
  const [assets, setAssets] = useState(0);
  const [goal, setGoal] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [lang, setLang] = useState<Language>('ru');
  const [balanceGroups, setBalanceGroups] = useState<any>(null);
  const [paymentSummary, setPaymentSummary] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [isPaymentsModalVisible, setIsPaymentsModalVisible] = useState(false);
  const [isPaymentEditorVisible, setIsPaymentEditorVisible] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentTitleInput, setPaymentTitleInput] = useState('');
  const [paymentOwnerInput, setPaymentOwnerInput] = useState<OwnerType>('personal');
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentCurrencyInput, setPaymentCurrencyInput] = useState('KZT');
  const [paymentDueDayInput, setPaymentDueDayInput] = useState('25');
  const [paymentRemindInput, setPaymentRemindInput] = useState('3');
  const [paymentAccountIdInput, setPaymentAccountIdInput] = useState<string | null>(null);
  const [paymentNoteInput, setPaymentNoteInput] = useState('');

  // Goal modal states
  const [isGoalModalVisible, setIsGoalModalVisible] = useState(false);
  const [goalTitleInput, setGoalTitleInput] = useState('');
  const [goalTargetInput, setGoalTargetInput] = useState('');

  // Exchange rates states
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lastRatesUpdate, setLastRatesUpdate] = useState<string | null>(null);

  // Collapsible dev / hackathon logs (kept accessible but de-emphasized)
  const [showDevLogs, setShowDevLogs] = useState(false);

  useEffect(() => {
    if (isFocused) {
      const currentLang = getSetting('language', 'ru') as Language;
      setLang(currentLang);
    }
  }, [isFocused]);

  useEffect(() => {
    if (isFocused) {
      refreshData();
      // Refresh live FX/crypto rates (throttled) + sync wallets/exchanges in the
      // background when the screen is focused, then re-read the DB.
      const tasks: Promise<unknown>[] = [
        syncPublicWallets(),
        syncAllExchanges(),
      ];
      // Only hit the rate APIs if our cached rates are stale, so switching
      // tabs doesn't spam the public endpoints (cryptocompare rate-limits).
      if (areRatesStale()) {
        tasks.unshift(fetchAndUpdateRates());
      }
      Promise.all(tasks)
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
    setPayments(getPaymentObligations());
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

  const resetPaymentForm = () => {
    setEditingPaymentId(null);
    setPaymentTitleInput('');
    setPaymentOwnerInput('personal');
    setPaymentAmountInput('');
    setPaymentCurrencyInput('KZT');
    setPaymentDueDayInput('25');
    setPaymentRemindInput('3');
    setPaymentAccountIdInput(null);
    setPaymentNoteInput('');
  };

  const openNewPaymentModal = () => {
    resetPaymentForm();
    setIsPaymentsModalVisible(false);
    setIsPaymentEditorVisible(true);
  };

  const openEditPayment = (payment: any) => {
    setEditingPaymentId(payment.id);
    setPaymentTitleInput(payment.title || '');
    setPaymentOwnerInput(payment.owner_type === 'company' ? 'company' : 'personal');
    setPaymentAmountInput(String(payment.amount || ''));
    setPaymentCurrencyInput(payment.currency || 'KZT');
    setPaymentDueDayInput(String(payment.due_day || 25));
    setPaymentRemindInput(String(payment.remind_days_before ?? 3));
    setPaymentAccountIdInput(payment.account_id || null);
    setPaymentNoteInput(payment.model_note || '');
    setIsPaymentsModalVisible(false);
    setIsPaymentEditorVisible(true);
  };

  const savePayment = async () => {
    const amount = parseFloat(paymentAmountInput);
    const dueDay = parseInt(paymentDueDayInput, 10);
    const remindDaysBefore = parseInt(paymentRemindInput, 10);

    if (!paymentTitleInput.trim() || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert(
        lang === 'ru' ? 'Проверь платеж' : 'Check payment',
        lang === 'ru' ? 'Нужно указать название и положительную сумму.' : 'Please enter a title and a positive amount.'
      );
      return;
    }

    try {
      savePaymentObligation({
        id: editingPaymentId || undefined,
        title: paymentTitleInput,
        ownerType: paymentOwnerInput,
        amount,
        currency: paymentCurrencyInput,
        dueDay: Number.isFinite(dueDay) ? dueDay : 25,
        accountId: paymentAccountIdInput,
        remindDaysBefore: Number.isFinite(remindDaysBefore) ? remindDaysBefore : 3,
        modelNote: paymentNoteInput,
      });
      refreshData();
      await schedulePaymentReminders();
      resetPaymentForm();
      setIsPaymentEditorVisible(false);
      setIsPaymentsModalVisible(true);
    } catch (e: any) {
      Alert.alert(t('error', lang), e?.message || String(e));
    }
  };

  const removePayment = async (id: string) => {
    deletePaymentObligation(id);
    refreshData();
    await schedulePaymentReminders();
    if (editingPaymentId === id) resetPaymentForm();
    setIsPaymentEditorVisible(false);
    setIsPaymentsModalVisible(true);
  };

  const confirmRemovePayment = (id: string, title: string) => {
    Alert.alert(
      lang === 'ru' ? 'Удалить платеж?' : 'Delete payment?',
      title,
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: lang === 'ru' ? 'Удалить' : 'Delete',
          style: 'destructive',
          onPress: () => removePayment(id),
        },
      ]
    );
  };

  const closePaymentEditor = () => {
    setIsPaymentEditorVisible(false);
    setIsPaymentsModalVisible(true);
  };

  const progress = goal && goal.target_value > 0 ? ((assets / goal.target_value) * 100).toFixed(1) : "0.0";
  const paymentAccounts = balanceGroups ? [...balanceGroups.personal, ...balanceGroups.company] : [];
  const scopedPaymentAccounts = paymentAccounts.filter((account: any) => (account.owner_type || 'personal') === paymentOwnerInput);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.greeting}>{t('appTitle', lang)}</Text>
            <Text style={styles.subtitle}>{t('privateMemory', lang)}</Text>
          </View>
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

        {/* Hero: total liquid assets */}
        <Pressable
          onPress={() => navigation.navigate('Accounts')}
          style={({ pressed }) => pressed && { opacity: 0.92 }}
        >
          <LinearGradient
            colors={gradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroTopRow}>
              <Text style={styles.heroLabel}>{t('totalLiquidAssets', lang)}</Text>
              <TouchableOpacity
                onPress={refreshExchangeRates}
                style={styles.ratePill}
                disabled={isRefreshingRates}
              >
                {isRefreshingRates ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="refresh" size={13} color="#FFF" />
                )}
                <Text style={styles.ratePillText}>
                  {isRefreshingRates
                    ? (lang === 'ru' ? 'Обновление…' : 'Updating…')
                    : (lang === 'ru' ? 'Курсы онлайн' : 'Live rates')}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.heroValue}>${assets.toLocaleString()}</Text>
            {lastRatesUpdate && (
              <Text style={styles.heroSub}>
                {t('ratesUpdated', lang)}: {new Date(lastRatesUpdate).toLocaleString()}
              </Text>
            )}
          </LinearGradient>
        </Pressable>

        {balanceGroups && (
          <View style={styles.splitGrid}>
            <Card onPress={() => navigation.navigate('Accounts')} style={styles.splitCard}>
              <View style={[styles.splitIcon, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="person-outline" size={16} color={colors.accent} />
              </View>
              <Text style={styles.splitLabel}>{lang === 'ru' ? 'Личные счета' : 'Personal'}</Text>
              <Text style={styles.splitValue}>${balanceGroups.personalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            </Card>
            <Card onPress={() => navigation.navigate('Accounts')} style={styles.splitCard}>
              <View style={[styles.splitIcon, { backgroundColor: colors.infoSoft }]}>
                <Ionicons name="business-outline" size={16} color={colors.info} />
              </View>
              <Text style={styles.splitLabel}>{lang === 'ru' ? 'Компания' : 'Company'}</Text>
              <Text style={styles.splitValue}>${balanceGroups.companyUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={styles.splitSub}>
                {lang === 'ru' ? 'твоя доля' : 'owned'} ${balanceGroups.companyOwnedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Text>
            </Card>
          </View>
        )}

        {paymentSummary && (
          <Card style={styles.sectionCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="radio-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.cardLabel}>Payment Radar</Text>
              </View>
              <View style={styles.headerActions}>
                <StatusChip
                  label={paymentSummary.isCovered ? (lang === 'ru' ? 'Покрыто' : 'Covered') : (lang === 'ru' ? 'Риск' : 'Risk')}
                  tone={paymentSummary.isCovered ? 'success' : 'danger'}
                  icon={paymentSummary.isCovered ? 'checkmark-circle' : 'alert-circle'}
                />
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setIsPaymentsModalVisible(true)}>
                  <Text style={styles.ghostBtnText}>{lang === 'ru' ? 'Настроить' : 'Manage'}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.bigStat}>
              {paymentSummary.payments.length}
              <Text style={styles.bigStatUnit}> {lang === 'ru' ? 'платежей / 31 день' : 'payments / 31 days'}</Text>
            </Text>
            <Text style={styles.mutedRow}>
              {lang === 'ru' ? 'Итого' : 'Total'} ≈ ${paymentSummary.totalDueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </Text>
            {paymentSummary.deficits.slice(0, 2).map((deficit: any, index: number) => (
              <Text key={`${deficit.owner_type}-${deficit.currency}-${index}`} style={styles.paymentDeficit}>
                {lang === 'ru'
                  ? `${deficit.owner_type}: не хватает ${deficit.missing} ${deficit.currency}`
                  : `${deficit.owner_type}: missing ${deficit.missing} ${deficit.currency}`}
              </Text>
            ))}
          </Card>
        )}

        {goal ? (
          <Card style={styles.sectionCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="flag-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.cardLabel} numberOfLines={1}>{t('goalTitle', lang)}: {goal.title}</Text>
              </View>
              <TouchableOpacity onPress={openGoalModal} style={styles.iconBtn}>
                <Ionicons name="pencil" size={15} color={colors.accent} />
              </TouchableOpacity>
            </View>
            <View style={styles.goalRow}>
              <ProgressRing percent={parseFloat(progress)} />
              <View style={styles.goalInfo}>
                <Text style={styles.goalAmount}>${assets.toLocaleString()}</Text>
                <Text style={styles.goalTarget}>
                  {lang === 'ru' ? 'из' : 'of'} ${goal.target_value?.toLocaleString()}
                </Text>
                <Text style={styles.goalRemaining}>
                  {lang === 'ru' ? 'осталось' : 'left'} ${Math.max(0, (goal.target_value || 0) - assets).toLocaleString()}
                </Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card style={styles.sectionCard}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="flag-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.cardLabel}>{t('savingGoal', lang)}</Text>
            </View>
            <Text style={styles.emptyHint}>{t('noActiveGoal', lang)}</Text>
            <TouchableOpacity style={styles.outlineButton} onPress={openGoalModal}>
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.outlineButtonText}>{lang === 'ru' ? 'Установить цель' : 'Set goal'}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {warnings.length > 0 && (
          <Card style={styles.warningCard}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
              <Text style={styles.warningTitle}>
                {warnings.length} {lang === 'ru' ? 'предупреждений правил' : 'rule warnings'}
              </Text>
            </View>
            {warnings.map((w, i) => (
              <Text key={i} style={styles.warningText}>• {w.message}</Text>
            ))}
          </Card>
        )}

        {/* Primary action */}
        <Pressable
          onPress={() => navigation.navigate('Chat')}
          style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.92 }]}
        >
          <LinearGradient
            colors={gradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaButton}
          >
            <Ionicons name="sparkles" size={18} color="#FFF" />
            <Text style={styles.ctaText}>{lang === 'ru' ? 'Спросить Muffin AI' : 'Ask Muffin AI'}</Text>
          </LinearGradient>
        </Pressable>

        {/* De-emphasized dev / hackathon logs (collapsed by default) */}
        <View style={styles.devSection}>
          <TouchableOpacity
            style={styles.devHeader}
            onPress={() => setShowDevLogs((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={styles.cardTitleRow}>
              <Ionicons name="terminal-outline" size={14} color={colors.textMuted} />
              <Text style={styles.devHeaderText}>{t('hackathonLogs', lang)}</Text>
            </View>
            <Ionicons name={showDevLogs ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
          {showDevLogs && (
            <View style={styles.devBody}>
              <Text style={styles.devDesc}>{t('hackathonLogsDesc', lang)}</Text>
              <Text style={styles.buildBadge}>{getBuildInfoText()}</Text>
              <View style={styles.devButtonRow}>
                <TouchableOpacity style={styles.devButton} onPress={handleShareLogs}>
                  <Ionicons name="share-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.devButtonText}>{lang === 'ru' ? 'Экспорт' : 'Export'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.devButton} onPress={handleClearLogs}>
                  <Ionicons name="trash-outline" size={15} color={colors.danger} />
                  <Text style={[styles.devButtonText, { color: colors.danger }]}>{t('clear', lang)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Payments Management Modal */}
      <Modal
        visible={isPaymentsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsPaymentsModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={[styles.modalContent, { maxHeight: '88%' }]}
            >
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                <View style={styles.modalHeaderRow}>
                  <Text style={[styles.modalTitle, { marginBottom: 0 }]}>
                    {lang === 'ru' ? 'Платежи' : 'Payments'}
                  </Text>
                  <TouchableOpacity onPress={openNewPaymentModal} style={styles.miniEditButton}>
                    <Text style={styles.miniEditButtonText}>{lang === 'ru' ? 'Новый' : 'New'}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.paymentList}>
                  {payments.map((payment) => (
                    <View key={payment.id} style={styles.paymentRow}>
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => openEditPayment(payment)}>
                        <Text style={styles.paymentRowTitle}>{payment.title}</Text>
                        <Text style={styles.paymentRowMeta}>
                          {payment.owner_type} · {payment.amount} {payment.currency} · {lang === 'ru' ? 'день' : 'day'} {payment.due_day}
                          {payment.account_name ? ` · ${payment.account_name}` : ''}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.paymentChevron}>›</Text>
                    </View>
                  ))}
                  {payments.length === 0 && (
                    <EmptyState
                      icon="calendar-outline"
                      title={lang === 'ru' ? 'Платежей пока нет' : 'No payments yet'}
                      subtitle={lang === 'ru' ? 'Нажмите «Новый», чтобы добавить регулярный платёж' : 'Tap "New" to add a recurring payment'}
                    />
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setIsPaymentsModalVisible(false)}
                >
                  <Text style={styles.buttonText}>{t('close', lang)}</Text>
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Payment Editor Modal */}
      <Modal
        visible={isPaymentEditorVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={closePaymentEditor}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
              style={[styles.modalContent, styles.editorModalContent]}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                contentContainerStyle={styles.editorScrollContent}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={[styles.modalTitle, { marginBottom: 0 }]}>
                    {editingPaymentId
                      ? (lang === 'ru' ? 'Редактировать платеж' : 'Edit payment')
                      : (lang === 'ru' ? 'Новый платеж' : 'New payment')}
                  </Text>
                  <TouchableOpacity onPress={closePaymentEditor} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <FormInput
                  label={lang === 'ru' ? 'Название' : 'Title'}
                  placeholder={lang === 'ru' ? 'Ипотека, кредит, налоги' : 'Mortgage, loan, taxes'}
                  value={paymentTitleInput}
                  onChangeText={setPaymentTitleInput}
                  returnKeyType="next"
                />

                <Text style={styles.inputLabel}>{lang === 'ru' ? 'Владелец' : 'Owner'}</Text>
                <View style={styles.segmentedRow}>
                  <TouchableOpacity
                    style={[styles.segmentButton, paymentOwnerInput === 'personal' && styles.segmentButtonActive]}
                    onPress={() => {
                      setPaymentOwnerInput('personal');
                      setPaymentAccountIdInput(null);
                    }}
                  >
                    <Text style={[styles.segmentButtonText, paymentOwnerInput === 'personal' && styles.segmentButtonTextActive]}>
                      Personal
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentButton, paymentOwnerInput === 'company' && styles.segmentButtonActive]}
                    onPress={() => {
                      setPaymentOwnerInput('company');
                      setPaymentAccountIdInput(null);
                    }}
                  >
                    <Text style={[styles.segmentButtonText, paymentOwnerInput === 'company' && styles.segmentButtonTextActive]}>
                      Company
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.twoColumnRow}>
                  <View style={{ flex: 1 }}>
                    <FormInput
                      label={lang === 'ru' ? 'Сумма' : 'Amount'}
                      placeholder="450000"
                      value={paymentAmountInput}
                      onChangeText={setPaymentAmountInput}
                      keyboardType="decimal-pad"
                      returnKeyType="next"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormInput
                      label={lang === 'ru' ? 'День месяца' : 'Due day'}
                      placeholder="25"
                      value={paymentDueDayInput}
                      onChangeText={setPaymentDueDayInput}
                      keyboardType="number-pad"
                      returnKeyType="next"
                    />
                  </View>
                </View>

                <Text style={styles.inputLabel}>{lang === 'ru' ? 'Валюта' : 'Currency'}</Text>
                <View style={styles.segmentedRow}>
                  {['KZT', 'RUB', 'USD'].map((currency) => (
                    <TouchableOpacity
                      key={currency}
                      style={[styles.segmentButton, paymentCurrencyInput === currency && styles.segmentButtonActive]}
                      onPress={() => setPaymentCurrencyInput(currency)}
                    >
                      <Text style={[styles.segmentButtonText, paymentCurrencyInput === currency && styles.segmentButtonTextActive]}>
                        {currency}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>{lang === 'ru' ? 'Счет для оплаты' : 'Payment account'}</Text>
                <View style={styles.accountPicker}>
                  <TouchableOpacity
                    style={[styles.accountChip, paymentAccountIdInput === null && styles.accountChipActive]}
                    onPress={() => setPaymentAccountIdInput(null)}
                  >
                    <Text style={[styles.accountChipText, paymentAccountIdInput === null && styles.accountChipTextActive]}>
                      {lang === 'ru' ? 'Не привязан' : 'Unassigned'}
                    </Text>
                  </TouchableOpacity>
                  {scopedPaymentAccounts.map((account: any) => (
                    <TouchableOpacity
                      key={account.id}
                      style={[styles.accountChip, paymentAccountIdInput === account.id && styles.accountChipActive]}
                      onPress={() => setPaymentAccountIdInput(account.id)}
                    >
                      <Text style={[styles.accountChipText, paymentAccountIdInput === account.id && styles.accountChipTextActive]}>
                        {account.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <FormInput
                  label={lang === 'ru' ? 'Напомнить за N дней' : 'Remind days before'}
                  placeholder="3"
                  value={paymentRemindInput}
                  onChangeText={setPaymentRemindInput}
                  keyboardType="number-pad"
                  returnKeyType="next"
                />

                <FormInput
                  label={lang === 'ru' ? 'Комментарий для AI' : 'AI note'}
                  placeholder={lang === 'ru' ? 'Например: платить с company RUB, если не хватает - конвертировать USD' : 'Example: pay from company RUB; convert USD if short'}
                  value={paymentNoteInput}
                  onChangeText={setPaymentNoteInput}
                  multiline
                  returnKeyType="done"
                />

                {editingPaymentId && (
                  <TouchableOpacity
                    style={[styles.modalButton, styles.destructiveButton]}
                    onPress={() => confirmRemovePayment(editingPaymentId, paymentTitleInput || '')}
                  >
                    <Text style={styles.buttonText}>{lang === 'ru' ? 'Удалить платеж' : 'Delete payment'}</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={closePaymentEditor}
                  >
                    <Text style={styles.buttonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.saveButton]}
                    onPress={savePayment}
                  >
                    <Text style={styles.buttonText}>
                      {editingPaymentId ? t('save', lang) : (lang === 'ru' ? 'Добавить' : 'Add')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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

              <FormInput
                label={t('goalNameLabel', lang)}
                placeholder={t('goalNamePlaceholder', lang)}
                value={goalTitleInput}
                onChangeText={setGoalTitleInput}
              />

              <FormInput
                label={t('targetAmountLabel', lang)}
                placeholder={t('targetAmountPlaceholder', lang)}
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
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContainer: { flex: 1 },
  scrollContent: { padding: spacing(4), paddingBottom: spacing(8) },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing(5),
  },
  headerTitleWrap: { flexShrink: 1, paddingRight: spacing(2) },
  greeting: { color: colors.textPrimary, fontSize: fontSize.xl, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  langToggleContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  langToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.sm - 4,
  },
  langToggleBtnActive: { backgroundColor: colors.accent },
  langToggleText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '700' },
  langToggleTextActive: { color: colors.white },

  // Hero card
  heroCard: {
    borderRadius: radius.xl,
    padding: spacing(6),
    marginBottom: spacing(4),
    ...shadow.floating,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing(3),
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
  ratePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  ratePillText: { color: '#FFF', fontSize: fontSize.xs, fontWeight: '700' },
  heroValue: { color: '#FFF', fontSize: fontSize.display, fontWeight: '900', letterSpacing: -0.5 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.xs, marginTop: 6 },

  // Generic card pieces
  sectionCard: { marginBottom: spacing(4) },
  cardLabel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing(3),
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghostBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  ghostBtnText: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: '600' },
  iconBtn: {
    backgroundColor: colors.accentSoft,
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigStat: { color: colors.textPrimary, fontSize: fontSize.xxl, fontWeight: '800' },
  bigStatUnit: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  mutedRow: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 4 },
  buildBadge: {
    color: colors.accent,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
  },

  // Split cards
  splitGrid: { flexDirection: 'row', gap: spacing(3), marginBottom: spacing(4) },
  splitCard: { flex: 1, padding: spacing(4) },
  splitIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(2),
  },
  splitLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: 4 },
  splitValue: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: '800' },
  splitSub: { color: colors.accent, fontSize: fontSize.xs, marginTop: 4 },

  paymentDeficit: { color: '#FFAB91', fontSize: fontSize.xs, marginTop: 6 },

  // Goal
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(5) },
  goalInfo: { flex: 1 },
  goalAmount: { color: colors.textPrimary, fontSize: fontSize.xl, fontWeight: '800' },
  goalTarget: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  goalRemaining: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600', marginTop: 6 },
  emptyHint: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing(2), marginBottom: spacing(3) },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing(3),
  },
  outlineButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },

  // Warnings
  warningCard: { backgroundColor: 'rgba(245, 158, 11, 0.10)', borderColor: colors.warning, marginBottom: spacing(4) },
  warningTitle: { color: colors.warning, fontSize: fontSize.md, fontWeight: '700' },
  warningText: { color: '#FCD9A0', fontSize: fontSize.sm, marginTop: 6 },

  // Primary CTA
  ctaWrap: { marginBottom: spacing(5) },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing(4),
    borderRadius: radius.md,
    ...shadow.card,
  },
  ctaText: { color: '#FFF', fontSize: fontSize.md, fontWeight: '800' },

  // De-emphasized dev / hackathon logs
  devSection: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  devHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(4),
  },
  devHeaderText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '600' },
  devBody: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(4),
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing(3),
  },
  devDesc: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 17 },
  devButtonRow: { flexDirection: 'row', gap: spacing(3), marginTop: spacing(3) },
  devButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing(3),
  },
  devButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },

  // Mini buttons kept for modals
  miniEditButton: { backgroundColor: colors.surfaceAlt, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm },
  miniEditButtonText: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: '500' },
  button: { backgroundColor: colors.accent, padding: 16, borderRadius: radius.md, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: fontSize.md, fontWeight: 'bold' },

  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(6),
    paddingBottom: Platform.OS === 'ios' ? spacing(10) : spacing(6),
    borderWidth: 1,
    borderColor: colors.border,
  },
  editorModalContent: {
    maxHeight: '92%',
  },
  editorScrollContent: {
    paddingBottom: Platform.OS === 'ios' ? 140 : 96,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: '800',
    marginBottom: spacing(4),
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(4),
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: 6,
  },
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
  multilineInput: {
    minHeight: 78,
    textAlignVertical: 'top',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing(4),
  },
  segmentButton: {
    flex: 1,
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing(2.5),
    alignItems: 'center',
  },
  segmentButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  segmentButtonText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  segmentButtonTextActive: {
    color: colors.accent,
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  paymentList: {
    gap: 8,
    marginBottom: 18,
  },
  paymentRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentRowTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: 3,
  },
  paymentRowMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  paymentChevron: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: '300',
    paddingHorizontal: 4,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  accountPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing(4),
  },
  accountChip: {
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  accountChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  accountChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  accountChipTextActive: {
    color: colors.accent,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  modalButton: {
    flex: 1,
    padding: spacing(3.5),
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surfaceAlt,
  },
  saveButton: {
    backgroundColor: colors.accent,
  },
  destructiveButton: {
    backgroundColor: colors.danger,
    marginBottom: 12,
  },
});
