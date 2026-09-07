import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MinTouchTarget, Radii, Spacing, StatusColors, type StatusTone } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Build 27 shared visual primitives. Every screen used to re-declare the
 * same card/chip/section shapes locally (the token doc counted 200+
 * hardcoded hex occurrences and identical `card:` style blocks in most
 * screens); these are those shapes, named once. Semantic status tones come
 * from StatusColors — a screen never invents a color for a state the
 * vocabulary already names, and every pair keeps AA contrast in both
 * light and dark schemes.
 */

export function Card({ children, style, elevated = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, elevated ? (Elevation.card as ViewStyle) : null, style]}>
      {children}
    </ThemedView>
  );
}

export function SectionHeader({ title, accessory }: { title: string; accessory?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <ThemedText type="smallBold" accessibilityRole="header">
        {title}
      </ThemedText>
      {accessory ?? null}
    </View>
  );
}

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const scheme = useColorScheme() ?? 'light';
  const palette = StatusColors[tone][scheme];
  return (
    <View style={[styles.chip, { backgroundColor: palette.background }]} accessible accessibilityLabel={label}>
      <ThemedText type="small" style={{ color: palette.text, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </View>
  );
}

export function StatTile({ label, value, chip }: { label: string; value: string | number; chip?: ReactNode }) {
  return (
    <Card style={styles.statTile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle">{value}</ThemedText>
      {chip ?? null}
    </Card>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.emptyState} accessible accessibilityLabel={body ? `${title}. ${body}` : title}>
      <ThemedText type="smallBold" style={styles.emptyTitle}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          {body}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.md,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  chip: {
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: Spacing.half + 1,
    alignSelf: 'flex-start',
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: MinTouchTarget,
  },
  emptyState: {
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.one,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
  },
});
