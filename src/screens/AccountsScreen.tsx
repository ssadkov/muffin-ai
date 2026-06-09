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
import { getLatestBalances, updateAccountAddress, createWalletAccount } from '../tools/databaseTools';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [addressInput, setAddressInput] = useState('');

  // Add Wallet state
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletNetwork, setNewWalletNetwork] = useState('solana_public_wallet');
  const [newWalletAddress, setNewWalletAddress] = useState('');

  useEffect(() => {
    setAccounts(getLatestBalances());
  }, []);

  const openEditModal = (account: any) => {
    setSelectedAccount(account);
    setAddressInput(account.address || '');
    setIsEditModalVisible(true);
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
      Alert.alert("Error", "Failed to save address to database.");
    }
  };

  const handleCreateWallet = () => {
    const trimmedName = newWalletName.trim();
    const trimmedAddress = newWalletAddress.trim();

    if (!trimmedName) {
      Alert.alert("Validation Error", "Please enter a wallet name.");
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
      Alert.alert("Error", "Failed to create new wallet account.");
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isCryptoWallet = item.source.endsWith('_wallet') || item.type === 'crypto_wallet';

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
          <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Add Button */}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={() => setIsAddModalVisible(true)}
      >
        <Text style={styles.addButtonText}>➕ Add Crypto Wallet</Text>
      </TouchableOpacity>

      <FlatList
        data={accounts}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ gap: 12, paddingBottom: 20 }}
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
                  onPress={() => setIsEditModalVisible(false)}
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
              <Text style={styles.modalTitle}>Add New Wallet</Text>
              
              <Text style={styles.inputLabel}>Wallet Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. My Ledger SOL, Ethereum mainnet"
                placeholderTextColor="#666"
                value={newWalletName}
                onChangeText={setNewWalletName}
              />

              <Text style={styles.inputLabel}>Network</Text>
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

              <Text style={styles.inputLabel}>Wallet Address</Text>
              <TextInput
                style={[styles.modalInput, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}
                placeholder="Enter wallet address / public key"
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
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButton]} 
                  onPress={handleCreateWallet}
                >
                  <Text style={styles.buttonText}>Add Wallet</Text>
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
  }
});
