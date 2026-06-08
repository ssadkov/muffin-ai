import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { getLatestBalances } from '../tools/databaseTools';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    setAccounts(getLatestBalances());
  }, []);

  const renderItem = ({ item }: { item: any }) => {
    const isWarning = false; // Could cross check with rules

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={[styles.value, isWarning && styles.warningValue]}>${item.usd_value}</Text>
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { backgroundColor: '#1E1E1E', padding: 16, borderRadius: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  name: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  value: { color: '#4CAF50', fontSize: 16, fontWeight: 'bold' },
  warningValue: { color: '#ffb74d' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  source: { color: '#888', fontSize: 12 },
  date: { color: '#888', fontSize: 12 }
});
