import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, fontSize, spacing } from '../theme/theme';

interface ThinkingBoxProps {
  title: string;
  content: string;
}

/** Collapsible "chain of thought" panel shown above an assistant reply. */
export default function ThinkingBox({ title, content }: ThinkingBoxProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.box}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <View style={styles.titleRow}>
          <Ionicons name="bulb-outline" size={13} color={colors.accent} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </TouchableOpacity>
      {expanded && <Text style={styles.content}>{content}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderLeftWidth: 2.5,
    borderLeftColor: colors.accent,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderRadius: radius.sm,
    marginBottom: spacing(2),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  content: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: spacing(2),
  },
});
