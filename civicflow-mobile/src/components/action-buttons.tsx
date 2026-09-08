import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionColors, Spacing } from '@/constants/theme';

/**
 * The large centered solid-button + text-link-secondary-button pair used by
 * every full-screen flow (attendance-scan.tsx, pta-family-photo.tsx) had
 * near-identical style blocks independently hand-rolled per screen. This
 * consolidates that one shape. It deliberately does NOT try to also cover
 * the small inline roster action buttons in
 * volunteer-checkin/[opportunityId].tsx -- that's a different visual
 * pattern (compact, multiple-per-row, outline/danger variants) and forcing
 * both shapes into one component would make neither one right.
 */

interface PrimaryActionButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  loadingLabel?: string;
  loading?: boolean;
}

export function PrimaryActionButton({ label, loadingLabel, loading, disabled, accessibilityLabel, ...rest }: PrimaryActionButtonProps) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      style={[styles.primary, isDisabled && styles.disabled]}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      {...rest}
    >
      <ThemedText style={styles.primaryText}>{loading ? (loadingLabel ?? label) : label}</ThemedText>
    </Pressable>
  );
}

interface SecondaryLinkButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  danger?: boolean;
}

export function SecondaryLinkButton({ label, danger, accessibilityLabel, ...rest }: SecondaryLinkButtonProps) {
  return (
    <Pressable style={styles.secondary} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} {...rest}>
      <ThemedText type="link" style={danger ? styles.dangerText : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: ActionColors.primary,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  primaryText: {
    color: ActionColors.primaryText,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  dangerText: {
    color: ActionColors.danger,
  },
});
