/**
 * Central design tokens for Muffin AI.
 * Keep all colors, spacing, radii and type sizes here so the UI stays consistent
 * instead of relying on scattered inline style literals.
 */

export const colors = {
  // Surfaces
  bg: '#0E0F13',
  surface: '#181A20',
  surfaceAlt: '#20242E',
  surfaceInput: '#23272F',
  border: '#2A2E38',
  borderStrong: '#3A4150',

  // Text
  textPrimary: '#F4F6FA',
  textSecondary: '#9AA3B2',
  textMuted: '#6B7280',

  // Brand / accents
  accent: '#19C37D',
  accentDark: '#0E9E63',
  accentSoft: 'rgba(25, 195, 125, 0.14)',

  info: '#3B82F6',
  infoSoft: 'rgba(59, 130, 246, 0.16)',

  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.14)',

  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.14)',

  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.14)',

  white: '#FFFFFF',
} as const;

/** Hero / accent gradients (tuples typed for expo-linear-gradient). */
export const gradients = {
  hero: ['#11998E', '#38EF7D'] as const,
  company: ['#3B82F6', '#6366F1'] as const,
  danger: ['#7F1D1D', '#B91C1C'] as const,
};

/** 4pt spacing scale helper: spacing(2) === 8. */
export const spacing = (n: number) => n * 4;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 30,
  display: 36,
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;
