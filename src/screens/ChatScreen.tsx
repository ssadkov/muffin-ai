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
import { downloadModelIfNeeded, initLocalModel } from '../services/qvacService';
import { recognizeImageText, parseBalanceFromOcrText } from '../services/ocrService';
import { upsertAccountBalance, executeBalanceUpdate, getLatestBalances } from '../tools/databaseTools';
import { getBitcoinPrice } from '../tools/cryptoApiTools';
import * as ImagePicker from 'expo-image-picker';

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
  toolCallType?: 'BTC_PRICE' | 'UPDATE_BALANCE';
  toolCallData?: any;
  toolCallStatus?: 'pending' | 'running' | 'completed' | 'cancelled';
  countdown?: number;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Hi! I am Muffin AI. Ask me about your accounts, goals or rules.', isUser: false }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  
  // Track active countdown timers so they can be cancelled
  const activeTimersRef = useRef<{ [msgId: string]: any }>({});

  useEffect(() => {
    async function setupModel() {
      try {
        const modelPath = await downloadModelIfNeeded((progress) => {
          setDownloadProgress(progress);
        });
        await initLocalModel(modelPath);
        setIsModelReady(true);
      } catch (e) {
        console.error("Model setup error:", e);
      }
    }
    setupModel();

    return () => {
      // Clear all active timers on unmount
      Object.values(activeTimersRef.current).forEach(clearInterval);
    };
  }, []);

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    
    const userMsg = { id: Date.now().toString(), text: inputText, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);
    Keyboard.dismiss();

    try {
      const response = await askMuffinAi(userMsg.text);
      await handleAiResponse(userMsg.text, response.message);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: "Sorry, I had an issue connecting to the AI.", isUser: false }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAiResponse = async (userQuestion: string, aiText: string) => {
    if (aiText.includes('[TOOL_CALL: BTC_PRICE]')) {
      const msgId = Date.now().toString();
      const newMsg: Message = {
        id: msgId,
        text: "Fetching real-time Bitcoin price...",
        isUser: false,
        isToolCall: true,
        toolCallType: 'BTC_PRICE',
        toolCallStatus: 'pending',
        countdown: 3
      };
      setMessages(prev => [...prev, newMsg]);
      startToolCountdown(msgId, userQuestion, 'BTC_PRICE', null);
    } 
    else if (aiText.includes('[TOOL_CALL: UPDATE_BALANCE:')) {
      const match = aiText.match(/\[TOOL_CALL: UPDATE_BALANCE: (\{.*?\})\]/);
      if (match) {
        try {
          const toolData = JSON.parse(match[1]);
          const msgId = Date.now().toString();
          
          const accounts = getLatestBalances();
          const account = accounts.find(a => a.id === toolData.accountId);
          const accountName = account ? account.name : toolData.accountId;

          let opText = '';
          if (toolData.type === 'add') opText = `Add ${toolData.amount} ${toolData.currency} to ${accountName}`;
          else if (toolData.type === 'subtract') opText = `Spend ${toolData.amount} ${toolData.currency} from ${accountName}`;
          else opText = `Set balance of ${accountName} to ${toolData.amount} ${toolData.currency}`;

          const newMsg: Message = {
            id: msgId,
            text: opText,
            isUser: false,
            isToolCall: true,
            toolCallType: 'UPDATE_BALANCE',
            toolCallData: { ...toolData, accountName },
            toolCallStatus: 'pending',
            countdown: 3
          };
          setMessages(prev => [...prev, newMsg]);
          startToolCountdown(msgId, userQuestion, 'UPDATE_BALANCE', toolData);
        } catch (e) {
          console.error("Failed to parse tool call JSON", e);
          setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
        }
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
      }
    } 
    else {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: aiText, isUser: false }]);
    }
  };

  const startToolCountdown = (msgId: string, userQuestion: string, type: 'BTC_PRICE' | 'UPDATE_BALANCE', data: any) => {
    let timeLeft = 3;
    
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
        return { ...m, toolCallStatus: 'cancelled', text: `Action cancelled: ${m.text}` };
      }
      return m;
    }));

    setIsLoading(true);
    try {
      const response = await continueMuffinAi(
        userQuestion, 
        `SYSTEM: The user cancelled the ${type} tool execution. Please confirm the cancellation to the user.`
      );
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response.message, isUser: false }]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const executeToolAction = async (msgId: string, userQuestion: string, type: 'BTC_PRICE' | 'UPDATE_BALANCE', data: any) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return { ...m, toolCallStatus: 'running' };
      }
      return m;
    }));

    setIsLoading(true);
    try {
      let systemMessage = '';
      if (type === 'BTC_PRICE') {
        const price = await getBitcoinPrice();
        systemMessage = `SYSTEM: Tool returned Bitcoin price = $${price}. Please answer the user now.`;
      } 
      else if (type === 'UPDATE_BALANCE') {
        const result = executeBalanceUpdate(data.accountId, data.amount, data.currency, data.type);
        systemMessage = `SYSTEM: Tool successfully executed ${data.type} of ${data.amount} ${data.currency} for account '${result.accountName}'. New account balance is ${result.newAmount} ${result.currency} (USD equivalent: $${result.newUsdValue.toFixed(2)}). Please tell the user that the balance has been updated and confirm the new details.`;
      }

      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return { ...m, toolCallStatus: 'completed' };
        }
        return m;
      }));

      const response = await continueMuffinAi(userQuestion, systemMessage);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response.message, isUser: false }]);
    } catch (e: any) {
      console.error(e);
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return { ...m, toolCallStatus: 'completed', text: `Error: ${m.text}` };
        }
        return m;
      }));
      
      const errorMsg = `SYSTEM: Failed to execute tool call. Error: ${e?.message || e}. Please let the user know.`;
      const response = await continueMuffinAi(userQuestion, errorMsg);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response.message, isUser: false }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttachPress = () => {
    Alert.alert(
      "Add Bank Screenshot",
      "Choose how to add your bank screenshot",
      [
        { text: "Take Photo / Camera", onPress: takePhoto },
        { text: "Choose from Library", onPress: pickImage },
        { text: "Cancel", style: "cancel" }
      ]
    );
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert("Permission Required", "Camera permission is required to take a screenshot photo.");
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
      Alert.alert("Permission Required", "Photo library permission is required to select a screenshot.");
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
      text: "🔍 Processing screenshot (OCR + Local AI parsing)...", 
      isUser: false 
    }]);

    try {
      const ocrText = await recognizeImageText(uri);
      const parsed = await parseBalanceFromOcrText(ocrText);
      
      setMessages(prev => prev.filter(m => m.id !== ocrLoadingId));

      if (parsed) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `Found balance in screenshot:\n🏦 Bank: ${parsed.bank}\n💰 Balance: ${parsed.amount} ${parsed.currency}`,
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
          text: "Could not extract bank name or balance from the screenshot. Please try again with a clearer image.",
          isUser: false
        }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.filter(m => m.id !== ocrLoadingId));
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: "Error processing the screenshot. Make sure the OCR model is fully loaded.",
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
      
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return {
            ...m,
            text: `Saved balance to SQLite:\n🏦 Bank: ${ocrData.bank}\n💰 Balance: ${ocrData.amount} ${ocrData.currency}\nEquivalent: $${result.usdValue.toFixed(2)}`,
            isPendingOcrConfirm: false,
            ocrData: undefined
          };
        }
        return m;
      }));

      setTimeout(async () => {
        setIsLoading(true);
        try {
          const response = await askMuffinAi(`I just updated my ${ocrData.bank} balance to ${ocrData.amount} ${ocrData.currency}.`);
          await handleAiResponse(`I just updated my ${ocrData.bank} balance to ${ocrData.amount} ${ocrData.currency}.`, response.message);
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoading(false);
        }
      }, 500);

    } catch (e) {
      console.error(e);
      Alert.alert("Database Error", "Failed to save balance to SQLite database.");
    }
  };

  const cancelOcrSave = (msgId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return {
          ...m,
          text: "❌ Cancelled saving balance.",
          isPendingOcrConfirm: false,
          ocrData: undefined
        };
      }
      return m;
    }));
  };

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.isToolCall) {
      return (
        <View style={styles.toolCard}>
          <Text style={styles.toolTitle}>
            {item.toolCallType === 'BTC_PRICE' ? '🌐 Crypto Query' : '⚙️ Balance Action'}
          </Text>
          <Text style={styles.toolText}>{item.text}</Text>
          
          {item.toolCallStatus === 'pending' && (
            <View style={styles.toolProgressContainer}>
              <Text style={styles.toolProgressText}>
                Executing in {item.countdown}s...
              </Text>
              <TouchableOpacity 
                style={styles.toolCancelButton} 
                onPress={() => cancelToolCall(item.id, messages[messages.length - 2]?.text || '', item.toolCallType || '')}
              >
                <Text style={styles.toolCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {item.toolCallStatus === 'running' && (
            <View style={styles.toolProgressContainer}>
              <ActivityIndicator size="small" color="#4CAF50" />
              <Text style={[styles.toolProgressText, { marginLeft: 8 }]}>Running action...</Text>
            </View>
          )}

          {item.toolCallStatus === 'completed' && (
            <Text style={styles.toolStatusCompleted}>✓ Completed</Text>
          )}

          {item.toolCallStatus === 'cancelled' && (
            <Text style={styles.toolStatusCancelled}>✗ Cancelled</Text>
          )}
        </View>
      );
    }

    return (
      <View style={[styles.messageBubble, item.isUser ? styles.userBubble : styles.aiBubble]}>
        {item.ocrData?.screenshotPath && (
          <Image 
            source={{ uri: item.ocrData.screenshotPath }} 
            style={styles.messageImage} 
            resizeMode="cover"
          />
        )}
        <Text style={[styles.messageText, item.isUser ? styles.userText : styles.aiText]}>{item.text}</Text>
        
        {item.isPendingOcrConfirm && item.ocrData && (
          <View style={styles.confirmButtonsContainer}>
            <TouchableOpacity 
              style={[styles.confirmButton, styles.yesButton]} 
              onPress={() => confirmOcrSave(item.id, item.ocrData)}
            >
              <Text style={styles.confirmButtonText}>Save Balance</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.confirmButton, styles.noButton]} 
              onPress={() => cancelOcrSave(item.id)}
            >
              <Text style={styles.confirmButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
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
            Downloading AI Model ({downloadProgress.toFixed(1)}%)...
            Please wait, this will take a while (approx 2.1GB).
          </Text>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton} onPress={handleAttachPress} disabled={!isModelReady || isLoading}>
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Ask Muffin AI..."
          placeholderTextColor="#888"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={isLoading || !inputText.trim()}>
          {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendIcon}>↑</Text>}
        </TouchableOpacity>
      </View>
      <View style={styles.bottomSafeArea} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#4CAF50', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: '#333', borderBottomLeftRadius: 4 },
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
    alignSelf: 'flex-start',
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
});
