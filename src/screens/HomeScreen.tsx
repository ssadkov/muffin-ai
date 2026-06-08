import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { getTotalLiquidAssets, getActiveGoals } from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const [assets, setAssets] = useState(0);
  const [goal, setGoal] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);

  useEffect(() => {
    if (isFocused) {
      setAssets(getTotalLiquidAssets());
      const goals = getActiveGoals();
      if (goals.length > 0) setGoal(goals[0]);
      setWarnings(checkMoneyRules());
    }
  }, [isFocused]);

  const progress = goal && goal.target_value > 0 ? ((assets / goal.target_value) * 100).toFixed(1) : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>Private Money Memory</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Total liquid assets</Text>
        <Text style={styles.cardValue}>${assets.toLocaleString()}</Text>
      </View>

      {goal && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Goal: {goal.title}</Text>
          <Text style={styles.cardValue}>{progress}%</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%` as any }]} />
          </View>
        </View>
      )}

      {warnings.length > 0 && (
        <View style={[styles.card, styles.warningCard]}>
          <Text style={styles.warningTitle}>{warnings.length} Rule Warnings</Text>
          {warnings.map((w, i) => (
            <Text key={i} style={styles.warningText}>• {w.message}</Text>
          ))}
        </View>
      )}

      <View style={styles.buttonGrid}>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Chat')}>
          <Text style={styles.buttonText}>Ask Muffin AI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Accounts')}>
          <Text style={styles.buttonText}>View Accounts</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { marginBottom: 24, alignItems: 'center' },
  subtitle: { color: '#888', fontSize: 16 },
  card: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 16, marginBottom: 16 },
  cardLabel: { color: '#AAA', fontSize: 14, marginBottom: 8 },
  cardValue: { color: '#FFF', fontSize: 32, fontWeight: 'bold' },
  progressBarBg: { height: 8, backgroundColor: '#333', borderRadius: 4, marginTop: 12 },
  progressBarFill: { height: 8, backgroundColor: '#4CAF50', borderRadius: 4 },
  warningCard: { backgroundColor: '#3b2818', borderColor: '#ff9800', borderWidth: 1 },
  warningTitle: { color: '#ffb74d', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  warningText: { color: '#ffcc80', fontSize: 14, marginBottom: 4 },
  buttonGrid: { gap: 12, marginTop: 8 },
  button: { backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' }
});
