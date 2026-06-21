import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  ScrollView,
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  ActivityIndicator, 
  Keyboard,
  Alert,
  Image,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { colors, radius, spacing, fontSize, shadow } from '../theme/theme';
import ProgressRing from '../components/ProgressRing';
import StatusChip from '../components/StatusChip';
import TypingDots from '../components/TypingDots';
import ThinkingBox from '../components/ThinkingBox';
import { AiContext } from '../agent/aiContext';
import { askMuffinAi, continueMuffinAi } from '../agent/muffinAiAgent';
import { extractBalanceAccountNameHint, findMatchingAccount, parseFinanceCommand } from '../agent/commandParser';
import { downloadModelIfNeeded, initLocalModel, checkModelExists, isModelLoaded, unloadLocalModel, deleteLocalModelFile, getModelLocalPath, InferenceStats } from '../services/qvacService';
import { ModelId, MODEL_CATALOG, MODEL_IDS, DEFAULT_MODEL_ID } from '../services/modelCatalog';
import { recognizeImageText, parseBalanceFromOcrText } from '../services/ocrService';
import { upsertAccountBalance, executeBalanceUpdate, getLatestBalances, updateGoal, getSetting, setSetting } from '../tools/databaseTools';
import { getBitcoinPrice } from '../tools/cryptoApiTools';
import * as ImagePicker from 'expo-image-picker';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { downloadWhisperModelIfNeeded, initWhisperModel, transcribeAudio, isWhisperModelLoaded } from '../services/transcriptionService';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { t, Language } from '../localization/localization';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  isPendingOcrConfirm?: boolean;
  ocrData?: {
    bank: string;
    amount: number;
    currency: string;
    rawText: string;
    screenshotPath: string;
  };
  // Tool call state
  isToolCall?: boolean;
  toolCallType?: 'BTC_PRICE' | 'CREATE_ACCOUNT' | 'UPDATE_BALANCE' | 'RENAME_ACCOUNT' | 'UPDATE_GOAL';
  toolCallData?: any;
  toolCallStatus?: 'pending' | 'running' | 'completed' | 'cancelled';
  countdown?: number;
  rawToolCallText?: string;
  isToolConfirmation?: boolean;
  sourceQuestion?: string;
  // QVAC on-device inference telemetry, shown as a badge under the answer.
  stats?: InferenceStats;
  // Tappable follow-up chips when the router was unsure what the user meant.
  clarifications?: { label: string; prompt: string }[];
}

const TOOL_COUNTDOWN_SECONDS = 5;

type ToolType = 'BTC_PRICE' | 'CREATE_ACCOUNT' | 'UPDATE_BALANCE' | 'RENAME_ACCOUNT' | 'UPDATE_GOAL';

type ModelFileStatus = Record<ModelId, { exists: boolean; loaded: boolean }>;

type ResolvedBalanceMutation =
  | {
      action: 'update';
      data: {
        accountId: string;
        amount: number;
        currency: string;
        type: 'add' | 'subtract' | 'set';
        accountName?: string;
      };
    }
  | {
      action: 'create';
      data: {
        accountName: string;
        amount: number;
        currency: string;
      };
    };

const TOOL_META: Record<ToolType, { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string }> = {
  BTC_PRICE: { icon: 'logo-bitcoin', color: '#F7931A', soft: 'rgba(247, 147, 26, 0.14)' },
  CREATE_ACCOUNT: { icon: 'add-circle-outline', color: colors.info, soft: colors.infoSoft },
  UPDATE_BALANCE: { icon: 'wallet-outline', color: colors.accent, soft: colors.accentSoft },
  RENAME_ACCOUNT: { icon: 'create-outline', color: colors.info, soft: colors.infoSoft },
  UPDATE_GOAL: { icon: 'flag-outline', color: colors.info, soft: colors.infoSoft },
};

const GLOBAL_DEMO_PROMPTS = [
  'How much do I have on Aptos?',
  'How many Aptos wallets do I have?',
  'What is my total crypto portfolio?',
  'How much is left until my goal?',
  'Can I cover upcoming payments?',
];

const parseModelResponse = (text: string) => {
  if (!text) return { thinking: null, response: '' };
  const thinkMatch = text.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const response = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    return { thinking, response };
  }
  return { thinking: null, response: text };
};


let globalChatHistory: Message[] = [
  { 
    id: '1', 
    text: 'Привет! Я Muffin, твой приватный финансовый ассистент. 🏦\n\nВы можете загрузить скриншот из любого приложения банка или криптокошелька через скрепку 📎. Все скриншоты и данные распознаются и обрабатываются локально на этом устройстве без отправки в интернет.\n\nЗадайте мне любой вопрос о ваших балансах, целях или финансовых правилах!', 
    isUser: false 
  }
];

export default function ChatScreen() {
  const [messages, setMessagesState] = useState<Message[]>(globalChatHistory);

  const setMessages = (update: Message[] | ((prev: Message[]) => Message[])) => {
    setMessagesState(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      globalChatHistory = next;
      return next;
    });
  };

  const [activeModel, setActiveModel] = useState<ModelId>(() => {
    const saved = getSetting('model', DEFAULT_MODEL_ID);
    return (MODEL_IDS as string[]).includes(saved) ? (saved as ModelId) : DEFAULT_MODEL_ID;
  });

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadedBytes, setDownloadedBytes] = useState<number>(0);
  const [isModelDownloading, setIsModelDownloading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(isModelLoaded(activeModel));
  const [isInitializing, setIsInitializing] = useState(false);
  const [isModelSettingsVisible, setIsModelSettingsVisible] = useState(false);
  const [modelBusyId, setModelBusyId] = useState<ModelId | null>(null);
  const [modelStatuses, setModelStatuses] = useState<ModelFileStatus>(() => (
    MODEL_IDS.reduce((acc, id) => {
      acc[id] = { exists: false, loaded: isModelLoaded(id) };
      return acc;
    }, {} as ModelFileStatus)
  ));
  const flatListRef = useRef<FlatList>(null);
  
  // Track active countdown timers so they can be cancelled
  const activeTimersRef = useRef<{ [msgId: string]: any }>({});

  // Whisper Speech variables
  const [isWhisperReady, setIsWhisperReady] = useState(isWhisperModelLoaded());
  const [isWhisperDownloading, setIsWhisperDownloading] = useState(false);
  const [isWhisperInitializing, setIsWhisperInitializing] = useState(false);
  const [whisperProgress, setWhisperProgress] = useState<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);

  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [lang, setLang] = useState<Language>('ru');
  const [existingAccounts, setExistingAccounts] = useState<any[]>([]);
  const demoPrompts = GLOBAL_DEMO_PROMPTS;

  const getDisplayedText = (text: string) => {
    const { response } = parseModelResponse(text);
    if (!response) return '';
    const cleanResponse = response.trim();
    if (cleanResponse.startsWith('[')) {
      if (cleanResponse.includes('CREATE_ACCOUNT')) {
        return t('toolCreateAccountIntro', lang);
      }
      if (cleanResponse.includes('UPDATE_BALANCE')) {
        return t('toolBalanceIntro', lang);
      }
      if (cleanResponse.includes('RENAME_ACCOUNT')) {
        return lang === 'ru' ? 'Rename account' : 'Rename account';
      }
      if (cleanResponse.includes('UPDATE_GOAL')) {
        return t('toolGoalIntro', lang);
      }
      if (cleanResponse.includes('BTC_PRICE')) {
        return t('fetchingBtcPrice', lang);
      }
      return t('processingAction', lang);
    }
    return response;
  };

  useEffect(() => {
    if (isFocused) {
      const activeLang = getSetting('language', 'ru') as Language;
      setLang(activeLang);
      
      setMessages(prev => {
        if (prev.length === 1 && prev[0].id === '1') {
          return [
            {
              id: '1',
              text: t('chatWelcome', activeLang),
              isUser: false
            }
          ];
        }
        return prev;
      });
      
      setExistingAccounts(getLatestBalances());
    }
  }, [isFocused]);

  const resolveQuestionContext = (_text: string): AiContext | null => {
    // Intent routing now handles account/chain scope from the question itself.
    // We no longer auto-bind a single account from a keyword match — that made a
    // multi-wallet question ("how many Aptos wallets") collapse to one wallet.
    // Context is only set deliberately via the "Ask" button on the Accounts screen.
    return null;
  };

  const applyDemoPrompt = (prompt: string) => {
    if (isLoading || isRecording || isWhisperDownloading || isWhisperInitializing) return;
    setInputText(prompt);
  };

  const refreshModelStatuses = async () => {
    const entries = await Promise.all(
      MODEL_IDS.map(async (id) => [
        id,
        {
          exists: await checkModelExists(id),
          loaded: isModelLoaded(id),
        },
      ] as const)
    );
    setModelStatuses(Object.fromEntries(entries) as ModelFileStatus);
  };

  useEffect(() => {
    refreshModelStatuses();
  }, [activeModel, isModelReady, isModelSettingsVisible]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => setIsModelSettingsVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const handleDownloadModel = async (id: ModelId) => {
    setModelBusyId(id);
    setIsModelDownloading(true);
    setDownloadProgress(0);
    setDownloadedBytes(0);
    try {
      await downloadModelIfNeeded(id, (progress, written) => {
        setDownloadProgress(progress);
        setDownloadedBytes(written || 0);
      });
      await refreshModelStatuses();
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось скачать модель.' : 'Failed to download the model.');
    } finally {
      setIsModelDownloading(false);
      setModelBusyId(null);
    }
  };

  const handleLoadModel = async (id: ModelId) => {
    setModelBusyId(id);
    setIsInitializing(true);
    try {
      const exists = await checkModelExists(id);
      if (!exists) {
        Alert.alert(
          lang === 'ru' ? 'Модель не скачана' : 'Model not downloaded',
          lang === 'ru' ? 'Сначала скачайте файл модели.' : 'Download the model file first.'
        );
        return;
      }

      if (id !== activeModel) {
        await unloadLocalModel(activeModel).catch(() => {});
        setSetting('model', id);
        setActiveModel(id);
      }

      await initLocalModel(getModelLocalPath(id), id);
      setIsModelReady(true);
      await refreshModelStatuses();
    } catch (e) {
      console.error(e);
      Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось загрузить модель в память.' : 'Failed to load the model.');
    } finally {
      setIsInitializing(false);
      setModelBusyId(null);
    }
  };

  const confirmDeleteModel = (id: ModelId) => {
    const spec = MODEL_CATALOG[id];
    Alert.alert(
      lang === 'ru' ? 'Удалить файл модели?' : 'Delete model file?',
      lang === 'ru'
        ? `Удалить ${spec.label} (${spec.sizeLabel}) с устройства? Потом её нужно будет скачать заново.`
        : `Delete ${spec.label} (${spec.sizeLabel}) from this device? You will need to download it again later.`,
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: lang === 'ru' ? 'Удалить' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            setModelBusyId(id);
            try {
              await deleteLocalModelFile(id);
              if (id === activeModel) {
                setIsModelReady(false);
              }
              await refreshModelStatuses();
            } catch (e) {
              console.error(e);
              Alert.alert(t('error', lang), lang === 'ru' ? 'Не удалось удалить модель.' : 'Failed to delete the model.');
            } finally {
              setModelBusyId(null);
            }
          },
        },
      ]
    );
  };

  // Download + load whichever model is active. Re-runs when the user switches
  // models in the picker; `cancelled` guards against a stale switch landing late.
  useEffect(() => {
    let cancelled = false;
    async function setupModel() {
      if (isModelLoaded(activeModel)) {
        if (!cancelled) setIsModelReady(true);
        return;
      }
      if (!cancelled) {
        setIsModelReady(false);
        setDownloadProgress(0);
        setDownloadedBytes(0);
        setIsModelDownloading(false);
        setIsInitializing(false);
      }
      try {
        const activeModelFileExists = await checkModelExists(activeModel);
        if (!activeModelFileExists) {
          if (!cancelled) setIsModelDownloading(true);
        }
        const modelPath = await downloadModelIfNeeded(activeModel, (progress, written) => {
          if (cancelled) return;
          setDownloadProgress(progress);
          setDownloadedBytes(written || 0);
        });
        if (cancelled) return;
        // Download finished — now the (slow for 8B) load into RAM begins.
        setIsModelDownloading(false);
        setIsInitializing(true);
        await initLocalModel(modelPath, activeModel);
        if (!cancelled) setIsModelReady(true);
      } catch (e) {
        console.error("Model setup error:", e);
      } finally {
        if (!cancelled) setIsModelDownloading(false);
        if (!cancelled) setIsInitializing(false);
        if (!cancelled) refreshModelStatuses();
      }
    }
    setupModel();
    return () => {
      cancelled = true;
    };
  }, [activeModel]);

  // Switch the active LLM: persist the choice, free the previous model's RAM,
  // then flip state so the setup effect loads (and downloads if needed) the new one.
  const handleSelectModel = async (id: ModelId) => {
    if (id === activeModel || isLoading || isInitializing || isModelDownloading || modelBusyId) return;
    const previous = activeModel;
    setSetting('model', id);
    setIsModelReady(false);
    // Free the previous model's RAM *before* the setup effect loads the new one,
    // so an 8B never has to coexist with a 3B on the device.
    await unloadLocalModel(previous).catch(() => {});
    setActiveModel(id);
  };

  useEffect(() => {
    return () => {
      // Clear all active timers on unmount
      Object.values(activeTimersRef.current).forEach(clearInterval);
      // Unload audio recorder if it was left active
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  const handleMicPress = async () => {
    if (isRecording) {
      await stopAudioRecording();
    } else {
      await startAudioRecording();
    }
  };

  const startAudioRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(t('permissionRequired', lang), t('micPermissionDesc', lang));
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      console.log("Preparing to record...");
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      
      setRecording(newRecording);
      setIsRecording(true);
      console.log("Recording started");
    } catch (e) {
      console.error("Failed to start recording:", e);
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      Alert.alert(t('error', lang), t('startRecordingError', lang));
    }
  };

  const stopAudioRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      console.log("Stopping recording...");
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      console.log("Recording stopped, URI:", uri);

      if (uri) {
        await processVoiceCommand(uri);
      }
    } catch (e) {
      console.error("Failed to stop recording:", e);
      Alert.alert(t('error', lang), t('stopRecordingError', lang));
    }
  };

  const getCleanChatHistory = () => {
    // Collect the last turns, keeping user messages, standard assistant replies,
    // and tool call messages (reconstructing their raw tool call string).
    // Discard loading placeholders, pending OCR cards, and tool confirmation replies
    // to keep the history clean and aligned with the system prompt guidelines.
    const conversationalMessages = messages.filter(
      msg => !msg.isPendingOcrConfirm && 
             !msg.isToolConfirmation &&
             !msg.text.includes('Listening...') && 
             !msg.text.includes('Muffin думает') && 
             !msg.text.includes('Muffin is thinking') && 
             !msg.text.includes('Muffin считает') && 
             !msg.text.includes('Muffin is calculating')
    );
    
    return conversationalMessages.slice(-2).map(msg => ({
      role: (msg.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.isToolCall && msg.rawToolCallText ? msg.rawToolCallText : msg.text
    }));
  };

  const resolveBalanceMutation = (userQuestion: string, data: any): ResolvedBalanceMutation => {
    const accounts = getLatestBalances();
    const amount = Number(data?.amount);
    const currency = String(data?.currency || 'USD').toUpperCase();
    const operation = data?.type === 'add' || data?.type === 'subtract' || data?.type === 'set'
      ? data.type
      : 'set';

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Invalid balance amount');
    }

    const question = (userQuestion || '').trim();
    if (question) {
      const parsed = parseFinanceCommand(question, accounts, undefined, null);
      if (parsed?.action === 'create_account') {
        throw new Error('Account creation through chat is disabled');
      }

      if (parsed?.action === 'rename_account') {
        throw new Error('Rename command cannot be executed as balance update');
      }

      if (parsed?.action === 'update_balance') {
        const account = accounts.find((item) => item.id === parsed.accountId);
        if (account) {
          return {
            action: 'update',
            data: {
              accountId: account.id,
              accountName: account.name,
              amount,
              currency,
              type: operation,
            },
          };
        }
      }

      const accountMatch = findMatchingAccount(question, accounts);
      if (accountMatch.account && accountMatch.confidence >= 0.78) {
        return {
          action: 'update',
          data: {
            accountId: accountMatch.account.id,
            accountName: accountMatch.account.name,
            amount,
            currency,
            type: operation,
          },
        };
      }

      const accountNameHint = extractBalanceAccountNameHint(question);
      if (accountNameHint) {
        throw new Error('Could not resolve existing balance target account');
      }

    }

    const proposedAccount = accounts.find((item) => item.id === data?.accountId);
    if (proposedAccount) {
      return {
        action: 'update',
        data: {
          accountId: proposedAccount.id,
          accountName: proposedAccount.name,
          amount,
          currency,
          type: operation,
        },
      };
    }

    const proposedAccountName = String(data?.accountName || '').trim();
    if (proposedAccountName) {
      throw new Error('Account creation through chat is disabled');
    }

    throw new Error('Could not resolve balance target account');
  };

  const processVoiceCommand = async (uri: string) => {
    setIsLoading(true);
    const transLoadingId = Date.now().toString();
    setMessages(prev => [...prev, { 
      id: transLoadingId, 
      text: t('transcribingVoice', lang), 
      isUser: false 
    }]);

    try {
      if (!isWhisperReady || !isWhisperModelLoaded()) {
        setIsWhisperDownloading(true);
        const path = await downloadWhisperModelIfNeeded((prog) => {
          setWhisperProgress(prog);
        });
        setIsWhisperDownloading(false);
        setIsWhisperInitializing(true);
        await initWhisperModel(path);
        setIsWhisperReady(true);
        setIsWhisperInitializing(false);
      }

      const text = await transcribeAudio(uri);
      setMessages(prev => prev.filter(m => m.id !== transLoadingId));

      const cleanText = text.trim();
      if (cleanText) {
        const requestAiContext = resolveQuestionContext(cleanText);
        // Automatically send the voice transcription as a user message
        const userMsg = { id: Date.now().toString(), text: cleanText, isUser: true };
        setMessages(prev => [...prev, userMsg]);
        
        const aiMsgId = 'ai_' + Date.now();
        const placeholder = t('aiCalculating', lang);
          
        setMessages(prev => [...prev, { 
          id: aiMsgId, 
          text: placeholder, 
          isUser: false 
        }]);

        // Get chat history before pushing userMsg
        const history = getCleanChatHistory();

        // Ask Muffin AI with real-time streaming update and chat history
        const response = await askMuffinAi(cleanText, activeModel, (currentText) => {
          setMessages(prev => prev.map(m => {
            if (m.id === aiMsgId) {
              return { ...m, text: currentText };
            }
            return m;
          }));
        }, history, requestAiContext);
        await handleAiResponse(cleanText, response.message, aiMsgId, response.stats, response.clarifications);
      } else {
        Alert.alert(t('noSpeechTitle', lang), t('noSpeechDesc', lang));
      }
    } catch (e) {
      console.error("Voice command processing error:", e);
      setMessages(prev => prev.filter(m => m.id !== transLoadingId));
      Alert.alert(t('transcriptionErrorTitle', lang), t('transcriptionErrorDesc', lang));
    } finally {
      setIsWhisperDownloading(false);
      setIsWhisperInitializing(false);
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    
    const originalText = inputText.trim();
    const requestAiContext = resolveQuestionContext(originalText);
    const userMsg = { id: Date.now().toString(), text: originalText, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);
    Keyboard.dismiss();

    const aiMsgId = 'ai_' + Date.now();
    const placeholder = t('aiCalculating', lang);
      
    setMessages(prev => [...prev, { 
      id: aiMsgId, 
      text: placeholder, 
      isUser: false 
    }]);

    // Get chat history before pushing userMsg
    const history = getCleanChatHistory();

    try {
      const response = await askMuffinAi(userMsg.text, activeModel, (currentText) => {
        setMessages(prev => prev.map(m => {
          if (m.id === aiMsgId) {
            return { ...m, text: currentText };
          }
          return m;
        }));
      }, history, requestAiContext);
      await handleAiResponse(userMsg.text, response.message, aiMsgId, response.stats, response.clarifications);
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.map(m => {
        if (m.id === aiMsgId) {
          return { ...m, text: t('aiConnectError', lang) };
        }
        return m;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Send a precise follow-up question when the user taps a clarification chip.
  const sendClarification = async (prompt: string) => {
    if (isLoading || isRecording || isWhisperDownloading || isWhisperInitializing) return;

    const requestAiContext = resolveQuestionContext(prompt);
    const userMsg = { id: Date.now().toString(), text: prompt, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    Keyboard.dismiss();

    const aiMsgId = 'ai_' + Date.now();
    setMessages(prev => [...prev, { id: aiMsgId, text: t('aiCalculating', lang), isUser: false }]);

    const history = getCleanChatHistory();
    try {
      const response = await askMuffinAi(prompt, activeModel, (currentText) => {
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: currentText } : m));
      }, history, requestAiContext);
      await handleAiResponse(prompt, response.message, aiMsgId, response.stats, response.clarifications);
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: t('aiConnectError', lang) } : m));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAiResponse = async (userQuestion: string, aiText: string, aiMsgId?: string, stats?: InferenceStats, clarifications?: { label: string; prompt: string }[]) => {
    if (aiText.includes('TOOL_CALL: BTC_PRICE')) {
      const msgId = Date.now().toString();
      const newMsg: Message = {
        id: msgId,
        text: t('fetchingBtcPrice', lang),
        isUser: false,
        isToolCall: true,
        toolCallType: 'BTC_PRICE',
        toolCallStatus: 'pending',
        countdown: TOOL_COUNTDOWN_SECONDS,
        rawToolCallText: aiText,
        sourceQuestion: userQuestion,
        stats
      };
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== aiMsgId);
        return [...filtered, newMsg];
      });
      startToolCountdown(msgId, userQuestion, 'BTC_PRICE', null);
    } 
    else if (aiText.includes('TOOL_CALL: CREATE_ACCOUNT:')) {
      const disabledMessage = lang === 'ru'
        ? 'Создание счетов через чат временно отключено. Добавьте счет во вкладке Accounts.'
        : 'Creating accounts through chat is temporarily disabled. Add the account in the Accounts tab.';
      if (aiMsgId) {
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: disabledMessage } : m));
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: disabledMessage, isUser: false }]);
      }
      return;
    }
    else if (aiText.includes('TOOL_CALL: UPDATE_BALANCE:')) {
      const match = aiText.match(/\[?TOOL_CALL: UPDATE_BALANCE:\s*(\{.*?\})\]?/);
      if (match) {
        try {
          const toolData = JSON.parse(match[1]);
          const msgId = Date.now().toString();

          const resolvedMutation = resolveBalanceMutation(userQuestion, toolData);
          if (resolvedMutation.action === 'create') {
            throw new Error('Account creation through balance commands is disabled');
            return;
          }

          const resolvedToolData = resolvedMutation.data;
          const accountName = resolvedToolData.accountName || resolvedToolData.accountId;

          let opText = '';
          if (resolvedToolData.type === 'add') {
            opText = t('toolAddBalance', lang, { amount: resolvedToolData.amount, currency: resolvedToolData.currency, accountName });
          } else if (resolvedToolData.type === 'subtract') {
            opText = t('toolSubtractBalance', lang, { amount: resolvedToolData.amount, currency: resolvedToolData.currency, accountName });
          } else {
            opText = t('toolSetBalance', lang, { amount: resolvedToolData.amount, currency: resolvedToolData.currency, accountName });
          }

          const newMsg: Message = {
            id: msgId,
            text: opText,
            isUser: false,
            isToolCall: true,
            toolCallType: 'UPDATE_BALANCE',
            toolCallData: { ...resolvedToolData, accountName },
            toolCallStatus: 'pending',
            rawToolCallText: aiText,
            sourceQuestion: userQuestion,
            stats
          };

          setMessages(prev => {
            const updated = prev.map(m => {
              if (m.id === aiMsgId) {
                return { ...m, text: t('toolBalanceIntro', lang), isToolConfirmation: true };
              }
              return m;
            });
            return [...updated, newMsg];
          });

          // Balance changes require explicit confirmation; no timer auto-runs money mutations.
        } catch (e) {
          console.error("Failed to parse tool call JSON", e);
          if (aiMsgId) {
            setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText } : m));
          } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
          }
        }
      } else {
        if (aiMsgId) {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText } : m));
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
        }
      }
    } 
    else if (aiText.includes('TOOL_CALL: RENAME_ACCOUNT:')) {
      const disabledMessage = lang === 'ru'
        ? 'Переименование счетов через чат временно отключено. Используйте Configure у счета.'
        : 'Renaming accounts through chat is temporarily disabled. Use Configure on the account.';
      if (aiMsgId) {
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: disabledMessage } : m));
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: disabledMessage, isUser: false }]);
      }
      return;
    }
    else if (aiText.includes('TOOL_CALL: UPDATE_GOAL:')) {
      const match = aiText.match(/\[?TOOL_CALL: UPDATE_GOAL:\s*(\{.*?\})\]?/);
      if (match) {
        try {
          const toolData = JSON.parse(match[1]);
          const msgId = Date.now().toString();

          const newMsg: Message = {
            id: msgId,
            text: t('toolUpdateGoal', lang, { title: toolData.title, targetValue: toolData.targetValue.toLocaleString() }),
            isUser: false,
            isToolCall: true,
            toolCallType: 'UPDATE_GOAL',
            toolCallData: toolData,
            toolCallStatus: 'pending',
            countdown: TOOL_COUNTDOWN_SECONDS,
            rawToolCallText: aiText,
            sourceQuestion: userQuestion,
            stats
          };

          setMessages(prev => {
            const updated = prev.map(m => {
              if (m.id === aiMsgId) {
                return { ...m, text: t('toolGoalIntro', lang), isToolConfirmation: true };
              }
              return m;
            });
            return [...updated, newMsg];
          });

          startToolCountdown(msgId, userQuestion, 'UPDATE_GOAL', toolData);
        } catch (e) {
          console.error("Failed to parse goal tool call JSON", e);
          if (aiMsgId) {
            setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText } : m));
          } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
          }
        }
      } else {
        if (aiMsgId) {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText } : m));
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
        }
      }
    }
    else {
      if (aiMsgId) {
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText, stats, clarifications } : m));
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false, stats, clarifications }]);
      }
    }

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const startToolCountdown = (msgId: string, userQuestion: string, type: ToolType, data: any) => {
    let timeLeft = TOOL_COUNTDOWN_SECONDS;
    
    const intervalId = setInterval(() => {
      timeLeft -= 1;
      
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return { ...m, countdown: timeLeft };
        }
        return m;
      }));

      if (timeLeft <= 0) {
        clearInterval(intervalId);
        delete activeTimersRef.current[msgId];
        executeToolAction(msgId, userQuestion, type, data);
      }
    }, 1000);

    activeTimersRef.current[msgId] = intervalId;
  };

  const buildCancelMessage = (type: string): string => {
    if (type === 'UPDATE_BALANCE') {
      return lang === 'ru'
        ? 'Отменено. Баланс не изменён.'
        : 'Cancelled. No balance changes were made.';
    }
    if (type === 'CREATE_ACCOUNT') {
      return lang === 'ru'
        ? 'Отменено. Новый счёт не создан.'
        : 'Cancelled. No account was created.';
    }
    if (type === 'RENAME_ACCOUNT') {
      return lang === 'ru'
        ? 'Отменено. Название счёта не изменено.'
        : 'Cancelled. The account name was not changed.';
    }
    if (type === 'UPDATE_GOAL') {
      return lang === 'ru'
        ? 'Отменено. Цель не изменена.'
        : 'Cancelled. The goal was not changed.';
    }
    return lang === 'ru' ? 'Отменено.' : 'Cancelled.';
  };

  const cancelToolCall = (msgId: string, _userQuestion: string, type: string) => {
    const target = globalChatHistory.find(m => m.id === msgId);
    if (!target || target.toolCallStatus === 'cancelled' || target.toolCallStatus === 'completed') {
      return;
    }

    const timerId = activeTimersRef.current[msgId];
    if (timerId) {
      clearInterval(timerId);
      delete activeTimersRef.current[msgId];
    }

    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return { ...m, toolCallStatus: 'cancelled', countdown: undefined };
      }
      return m;
    }));

    setMessages(prev => [...prev, {
      id: 'ai_cancel_' + Date.now(),
      text: buildCancelMessage(type),
      isUser: false,
      isToolConfirmation: true,
    }]);
  };

  const formatNumber = (value: number) => {
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const buildSuccessMessage = (
    type: ToolType,
    data: any,
    result: any
  ) => {
    if (type === 'BTC_PRICE') {
      return lang === 'ru'
        ? `Готово. Текущая цена Bitcoin: $${formatNumber(result.price)}.`
        : `Done. Current Bitcoin price: $${formatNumber(result.price)}.`;
    }

    if (type === 'UPDATE_BALANCE') {
      const operationText =
        data.type === 'add'
          ? (lang === 'ru' ? 'добавлено' : 'added')
          : data.type === 'subtract'
            ? (lang === 'ru' ? 'списано' : 'subtracted')
            : (lang === 'ru' ? 'установлено' : 'set');

      return lang === 'ru'
        ? `Готово: ${operationText} ${formatNumber(data.amount)} ${data.currency}.\nНовый баланс ${result.accountName}: ${formatNumber(result.newAmount)} ${result.currency} (≈ $${formatNumber(result.newUsdValue)}).`
        : `Done: ${operationText} ${formatNumber(data.amount)} ${data.currency}.\nNew ${result.accountName} balance: ${formatNumber(result.newAmount)} ${result.currency} (≈ $${formatNumber(result.newUsdValue)}).`;
    }

    if (type === 'CREATE_ACCOUNT') {
      return lang === 'ru'
        ? `Готово: создан счет ${result.accountName} с балансом ${formatNumber(result.amount)} ${result.currency} (≈ $${formatNumber(result.usdValue)}).`
        : `Done: created ${result.accountName} with ${formatNumber(result.amount)} ${result.currency} (≈ $${formatNumber(result.usdValue)}).`;
    }

    if (type === 'RENAME_ACCOUNT') {
      return `Done: renamed ${result.oldName} to ${result.newName}.`;
    }

    return lang === 'ru'
      ? `Готово. Цель обновлена: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`
      : `Done. Goal updated: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`;
  };

  const executeToolAction = async (msgId: string, userQuestion: string, type: ToolType, data: any) => {
    const target = globalChatHistory.find(m => m.id === msgId);
    if (
      target &&
      (target.toolCallStatus === 'cancelled' ||
        target.toolCallStatus === 'completed' ||
        target.toolCallStatus === 'running')
    ) {
      return;
    }

    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return { ...m, toolCallStatus: 'running' };
      }
      return m;
    }));

    setIsLoading(true);
    try {
      let result: any = null;
      let effectiveType: ToolType = type;
      let effectiveData = data;
      if (type === 'BTC_PRICE') {
        const price = await getBitcoinPrice();
        result = { price };
      } 
      else if (type === 'UPDATE_BALANCE') {
        const resolvedMutation = resolveBalanceMutation(userQuestion, data);
        if (resolvedMutation.action === 'create') {
          throw new Error('Account creation through balance commands is disabled');
        } else {
          effectiveData = resolvedMutation.data;
          result = executeBalanceUpdate(
            resolvedMutation.data.accountId,
            resolvedMutation.data.amount,
            resolvedMutation.data.currency,
            resolvedMutation.data.type
          );
        }
      }
      else if (type === 'CREATE_ACCOUNT') {
        throw new Error('Account creation through chat is disabled');
      }
      else if (type === 'RENAME_ACCOUNT') {
        throw new Error('Account rename through chat is disabled');
      }
      else if (type === 'UPDATE_GOAL') {
        result = updateGoal(data.targetValue, data.title, data.currency);
      }

      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return { ...m, toolCallStatus: 'completed' };
        }
        return m;
      }));

      setMessages(prev => [...prev, { 
        id: 'ai_' + Date.now(), 
        text: buildSuccessMessage(effectiveType, effectiveData, result),
        isUser: false,
        isToolConfirmation: true
      }]);
    } catch (e: any) {
      console.error(e);
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return { ...m, toolCallStatus: 'completed', text: `Error: ${m.text}` };
        }
        return m;
      }));

      const errorText = lang === 'ru'
        ? `Не удалось выполнить действие: ${e?.message || e}`
        : `Failed to execute action: ${e?.message || e}`;

      setMessages(prev => [...prev, { 
        id: 'ai_' + Date.now(), 
        text: errorText, 
        isUser: false,
        isToolConfirmation: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttachPress = () => {
    Alert.alert(
      t('addScreenshotTitle', lang),
      t('addScreenshotDesc', lang),
      [
        { text: t('takePhotoCamera', lang), onPress: takePhoto },
        { text: t('chooseFromLibrary', lang), onPress: pickImage },
        { text: t('cancel', lang), style: "cancel" }
      ]
    );
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('permissionRequired', lang), t('cameraPermissionDesc', lang));
      return;
    }
    
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      processScreenshot(result.assets[0].uri);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('permissionRequired', lang), t('photoPermissionDesc', lang));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      processScreenshot(result.assets[0].uri);
    }
  };

  const processScreenshot = async (uri: string) => {
    setIsLoading(true);
    
    const ocrLoadingId = Date.now().toString();
    setMessages(prev => [...prev, { 
      id: ocrLoadingId, 
      text: t('processingScreenshot', lang), 
      isUser: false 
    }]);

    try {
      const ocrText = await recognizeImageText(uri);
      const parsed = await parseBalanceFromOcrText(ocrText);
      
      setMessages(prev => prev.filter(m => m.id !== ocrLoadingId));

      if (parsed) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: t('foundBalanceScreenshot', lang, { bank: parsed.bank, amount: parsed.amount, currency: parsed.currency }),
          isUser: false,
          isPendingOcrConfirm: true,
          ocrData: {
            bank: parsed.bank,
            amount: parsed.amount,
            currency: parsed.currency,
            rawText: ocrText,
            screenshotPath: uri
          }
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: t('ocrExtractError', lang),
          isUser: false
        }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.filter(m => m.id !== ocrLoadingId));
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: t('ocrModelError', lang),
        isUser: false
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmOcrSave = (msgId: string, ocrData: any) => {
    try {
      const result = upsertAccountBalance(
        ocrData.bank,
        ocrData.amount,
        ocrData.currency,
        ocrData.rawText,
        ocrData.screenshotPath
      );
      
      // Refresh the accounts list
      setExistingAccounts(getLatestBalances());
      
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return {
            ...m,
            text: t('savedBalanceSqlite', lang, { bank: ocrData.bank, amount: ocrData.amount, currency: ocrData.currency, usd: result.usdValue.toFixed(2) }),
            isPendingOcrConfirm: false,
            ocrData: undefined
          };
        }
        return m;
      }));

      setTimeout(async () => {
        setIsLoading(true);
        const userText = t('confirmOcrUpdatePrompt', lang, { bank: ocrData.bank, amount: ocrData.amount, currency: ocrData.currency });
        const aiMsgId = 'ai_' + Date.now();
        const placeholder = t('aiCalculating', lang);
          
        setMessages(prev => [...prev, { 
          id: aiMsgId, 
          text: placeholder, 
          isUser: false,
          isToolConfirmation: true
        }]);

        try {
          const history = getCleanChatHistory();
          const systemMsg = `SYSTEM: The user successfully confirmed the OCR screenshot balance update. The balance of account '${ocrData.bank}' has already been updated in the database to ${ocrData.amount} ${ocrData.currency} (USD equivalent: $${result.usdValue.toFixed(2)}). Please inform the user that the balance was updated successfully and confirm the new balance details. Do NOT output any tool calls.`;
          
          const response = await continueMuffinAi(userText, systemMsg, activeModel, (currentText) => {
            setMessages(prev => prev.map(m => {
              if (m.id === aiMsgId) {
                return { ...m, text: currentText };
              }
              return m;
            }));
          }, history);
          await handleAiResponse(userText, response.message, aiMsgId, response.stats);
        } catch (e) {
          console.error(e);
          setMessages(prev => prev.map(m => {
            if (m.id === aiMsgId) {
              return { ...m, text: t('aiOcrSaveConfirmError', lang) };
            }
            return m;
          }));
        } finally {
          setIsLoading(false);
        }
      }, 500);

    } catch (e) {
      console.error(e);
      Alert.alert(t('dbErrorTitle', lang), t('dbSaveBalanceError', lang));
    }
  };

  const cancelOcrSave = (msgId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return {
          ...m,
          text: t('cancelledSavingBalance', lang),
          isPendingOcrConfirm: false,
          ocrData: undefined
        };
      }
      return m;
    }));
  };

  const stopTimer = (msgId: string) => {
    const timerId = activeTimersRef.current[msgId];
    if (timerId) {
      clearInterval(timerId);
      delete activeTimersRef.current[msgId];
    }
  };

  const getToolDescription = (item: Message) => {
    if (item.toolCallType === 'UPDATE_BALANCE' && item.toolCallData) {
      const { type, amount, currency, accountName } = item.toolCallData;
      if (type === 'add') {
        return t('toolAddBalance', lang, { amount, currency, accountName });
      } else if (type === 'subtract') {
        return t('toolSubtractBalance', lang, { amount, currency, accountName });
      } else {
        return t('toolSetBalance', lang, { amount, currency, accountName });
      }
    }
    if (item.toolCallType === 'UPDATE_GOAL' && item.toolCallData) {
      return t('toolUpdateGoal', lang, { title: item.toolCallData.title, targetValue: item.toolCallData.targetValue.toLocaleString() });
    }
    if (item.toolCallType === 'CREATE_ACCOUNT' && item.toolCallData) {
      return t('toolCreateAccount', lang, {
        accountName: item.toolCallData.accountName,
        amount: item.toolCallData.amount,
        currency: item.toolCallData.currency || 'USD',
      });
    }
    if (item.toolCallType === 'RENAME_ACCOUNT' && item.toolCallData) {
      return `Rename ${item.toolCallData.accountName} to ${item.toolCallData.newName}`;
    }
    return item.text;
  };

  // Build the short pills shown in the on-device inference badge under an
  // answer. Each pill is independent so missing engine stats just drop out.
  const buildStatsPills = (stats: InferenceStats): string[] => {
    const pills: string[] = [];
    // Answers resolved purely from local SQLite — no model inference at all.
    // This is an honest, stronger on-device story than any tok/s number.
    if (stats.instant) {
      pills.push(lang === 'ru' ? 'мгновенно' : 'instant');
      pills.push(lang === 'ru' ? 'без вызова модели' : '0 inference');
      return pills;
    }
    if (stats.backendDevice === 'gpu') {
      pills.push(lang === 'ru' ? 'GPU' : 'GPU');
    } else if (stats.backendDevice === 'cpu') {
      pills.push('CPU');
    }
    if (stats.tokensPerSec > 0) {
      pills.push(`${stats.tokensPerSec.toFixed(1)} tok/s`);
    }
    if (stats.ttftMs > 0) {
      pills.push(`TTFT ${Math.round(stats.ttftMs)} ms`);
    }
    if (stats.cacheTokens && stats.cacheTokens > 0) {
      pills.push(lang === 'ru' ? 'KV-кэш' : 'KV cache');
    }
    return pills;
  };

  // Shared "on-device" inference badge, rendered under plain answers and inside
  // tool-call cards (a tool call is still produced by an on-device QVAC inference).
  const renderStatsBadge = (stats: InferenceStats) => (
    <View style={styles.statsRow}>
      <View style={styles.statsLeadPill}>
        <Ionicons name="flash" size={11} color={colors.accent} />
        <Text style={styles.statsLeadText}>{t('onDeviceBadge', lang)}</Text>
      </View>
      {buildStatsPills(stats).map((pill, idx) => (
        <View key={idx} style={styles.statsPill}>
          <Text style={styles.statsPillText}>{pill}</Text>
        </View>
      ))}
    </View>
  );

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.isToolCall) {
      const meta = TOOL_META[item.toolCallType as ToolType] ?? TOOL_META.UPDATE_BALANCE;
      const statusChip =
        item.toolCallStatus === 'completed'
          ? { label: lang === 'ru' ? 'Готово' : 'Done', tone: 'success' as const, icon: 'checkmark-circle' as const }
          : item.toolCallStatus === 'cancelled'
            ? { label: lang === 'ru' ? 'Отменено' : 'Cancelled', tone: 'danger' as const, icon: 'close-circle' as const }
            : item.toolCallStatus === 'running'
              ? { label: lang === 'ru' ? 'Выполняется' : 'Running', tone: 'info' as const, icon: 'sync' as const }
              : null;
      return (
        <View style={[styles.messageRow, { justifyContent: 'flex-start' }]}>
          <View style={[styles.toolCard, { borderColor: meta.color }]}>
            <View style={styles.toolHeaderRow}>
              <View style={[styles.toolIconBadge, { backgroundColor: meta.soft }]}>
                <Ionicons name={meta.icon} size={18} color={meta.color} />
              </View>
              <Text style={[styles.toolTitle, { color: meta.color }]}>
                {item.toolCallType === 'BTC_PRICE'
                  ? t('cryptoQuery', lang)
                  : item.toolCallType === 'UPDATE_GOAL'
                    ? t('goalUpdate', lang)
                    : item.toolCallType === 'CREATE_ACCOUNT'
                      ? t('createAccountAction', lang)
                      : item.toolCallType === 'RENAME_ACCOUNT'
                        ? 'Rename account'
                        : t('balanceAction', lang)}
              </Text>
              {statusChip && (
                <View style={styles.toolHeaderChip}>
                  <StatusChip label={statusChip.label} tone={statusChip.tone} icon={statusChip.icon} />
                </View>
              )}
            </View>
            <Text style={styles.toolText}>{getToolDescription(item)}</Text>

            {item.toolCallStatus === 'pending' && item.countdown !== undefined && (
              <View style={styles.countdownRow}>
                <ProgressRing
                  percent={(item.countdown / TOOL_COUNTDOWN_SECONDS) * 100}
                  size={44}
                  strokeWidth={4}
                  color={meta.color}
                  label={String(item.countdown)}
                />
                <View style={styles.countdownInfo}>
                  <Text style={styles.countdownLabel}>
                    {lang === 'ru' ? 'Авто-выполнение' : 'Auto-run'}
                  </Text>
                  <TouchableOpacity
                    style={styles.toolCancelButton}
                    onPress={() => cancelToolCall(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', item.toolCallType || '')}
                  >
                    <Ionicons name="close" size={13} color="#FFF" />
                    <Text style={styles.toolCancelText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallType === 'CREATE_ACCOUNT' && item.toolCallStatus === 'pending' && item.toolCallData && (
              <View style={styles.ocrEditContainer}>
                <Text style={styles.ocrSectionTitle}>{t('accountLabel', lang)}</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.accountName || '')}
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            accountName: text
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <Text style={styles.ocrSectionTitle}>{t('amountLabel', lang)}</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.amount)}
                  keyboardType="numeric"
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    const val = parseFloat(text) || 0;
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            amount: val
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <Text style={styles.ocrSectionTitle}>{t('currencyLabel', lang)}</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.currency || 'USD')}
                  autoCapitalize="characters"
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            currency: text.toUpperCase()
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <View style={styles.confirmButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.confirmButton, styles.yesButton]}
                    onPress={() => {
                      stopTimer(item.id);
                      executeToolAction(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'CREATE_ACCOUNT', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButton, styles.noButton]}
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'CREATE_ACCOUNT');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallType === 'UPDATE_BALANCE' && item.toolCallStatus === 'pending' && item.toolCallData && (
              <View style={styles.ocrEditContainer}>
                <Text style={styles.ocrSectionTitle}>{t('accountLabel', lang)}</Text>
                <View style={styles.chipsContainer}>
                  {existingAccounts.map((acc) => {
                    const isSelected = item.toolCallData.accountId === acc.id || item.toolCallData.accountName?.toLowerCase() === acc.name.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={acc.id}
                        style={[styles.chip, isSelected && styles.chipActive]}
                        onPress={() => {
                          stopTimer(item.id);
                          setMessages(prev => prev.map(m => {
                            if (m.id === item.id && m.toolCallData) {
                              return {
                                ...m,
                                countdown: undefined,
                                toolCallData: {
                                  ...m.toolCallData,
                                  accountId: acc.id,
                                  accountName: acc.name
                                }
                              };
                            }
                            return m;
                          }));
                        }}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                          {acc.name} (${acc.usd_value?.toFixed(0)})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.ocrSectionTitle}>{t('operationLabel', lang)}</Text>
                <View style={styles.chipsContainer}>
                  {['set', 'add', 'subtract'].map((opType) => {
                    const isSelected = item.toolCallData.type === opType;
                    let label = '';
                    if (opType === 'set') label = t('setOp', lang);
                    else if (opType === 'add') label = t('addOp', lang);
                    else label = t('spendOp', lang);

                    return (
                      <TouchableOpacity
                        key={opType}
                        style={[styles.chip, isSelected && styles.chipActive]}
                        onPress={() => {
                          stopTimer(item.id);
                          setMessages(prev => prev.map(m => {
                            if (m.id === item.id && m.toolCallData) {
                              return {
                                ...m,
                                countdown: undefined,
                                toolCallData: {
                                  ...m.toolCallData,
                                  type: opType
                                }
                              };
                            }
                            return m;
                          }));
                        }}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.ocrSectionTitle}>{t('amountLabel', lang)} ({item.toolCallData.currency || 'USD'})</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.amount)}
                  keyboardType="numeric"
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    const val = parseFloat(text) || 0;
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            amount: val
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <View style={styles.confirmButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.yesButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      executeToolAction(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'UPDATE_BALANCE', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.noButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'UPDATE_BALANCE');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallType === 'RENAME_ACCOUNT' && item.toolCallStatus === 'pending' && item.toolCallData && (
              <View style={styles.ocrEditContainer}>
                <Text style={styles.ocrSectionTitle}>New account name</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.newName || '')}
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            newName: text
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <View style={styles.confirmButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.confirmButton, styles.yesButton]}
                    onPress={() => {
                      stopTimer(item.id);
                      executeToolAction(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'RENAME_ACCOUNT', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButton, styles.noButton]}
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'RENAME_ACCOUNT');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallType === 'UPDATE_GOAL' && item.toolCallStatus === 'pending' && item.toolCallData && (
              <View style={styles.ocrEditContainer}>
                <Text style={styles.ocrSectionTitle}>{t('goalNameLabel', lang)}</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={item.toolCallData.title}
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            title: text
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <Text style={styles.ocrSectionTitle}>{t('targetAmountLabel', lang)}</Text>
                <TextInput
                  style={styles.ocrTextInput}
                  value={String(item.toolCallData.targetValue)}
                  keyboardType="numeric"
                  onChangeText={(text) => {
                    stopTimer(item.id);
                    const val = parseFloat(text) || 0;
                    setMessages(prev => prev.map(m => {
                      if (m.id === item.id && m.toolCallData) {
                        return {
                          ...m,
                          countdown: undefined,
                          toolCallData: {
                            ...m.toolCallData,
                            targetValue: val
                          }
                        };
                      }
                      return m;
                    }));
                  }}
                />

                <View style={styles.confirmButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.yesButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      executeToolAction(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'UPDATE_GOAL', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.noButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, item.sourceQuestion || messages[messages.length - 2]?.text || '', 'UPDATE_GOAL');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallStatus === 'running' && (
              <View style={styles.toolProgressContainer}>
                <ActivityIndicator size="small" color={meta.color} />
                <Text style={[styles.toolProgressText, { marginLeft: 8 }]}>
                  {t('runningAction', lang)}
                </Text>
              </View>
            )}

            {item.stats && renderStatsBadge(item.stats)}
          </View>
        </View>
      );
    }

    const { thinking, response } = parseModelResponse(item.text);
    const displayed = item.isUser ? response : getDisplayedText(item.text);
    const showTyping = !item.isUser && !thinking && (!displayed || item.text === t('aiCalculating', lang));

    return (
      <View style={[styles.messageRow, { justifyContent: item.isUser ? 'flex-end' : 'flex-start' }]}>
        {!item.isUser && (
          <View style={styles.avatar}>
            <Ionicons name="sparkles" size={15} color={colors.accent} />
          </View>
        )}
        <View style={[styles.messageBubble, item.isUser ? styles.userBubble : styles.aiBubble]}>
          {item.ocrData?.screenshotPath && (
            <Image
              source={{ uri: item.ocrData.screenshotPath }}
              style={styles.messageImage}
              resizeMode="cover"
            />
          )}

          {!item.isUser && thinking && (
            <ThinkingBox title={t('aiThinking', lang)} content={thinking} />
          )}

          {showTyping ? (
            <TypingDots />
          ) : (
            <Text style={[styles.messageText, item.isUser ? styles.userText : styles.aiText]}>
              {displayed}
            </Text>
          )}

          {!item.isUser && !showTyping && item.stats && renderStatsBadge(item.stats)}

          {!item.isUser && !showTyping && item.clarifications && item.clarifications.length > 0 && (
            <View style={styles.chipsContainer}>
              {item.clarifications.map((c, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.chip}
                  onPress={() => sendClarification(c.prompt)}
                >
                  <Text style={styles.chipText}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {item.isPendingOcrConfirm && item.ocrData && (
            <View style={styles.ocrEditContainer}>
              <Text style={styles.ocrSectionTitle}>{t('assignToAccount', lang)}</Text>
              <View style={styles.chipsContainer}>
                {existingAccounts.map((acc) => {
                  const isSelected = item.ocrData?.bank?.toLowerCase() === acc.name.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={acc.id}
                      style={[styles.chip, isSelected && styles.chipActive]}
                      onPress={() => {
                        setMessages(prev => prev.map(m => {
                          if (m.id === item.id && m.ocrData) {
                            return {
                              ...m,
                              ocrData: {
                                ...m.ocrData,
                                bank: acc.name
                              }
                            };
                          }
                          return m;
                        }));
                      }}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                        {acc.name} (${acc.usd_value?.toFixed(0)})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.ocrSectionTitle}>{t('orEnterNewAccountName', lang)}</Text>
              <TextInput
                style={styles.ocrTextInput}
                value={item.ocrData.bank}
                onChangeText={(text) => {
                  setMessages(prev => prev.map(m => {
                    if (m.id === item.id && m.ocrData) {
                      return {
                        ...m,
                        ocrData: {
                          ...m.ocrData,
                          bank: text
                        }
                      };
                    }
                    return m;
                  }));
                }}
                placeholder={t('ocrAccountPlaceholder', lang)}
                placeholderTextColor="#777"
              />

              <View style={styles.confirmButtonsContainer}>
                <TouchableOpacity 
                  style={[styles.confirmButton, styles.yesButton]} 
                  onPress={() => confirmOcrSave(item.id, item.ocrData)}
                >
                  <Text style={styles.confirmButtonText}>{t('saveBalanceButton', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.confirmButton, styles.noButton]} 
                  onPress={() => cancelOcrSave(item.id)}
                >
                  <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderModelSettingsModal = () => (
    <Modal
      visible={isModelSettingsVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setIsModelSettingsVisible(false)}
    >
      <TouchableOpacity
        style={styles.settingsOverlay}
        activeOpacity={1}
        onPress={() => setIsModelSettingsVisible(false)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.settingsPanel}>
          <View style={styles.settingsHeader}>
            <View>
              <Text style={styles.settingsTitle}>{lang === 'ru' ? 'Модели' : 'Models'}</Text>
              <Text style={styles.settingsSubtitle}>
                {lang === 'ru' ? 'Файлы и загрузка в память' : 'Files and RAM loading'}
              </Text>
            </View>
            <TouchableOpacity style={styles.settingsCloseButton} onPress={() => setIsModelSettingsVisible(false)}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modelSettingsList}>
            {MODEL_IDS.map((id) => {
              const spec = MODEL_CATALOG[id];
              const status = modelStatuses[id] || { exists: false, loaded: false };
              const isActive = id === activeModel;
              const isBusy = modelBusyId === id || (isActive && (isModelDownloading || isInitializing));
              const progressText = isBusy && (isModelDownloading || downloadedBytes > 0)
                ? `${(downloadedBytes / 1e9).toFixed(2)} ${lang === 'ru' ? 'ГБ' : 'GB'}`
                : null;

              return (
                <View key={id} style={[styles.modelSettingsRow, isActive && styles.modelSettingsRowActive]}>
                  <View style={styles.modelSettingsTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modelSettingsName}>{spec.label}</Text>
                      <Text style={styles.modelSettingsHint}>{spec.hint} - {spec.sizeLabel}</Text>
                    </View>
                    <View style={styles.modelStatusPills}>
                      {isActive && <StatusChip label="Active" tone="success" icon="checkmark-circle" />}
                      {status.loaded && <StatusChip label="Loaded" tone="info" icon="flash" />}
                      <StatusChip
                        label={status.exists ? 'File' : 'Missing'}
                        tone={status.exists ? 'neutral' : 'danger'}
                        icon={status.exists ? 'document' : 'cloud-download'}
                      />
                    </View>
                  </View>

                  {isBusy && (
                    <View style={styles.modelBusyRow}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={styles.modelBusyText}>
                        {isInitializing
                          ? (lang === 'ru' ? 'Загрузка в память...' : 'Loading into RAM...')
                          : (progressText || (lang === 'ru' ? 'Скачивание...' : 'Downloading...'))}
                      </Text>
                    </View>
                  )}

                  <View style={styles.modelActionsRow}>
                    <TouchableOpacity
                      style={[styles.modelActionButton, isActive && styles.modelActionButtonActive]}
                      onPress={() => handleSelectModel(id)}
                      disabled={isActive || isBusy || isLoading || Boolean(modelBusyId)}
                    >
                      <Text style={[styles.modelActionText, isActive && styles.modelActionTextActive]}>
                        {lang === 'ru' ? 'Выбрать' : 'Select'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modelActionButton}
                      onPress={() => handleDownloadModel(id)}
                      disabled={status.exists || isBusy || Boolean(modelBusyId)}
                    >
                      <Text style={styles.modelActionText}>{lang === 'ru' ? 'Скачать' : 'Download'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modelActionButton}
                      onPress={() => handleLoadModel(id)}
                      disabled={!status.exists || status.loaded || isBusy || Boolean(modelBusyId)}
                    >
                      <Text style={styles.modelActionText}>{lang === 'ru' ? 'Загрузить' : 'Load'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modelActionButton, styles.modelDeleteButton]}
                      onPress={() => confirmDeleteModel(id)}
                      disabled={!status.exists || isBusy || Boolean(modelBusyId)}
                    >
                      <Text style={[styles.modelActionText, styles.modelDeleteText]}>
                        {lang === 'ru' ? 'Удалить' : 'Delete'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {(isModelDownloading || isInitializing) && (
        <View style={styles.downloadContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.downloadText}>
            {isInitializing
              ? t('modelInitializing', lang, { size: MODEL_CATALOG[activeModel].sizeLabel })
              : t('modelDownloading', lang, {
                  downloaded: `${(downloadedBytes / 1e9).toFixed(2)} ${lang === 'ru' ? 'ГБ' : 'GB'}`,
                  size: MODEL_CATALOG[activeModel].sizeLabel,
                })
            }
          </Text>
        </View>
      )}
      {renderModelSettingsModal()}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 88 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
      <View style={[styles.modelRail, { display: 'none' }]}>
        <Text style={styles.modelRailLabel}>{lang === 'ru' ? 'Модель:' : 'Model:'}</Text>
        {MODEL_IDS.map((id) => {
          const spec = MODEL_CATALOG[id];
          const isActive = id === activeModel;
          return (
            <TouchableOpacity
              key={id}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => handleSelectModel(id)}
              disabled={isLoading || isInitializing}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>
                {spec.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.promptRail}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.promptRailContent}
        >
          {demoPrompts.map((prompt) => (
            <TouchableOpacity
              key={prompt}
              style={styles.promptChip}
              onPress={() => applyDemoPrompt(prompt)}
              disabled={isLoading || isRecording || isWhisperDownloading || isWhisperInitializing}
            >
              <Ionicons name="sparkles" size={12} color={colors.accent} />
              <Text style={styles.promptChipText} numberOfLines={1}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {(isWhisperDownloading || isWhisperInitializing) && (
        <View style={styles.downloadContainer}>
          <ActivityIndicator size="small" color="#4CAF50" />
          <Text style={[styles.downloadText, { marginTop: 4 }]}>
            {isWhisperInitializing
              ? t('speechModelInitializing', lang)
              : t('speechModelDownloading', lang, { progress: whisperProgress.toFixed(1) })
            }
          </Text>
        </View>
      )}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing(2)) }]}>
        <TouchableOpacity style={styles.attachButton} onPress={handleAttachPress} disabled={!isModelReady || isLoading || isWhisperDownloading || isWhisperInitializing}>
          <Ionicons name="add" size={22} color={colors.textSecondary} />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder={isRecording ? t('listeningPlaceholder', lang) : t('askMuffinPlaceholder', lang)}
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          editable={!isRecording && !isLoading && !isWhisperDownloading && !isWhisperInitializing}
        />

        <TouchableOpacity
          style={[styles.micButton, isRecording && styles.micButtonActive]}
          onPress={handleMicPress}
          disabled={!isModelReady || isLoading || isWhisperDownloading || isWhisperInitializing}
        >
          <Ionicons name={isRecording ? 'stop' : 'mic'} size={20} color={isRecording ? '#FFF' : colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.sendButton, (!inputText.trim() || isLoading || isRecording) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={isLoading || !inputText.trim() || isRecording}>
          {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-up" size={20} color="#FFF" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginRight: spacing(2),
  },
  messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  messageBubble: { maxWidth: '80%', paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), borderRadius: radius.lg },
  userBubble: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  messageText: { fontSize: fontSize.md, lineHeight: 22 },
  userText: { color: '#FFF' },
  aiText: { color: colors.textPrimary },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing(2),
    paddingTop: spacing(2),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statsLeadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSoft,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
  },
  statsLeadText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  statsPill: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statsPillText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'flex-end',
    paddingTop: spacing(12),
    paddingHorizontal: spacing(3),
  },
  settingsPanel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    ...shadow.floating,
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    marginBottom: spacing(3),
  },
  settingsTitle: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: '800' },
  settingsSubtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  settingsCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  modelSettingsList: { gap: spacing(3) },
  modelSettingsRow: {
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    gap: spacing(2),
  },
  modelSettingsRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modelSettingsTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  modelSettingsName: { color: colors.textPrimary, fontSize: fontSize.md, fontWeight: '800' },
  modelSettingsHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  modelStatusPills: {
    maxWidth: 130,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 5,
  },
  modelBusyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelBusyText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  modelActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modelActionButton: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing(2.5),
    paddingVertical: 7,
  },
  modelActionButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modelActionText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '800' },
  modelActionTextActive: { color: colors.accent },
  modelDeleteButton: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  modelDeleteText: { color: colors.danger },
  modelRail: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
    backgroundColor: colors.surface,
  },
  modelRailLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginRight: 2,
  },
  promptRail: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing(2),
  },
  promptRailContent: {
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingBottom: spacing(2),
  },
  promptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 230,
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(3),
    paddingVertical: 7,
  },
  promptChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing(2),
    alignItems: 'center',
  },
  contextBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
  },
  contextPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 5,
  },
  contextText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700', maxWidth: 240 },
  contextClearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.lg,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
    color: colors.textPrimary,
    fontSize: fontSize.md,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceInput,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceInput,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonActive: { backgroundColor: colors.danger },
  sendButton: {
    backgroundColor: colors.accent,
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.borderStrong },
  downloadContainer: {
    padding: spacing(4),
    alignItems: 'center',
    backgroundColor: colors.surface,
    margin: spacing(4),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  downloadText: { color: colors.accent, marginTop: 8, textAlign: 'center' },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: radius.sm,
    marginBottom: 8,
  },
  confirmButtonsContainer: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(3) },
  confirmButton: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(4),
    borderRadius: radius.sm,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesButton: { backgroundColor: colors.accent },
  noButton: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong },
  confirmButtonText: { color: '#FFF', fontWeight: '700', fontSize: fontSize.sm },

  // Tool Call card
  toolCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing(4),
    marginVertical: 4,
    width: 280,
    ...shadow.card,
  },
  toolHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing(2) },
  toolIconBadge: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolHeaderChip: { marginLeft: 'auto' },
  toolTitle: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flexShrink: 1,
  },
  toolText: { color: colors.textPrimary, fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing(2) },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(1) },
  countdownInfo: { flex: 1, gap: 6 },
  countdownLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  toolProgressContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  toolProgressText: { color: colors.textSecondary, fontSize: fontSize.xs, fontStyle: 'italic' },
  toolCancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSoft,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  toolCancelText: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '700' },

  ocrEditContainer: { marginTop: spacing(2), width: '100%' },
  ocrSectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginTop: spacing(2),
    marginBottom: 4,
  },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  chip: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: fontSize.xs },
  chipTextActive: { color: colors.accent, fontWeight: '700' },
  ocrTextInput: {
    backgroundColor: colors.surfaceInput,
    color: colors.textPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 4,
  },
});
