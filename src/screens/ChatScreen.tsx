import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard } from 'react-native';
import { askMuffinAi } from '../agent/muffinAiAgent';
import { downloadModelIfNeeded, initLocalModel } from '../services/qvacService';

export default function ChatScreen() {
  const [messages, setMessages] = useState<{ id: string, text: string, isUser: boolean }[]>([
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

  const renderMessage = ({ item }: { item: any }) => (
    <View style={[styles.messageBubble, item.isUser ? styles.userBubble : styles.aiBubble]}>
      <Text style={[styles.messageText, item.isUser ? styles.userText : styles.aiText]}>{item.text}</Text>
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
  bottomSafeArea: { height: Platform.OS === 'ios' ? 20 : 0, backgroundColor: '#1E1E1E' }
});
