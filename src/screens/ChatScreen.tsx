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
import { askMuffinAi } from '../agent/muffinAiAgent';
import { downloadModelIfNeeded, initLocalModel } from '../services/qvacService';
import { recognizeImageText, parseBalanceFromOcrText } from '../services/ocrService';
import { upsertAccountBalance } from '../tools/databaseTools';
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
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response.message, isUser: false }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: "Sorry, I had an issue connecting to the AI.", isUser: false }]);
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
    
    // Add a temporary OCR loading message in the chat
    const ocrLoadingId = Date.now().toString();
    setMessages(prev => [...prev, { 
      id: ocrLoadingId, 
      text: "🔍 Processing screenshot (OCR + Local AI parsing)...", 
      isUser: false 
    }]);

    try {
      // 1. Run OCR
      const ocrText = await recognizeImageText(uri);
      
      // 2. Parse with LLM
      const parsed = await parseBalanceFromOcrText(ocrText);
      
      // Remove the temporary loading message
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
      // Remove loading message
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
            text: `✅ Saved balance to SQLite:\n🏦 Bank: ${ocrData.bank}\n💰 Balance: ${ocrData.amount} ${ocrData.currency}\nEquivalent: $${result.usdValue.toFixed(2)}`,
            isPendingOcrConfirm: false,
            ocrData: undefined
          };
        }
        return m;
      }));

      // Trigger rules check and response update after saving
      setTimeout(async () => {
        setIsLoading(true);
        try {
          const response = await askMuffinAi(`I just updated my ${ocrData.bank} balance to ${ocrData.amount} ${ocrData.currency}.`);
          setMessages(prev => [...prev, { id: Date.now().toString(), text: response.message, isUser: false }]);
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

  const renderMessage = ({ item }: { item: Message }) => (
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
});
