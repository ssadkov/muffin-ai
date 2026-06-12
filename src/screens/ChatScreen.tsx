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
import { askMuffinAi, continueMuffinAi } from '../agent/muffinAiAgent';
import { downloadModelIfNeeded, initLocalModel, checkModelExists, isModelLoaded } from '../services/qvacService';
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
  toolCallType?: 'BTC_PRICE' | 'UPDATE_BALANCE' | 'UPDATE_GOAL';
  toolCallData?: any;
  toolCallStatus?: 'pending' | 'running' | 'completed' | 'cancelled';
  countdown?: number;
  rawToolCallText?: string;
  isToolConfirmation?: boolean;
}

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
  const [lang, setLang] = useState<Language>('ru');
  const [existingAccounts, setExistingAccounts] = useState<any[]>([]);

  const getDisplayedText = (text: string) => {
    const { response } = parseModelResponse(text);
    if (!response) return '';
    const cleanResponse = response.trim();
    if (cleanResponse.startsWith('[')) {
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
        await handleAiResponse(cleanText, response.message, aiMsgId);
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
      await handleAiResponse(userMsg.text, response.message, aiMsgId);
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

  const handleAiResponse = async (userQuestion: string, aiText: string, aiMsgId?: string) => {
    if (aiText.includes('TOOL_CALL: BTC_PRICE')) {
      const msgId = Date.now().toString();
      const newMsg: Message = {
        id: msgId,
        text: t('fetchingBtcPrice', lang),
        isUser: false,
        isToolCall: true,
        toolCallType: 'BTC_PRICE',
        toolCallStatus: 'pending',
        countdown: 5,
        rawToolCallText: aiText
      };
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== aiMsgId);
        return [...filtered, newMsg];
      });
      startToolCountdown(msgId, userQuestion, 'BTC_PRICE', null);
    } 
    else if (aiText.includes('TOOL_CALL: UPDATE_BALANCE:')) {
      const match = aiText.match(/\[?TOOL_CALL: UPDATE_BALANCE:\s*(\{.*?\})\]?/);
      if (match) {
        try {
          const toolData = JSON.parse(match[1]);
          const msgId = Date.now().toString();
          
          const accounts = getLatestBalances();
          const account = accounts.find(a => a.id === toolData.accountId);
          const accountName = account ? account.name : toolData.accountId;

          let opText = '';
          if (toolData.type === 'add') {
            opText = t('toolAddBalance', lang, { amount: toolData.amount, currency: toolData.currency, accountName });
          } else if (toolData.type === 'subtract') {
            opText = t('toolSubtractBalance', lang, { amount: toolData.amount, currency: toolData.currency, accountName });
          } else {
            opText = t('toolSetBalance', lang, { amount: toolData.amount, currency: toolData.currency, accountName });
          }

          const newMsg: Message = {
            id: msgId,
            text: opText,
            isUser: false,
            isToolCall: true,
            toolCallType: 'UPDATE_BALANCE',
            toolCallData: { ...toolData, accountName },
            toolCallStatus: 'pending',
            countdown: 5,
            rawToolCallText: aiText
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

          startToolCountdown(msgId, userQuestion, 'UPDATE_BALANCE', toolData);
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
            countdown: 5,
            rawToolCallText: aiText
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
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText } : m));
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
      }
    }

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const startToolCountdown = (msgId: string, userQuestion: string, type: 'BTC_PRICE' | 'UPDATE_BALANCE' | 'UPDATE_GOAL', data: any) => {
    let timeLeft = 5;
    
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
      await handleAiResponse(userQuestion, response.message, aiMsgId);
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
    type: 'BTC_PRICE' | 'UPDATE_BALANCE' | 'UPDATE_GOAL',
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

    return lang === 'ru'
      ? `Готово. Цель обновлена: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`
      : `Done. Goal updated: ${result.title}, ${formatNumber(result.targetValue)} ${result.currency}.`;
  };

  const executeToolAction = async (msgId: string, userQuestion: string, type: 'BTC_PRICE' | 'UPDATE_BALANCE' | 'UPDATE_GOAL', data: any) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return { ...m, toolCallStatus: 'running' };
      }
      return m;
    }));

    setIsLoading(true);
    try {
      let result: any = null;
      if (type === 'BTC_PRICE') {
        const price = await getBitcoinPrice();
        result = { price };
      } 
      else if (type === 'UPDATE_BALANCE') {
        result = executeBalanceUpdate(data.accountId, data.amount, data.currency, data.type);
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
        text: buildSuccessMessage(type, data, result), 
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
          await handleAiResponse(userText, response.message, aiMsgId);
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
    return item.text;
  };

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.isToolCall) {
      return (
        <View style={[styles.messageRow, { justifyContent: 'flex-start' }]}>
          <View style={styles.toolCard}>
            <Text style={styles.toolTitle}>
              {item.toolCallType === 'BTC_PRICE' 
                ? t('cryptoQuery', lang) 
                : item.toolCallType === 'UPDATE_GOAL' 
                  ? t('goalUpdate', lang) 
                  : t('balanceAction', lang)}
            </Text>
            <Text style={styles.toolText}>{getToolDescription(item)}</Text>
            
            {item.toolCallStatus === 'pending' && (
              <View style={styles.toolProgressContainer}>
                {item.countdown !== undefined && (
                  <Text style={styles.toolProgressText}>
                    {t('executingInSeconds', lang, { seconds: item.countdown || 0 })}
                  </Text>
                )}
                {item.countdown !== undefined && (
                  <TouchableOpacity 
                    style={styles.toolCancelButton} 
                    onPress={() => cancelToolCall(item.id, messages[messages.length - 2]?.text || '', item.toolCallType || '')}
                  >
                    <Text style={styles.toolCancelText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                )}
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
                      executeToolAction(item.id, messages[messages.length - 2]?.text || '', 'UPDATE_BALANCE', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.noButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, messages[messages.length - 2]?.text || '', 'UPDATE_BALANCE');
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
                      executeToolAction(item.id, messages[messages.length - 2]?.text || '', 'UPDATE_GOAL', item.toolCallData);
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirmButton', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.confirmButton, styles.noButton]} 
                    onPress={() => {
                      stopTimer(item.id);
                      cancelToolCall(item.id, messages[messages.length - 2]?.text || '', 'UPDATE_GOAL');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {item.toolCallStatus === 'running' && (
              <View style={styles.toolProgressContainer}>
                <ActivityIndicator size="small" color="#4CAF50" />
                <Text style={[styles.toolProgressText, { marginLeft: 8 }]}>
                  {t('runningAction', lang)}
                </Text>
              </View>
            )}

            {item.toolCallStatus === 'completed' && (
              <Text style={styles.toolStatusCompleted}>
                {t('completedAction', lang)}
              </Text>
            )}

            {item.toolCallStatus === 'cancelled' && (
              <Text style={styles.toolStatusCancelled}>
                {t('cancelledAction', lang)}
              </Text>
            )}
          </View>
        </View>
      );
    }

    const { thinking, response } = parseModelResponse(item.text);

    return (
      <View style={[styles.messageRow, { justifyContent: item.isUser ? 'flex-end' : 'flex-start' }]}>
        <View style={[styles.messageBubble, item.isUser ? styles.userBubble : styles.aiBubble]}>
          {item.ocrData?.screenshotPath && (
            <Image 
              source={{ uri: item.ocrData.screenshotPath }} 
              style={styles.messageImage} 
              resizeMode="cover"
            />
          )}

          {!item.isUser && thinking && (
            <View style={[
              styles.thinkingBox, 
              { borderLeftColor: '#4CAF50' }
            ]}>
              <Text style={[
                styles.thinkingTitle, 
                { color: '#4CAF50' }
              ]}>{t('aiThinking', lang)}</Text>
              <Text style={styles.thinkingContent}>{thinking}</Text>
            </View>
          )}

          {response ? (
            <Text style={[styles.messageText, item.isUser ? styles.userText : styles.aiText]}>
              {item.isUser ? response : getDisplayedText(item.text)}
            </Text>
          ) : (
            !item.isUser && !thinking && (
              <Text style={[styles.messageText, styles.aiText, { fontStyle: 'italic', color: '#888' }]}>
                {getDisplayedText(item.text)}
              </Text>
            )
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

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
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
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton} onPress={handleAttachPress} disabled={!isModelReady || isLoading || isWhisperDownloading || isWhisperInitializing}>
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder={isRecording ? t('listeningPlaceholder', lang) : t('askMuffinPlaceholder', lang)}
          placeholderTextColor="#888"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          editable={!isRecording && !isLoading && !isWhisperDownloading && !isWhisperInitializing}
        />
        <TouchableOpacity style={[styles.sendButton, (!inputText.trim() || isLoading || isRecording) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={isLoading || !inputText.trim() || isRecording}>
          {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendIcon}>↑</Text>}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.attachButton, isRecording && { backgroundColor: '#D32F2F' }]} 
          onPress={handleMicPress} 
          disabled={!isModelReady || isLoading || isWhisperDownloading || isWhisperInitializing}
        >
          <Text style={styles.attachIcon}>{isRecording ? '🛑' : '🎙️'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.bottomSafeArea} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  messageRow: { width: '100%', flexDirection: 'row' },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16 },
  userBubble: { backgroundColor: '#4CAF50', borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: '#333', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 16, lineHeight: 22 },
  userText: { color: '#FFF' },
  aiText: { color: '#FFF' },
  inputContainer: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1E1E1E', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#333', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#FFF', fontSize: 16, minHeight: 40, maxHeight: 100 },
  sendButton: { backgroundColor: '#4CAF50', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#555' },
  sendIcon: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  downloadContainer: { padding: 16, alignItems: 'center', backgroundColor: '#333', margin: 16, borderRadius: 12 },
  downloadText: { color: '#4CAF50', marginTop: 8, textAlign: 'center' },
  bottomSafeArea: { height: Platform.OS === 'ios' ? 20 : 0, backgroundColor: '#1E1E1E' },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachIcon: {
    color: '#FFF',
    fontSize: 20,
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
  },
  confirmButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  confirmButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  yesButton: {
    backgroundColor: '#4CAF50',
  },
  noButton: {
    backgroundColor: '#D32F2F',
  },
  confirmButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },

  // Tool Call card styles
  toolCard: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    borderRadius: 12,
    padding: 14,
    marginVertical: 4,
    width: 250,
  },
  toolTitle: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  toolText: {
    color: '#FFF',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  toolProgressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  toolProgressText: {
    color: '#AAA',
    fontSize: 12,
    fontStyle: 'italic',
  },
  toolCancelButton: {
    backgroundColor: '#D32F2F',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  toolCancelText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  toolStatusCompleted: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  toolStatusCancelled: {
    color: '#D32F2F',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  modelToggleHeader: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    padding: 6
  },
  toggleTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent'
  },
  activeTab: {
    backgroundColor: '#2A2A2A',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600'
  },
  activeTabText: {
    color: '#FFF'
  },
  thinkingBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderLeftWidth: 2.5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  thinkingTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  thinkingContent: {
    color: '#AAA',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  ocrEditContainer: {
    marginTop: 8,
    width: '100%',
  },
  ocrSectionTitle: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 4,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  chip: {
    backgroundColor: '#444',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#555',
  },
  chipActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  chipText: {
    color: '#CCC',
    fontSize: 11,
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  ocrTextInput: {
    backgroundColor: '#222',
    color: '#FFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#444',
    marginVertical: 4,
  },
});
