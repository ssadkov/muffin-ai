import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  ActivityIndicator, 
  Keyboard,
  Alert,
  Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { colors, radius, spacing, fontSize, shadow } from '../theme/theme';
import ProgressRing from '../components/ProgressRing';
import StatusChip from '../components/StatusChip';
import TypingDots from '../components/TypingDots';
import ThinkingBox from '../components/ThinkingBox';
import { askMuffinAi, continueMuffinAi } from '../agent/muffinAiAgent';
import { extractBalanceAccountNameHint, findMatchingAccount, parseFinanceCommand } from '../agent/commandParser';
import { downloadModelIfNeeded, initLocalModel, checkModelExists, isModelLoaded, InferenceStats } from '../services/qvacService';
import { recognizeImageText, parseBalanceFromOcrText } from '../services/ocrService';
import { upsertAccountBalance, executeBalanceUpdate, getLatestBalances, updateGoal, getSetting } from '../tools/databaseTools';
import { getBitcoinPrice } from '../tools/cryptoApiTools';
import * as ImagePicker from 'expo-image-picker';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { downloadWhisperModelIfNeeded, initWhisperModel, transcribeAudio, isWhisperModelLoaded } from '../services/transcriptionService';
import { useIsFocused } from '@react-navigation/native';
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
  toolCallType?: 'BTC_PRICE' | 'CREATE_ACCOUNT' | 'UPDATE_BALANCE' | 'UPDATE_GOAL';
  toolCallData?: any;
  toolCallStatus?: 'pending' | 'running' | 'completed' | 'cancelled';
  countdown?: number;
  rawToolCallText?: string;
  isToolConfirmation?: boolean;
  sourceQuestion?: string;
  // QVAC on-device inference telemetry, shown as a badge under the answer.
  stats?: InferenceStats;
}

const TOOL_COUNTDOWN_SECONDS = 5;

type ToolType = 'BTC_PRICE' | 'CREATE_ACCOUNT' | 'UPDATE_BALANCE' | 'UPDATE_GOAL';

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
  UPDATE_GOAL: { icon: 'flag-outline', color: colors.info, soft: colors.infoSoft },
};

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

  const activeModel = 'qwen';

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isModelReady, setIsModelReady] = useState(isModelLoaded('qwen'));
  const [isInitializing, setIsInitializing] = useState(false);
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
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [lang, setLang] = useState<Language>('ru');
  const [existingAccounts, setExistingAccounts] = useState<any[]>([]);

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

  useEffect(() => {
    async function setupModel() {
      if (isModelLoaded('qwen')) {
        setIsModelReady(true);
        return;
      }
      try {
        const exists = await checkModelExists('qwen');
        if (exists) {
          setIsInitializing(true);
        }
        const modelPath = await downloadModelIfNeeded('qwen', (progress) => {
          setDownloadProgress(progress);
          if (progress < 100) {
            setIsInitializing(false);
          } else {
            setIsInitializing(true);
          }
        });
        setIsInitializing(true);
        await initLocalModel(modelPath, 'qwen');
        setIsModelReady(true);
      } catch (e) {
        console.error("Model setup error:", e);
      } finally {
        setIsInitializing(false);
      }
    }
    setupModel();

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
      const parsed = parseFinanceCommand(question, accounts);
      if (parsed?.action === 'create_account') {
        return {
          action: 'create',
          data: {
            accountName: parsed.name,
            amount,
            currency,
          },
        };
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
        return {
          action: 'create',
          data: {
            accountName: accountNameHint,
            amount,
            currency,
          },
        };
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
      return {
        action: 'create',
        data: {
          accountName: proposedAccountName,
          amount,
          currency,
        },
      };
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
        }, history);
        await handleAiResponse(cleanText, response.message, aiMsgId, response.stats);
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
    
    const userMsg = { id: Date.now().toString(), text: inputText, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    const originalText = inputText;
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
      }, history);
      await handleAiResponse(userMsg.text, response.message, aiMsgId, response.stats);
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

  const handleAiResponse = async (userQuestion: string, aiText: string, aiMsgId?: string, stats?: InferenceStats) => {
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
      const match = aiText.match(/\[?TOOL_CALL: CREATE_ACCOUNT:\s*(\{.*?\})\]?/);
      if (match) {
        try {
          const parsedToolData = JSON.parse(match[1]);
          const toolData = {
            accountName: String(parsedToolData.accountName || parsedToolData.name || '').trim(),
            amount: Number(parsedToolData.amount),
            currency: String(parsedToolData.currency || 'USD').toUpperCase(),
          };
          if (!toolData.accountName || !Number.isFinite(toolData.amount) || toolData.amount < 0) {
            throw new Error('Invalid CREATE_ACCOUNT payload');
          }

          const msgId = Date.now().toString();
          const newMsg: Message = {
            id: msgId,
            text: t('toolCreateAccount', lang, { accountName: toolData.accountName, amount: toolData.amount, currency: toolData.currency }),
            isUser: false,
            isToolCall: true,
            toolCallType: 'CREATE_ACCOUNT',
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
                return { ...m, text: t('toolCreateAccountIntro', lang), isToolConfirmation: true };
              }
              return m;
            });
            return [...updated, newMsg];
          });

          startToolCountdown(msgId, userQuestion, 'CREATE_ACCOUNT', toolData);
        } catch (e) {
          console.error("Failed to parse create account tool call JSON", e);
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
    else if (aiText.includes('TOOL_CALL: UPDATE_BALANCE:')) {
      const match = aiText.match(/\[?TOOL_CALL: UPDATE_BALANCE:\s*(\{.*?\})\]?/);
      if (match) {
        try {
          const toolData = JSON.parse(match[1]);
          const msgId = Date.now().toString();

          const resolvedMutation = resolveBalanceMutation(userQuestion, toolData);
          if (resolvedMutation.action === 'create') {
            const newMsg: Message = {
              id: msgId,
              text: t('toolCreateAccount', lang, {
                accountName: resolvedMutation.data.accountName,
                amount: resolvedMutation.data.amount,
                currency: resolvedMutation.data.currency,
              }),
              isUser: false,
              isToolCall: true,
              toolCallType: 'CREATE_ACCOUNT',
              toolCallData: resolvedMutation.data,
              toolCallStatus: 'pending',
              countdown: TOOL_COUNTDOWN_SECONDS,
              rawToolCallText: aiText,
              sourceQuestion: userQuestion,
              stats
            };

            setMessages(prev => {
              const updated = prev.map(m => {
                if (m.id === aiMsgId) {
                  return { ...m, text: t('toolCreateAccountIntro', lang), isToolConfirmation: true };
                }
                return m;
              });
              return [...updated, newMsg];
            });

            startToolCountdown(msgId, userQuestion, 'CREATE_ACCOUNT', resolvedMutation.data);
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
            countdown: TOOL_COUNTDOWN_SECONDS,
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

          startToolCountdown(msgId, userQuestion, 'UPDATE_BALANCE', resolvedToolData);
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
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText, stats } : m));
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false, stats }]);
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

  const cancelToolCall = async (msgId: string, userQuestion: string, type: string) => {
    const timerId = activeTimersRef.current[msgId];
    if (timerId) {
      clearInterval(timerId);
      delete activeTimersRef.current[msgId];
    }

    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return { ...m, toolCallStatus: 'cancelled', text: t('actionCancelled', lang, { action: m.text }) };
      }
      return m;
    }));

    setIsLoading(true);
    
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
      const response = await continueMuffinAi(
        userQuestion, 
        `SYSTEM: The user cancelled the ${type} tool execution. Please confirm the cancellation to the user.`,
        activeModel,
        (currentText) => {
          setMessages(prev => prev.map(m => {
            if (m.id === aiMsgId) {
              return { ...m, text: currentText };
            }
            return m;
          }));
        },
        history
      );
      await handleAiResponse(userQuestion, response.message, aiMsgId, response.stats);
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.map(m => {
        if (m.id === aiMsgId) {
          return { ...m, text: t('aiCancelConfirmError', lang) };
        }
        return m;
      }));
    } finally {
      setIsLoading(false);
    }
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

    return lang === 'ru'
      ? `Готово. Цель обновлена: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`
      : `Done. Goal updated: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`;
  };

  const executeToolAction = async (msgId: string, userQuestion: string, type: ToolType, data: any) => {
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
          effectiveType = 'CREATE_ACCOUNT';
          effectiveData = resolvedMutation.data;
          const saved = upsertAccountBalance(
            resolvedMutation.data.accountName,
            resolvedMutation.data.amount,
            resolvedMutation.data.currency,
            undefined,
            undefined,
            'manual'
          );
          result = {
            accountName: resolvedMutation.data.accountName,
            amount: resolvedMutation.data.amount,
            currency: resolvedMutation.data.currency,
            usdValue: saved.usdValue,
          };
          setExistingAccounts(getLatestBalances());
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
        const accountName = String(data.accountName || '').trim();
        const amount = Number(data.amount);
        const currency = String(data.currency || 'USD').toUpperCase();
        if (!accountName || !Number.isFinite(amount) || amount < 0) {
          throw new Error('Invalid account name or amount');
        }
        const saved = upsertAccountBalance(accountName, amount, currency, undefined, undefined, 'manual');
        result = {
          accountName,
          amount,
          currency,
          usdValue: saved.usdValue,
        };
        setExistingAccounts(getLatestBalances());
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
    return item.text;
  };

  // Build the short pills shown in the on-device inference badge under an
  // answer. Each pill is independent so missing engine stats just drop out.
  const buildStatsPills = (stats: InferenceStats): string[] => {
    const pills: string[] = [];
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {!isModelReady && (
        <View style={styles.downloadContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.downloadText}>
            {isInitializing 
              ? t('modelInitializing', lang)
              : t('modelDownloading', lang, { progress: downloadProgress.toFixed(1) })
            }
          </Text>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
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
