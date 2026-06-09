import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Modal, 
  TextInput, 
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import { getLatestBalances, updateAccountAddress } from '../tools/databaseTools';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [addressInput, setAddressInput] = useState('');

  useEffect(() => {
    setAccounts(getLatestBalances());
  }, []);

  const openEditModal = (account: any) => {
    setSelectedAccount(account);
    setAddressInput(account.address || '');
    setIsModalVisible(true);
  };

  const saveAddress = () => {
    if (!selectedAccount) return;
    
    const trimmedAddress = addressInput.trim();
    
    try {
      updateAccountAddress(selectedAccount.id, trimmedAddress);
      
      // Refresh state
      setAccounts(prev => prev.map(acc => {
        if (acc.id === selectedAccount.id) {
          return { ...acc, address: trimmedAddress };
        }
        return acc;
      }));
      
      setIsModalVisible(false);
      setSelectedAccount(null);
      setAddressInput('');
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to save address to database.");
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isCryptoWallet = item.source === 'solana_public_wallet' || item.source === 'aptos_public_wallet';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.value}>${item.usd_value}</Text>
        </View>
        
        {isCryptoWallet && (
          <View style={styles.addressContainer}>
            <Text style={styles.addressLabel}>Wallet Address:</Text>
            <View style={styles.addressRow}>
              <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
                {item.address || 'Not Configured'}
              </Text>
              <TouchableOpacity 
                style={styles.editButton} 
                onPress={() => openEditModal(item)}
              >
                <Text style={styles.editButtonText}>✏️ Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.source}>{item.source}</Text>
          <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={accounts}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ gap: 12, paddingBottom: 20 }}
      />

      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <Text style={styles.modalTitle}>
                Edit {selectedAccount?.name} Address
              </Text>
              
              <TextInput
                style={styles.modalInput}
                placeholder="Enter wallet public key / address"
                placeholderTextColor="#666"
                value={addressInput}
                onChangeText={setAddressInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setIsModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButton]} 
                  onPress={saveAddress}
                >
                  <Text style={styles.buttonText}>Save</Text>
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
  container: { flex: 1, padding: 16, backgroundColor: '#121212' },
  card: { backgroundColor: '#1E1E1E', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  name: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  value: { color: '#4CAF50', fontSize: 16, fontWeight: 'bold' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  source: { color: '#888', fontSize: 12 },
  date: { color: '#888', fontSize: 12 },
  
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
  modalInput: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    color: '#FFF',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#444'
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12
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
  }
});
