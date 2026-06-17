import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, Platform, ViewStyle } from 'react-native';
import { colors, radius, spacing, fontSize } from '../theme/theme';

interface FormInputProps extends TextInputProps {
  label: string;
  mono?: boolean;
  containerStyle?: ViewStyle;
}

export default function FormInput({ label, mono, containerStyle, style, multiline, ...rest }: FormInputProps) {
  return (
    <View style={[styles.wrapper, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, mono && styles.mono, multiline && styles.multiline, style]}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing(4) },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceInput,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
    color: colors.textPrimary,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  multiline: {
    minHeight: 78,
  },
});
