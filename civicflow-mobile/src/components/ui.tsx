import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MinTouchTarget, Radii, Spacing, StatusColors, WorkspaceColors, type StatusTone } from '@/constants/theme';
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

export function Card({
  children,
  style,
  elevated = true,
  ...rest
}: { children: ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean } & ViewProps) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, elevated ? (Elevation.card as ViewStyle) : null, style]} {...rest}>
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

export type Workspace = 'parent' | 'admin';

const WORKSPACE_PALETTES: Record<Workspace, { background: string; text: string; subtext: string }> = {
  parent: {
    background: WorkspaceColors.parentAccent,
    text: WorkspaceColors.parentHeaderText,
    subtext: WorkspaceColors.parentHeaderSubtext,
  },
  admin: {
    background: WorkspaceColors.adminAccent,
    text: WorkspaceColors.adminHeaderText,
    subtext: WorkspaceColors.adminHeaderSubtext,
  },
};

/**
 * The workspace identity banner — the single strongest visual signal that
 * parent/member surfaces (warm green) and administrative surfaces
 * (operational slate) are different rooms in the same product. Solid accent
 * in both schemes; the on-accent text pairs are the documented-AA
 * WorkspaceColors values.
 */
export function WorkspaceHero({
  workspace,
  title,
  subtitle,
  note,
}: {
  workspace: Workspace;
  title: string;
  subtitle?: string | null;
  note?: string | null;
}) {
  const palette = WORKSPACE_PALETTES[workspace];
  return (
    <View style={[styles.hero, { backgroundColor: palette.background }, Elevation.card as ViewStyle]}>
      <ThemedText type="title" style={{ color: palette.text }} accessibilityRole="header">
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText type="default" style={{ color: palette.subtext }}>
          {subtitle}
        </ThemedText>
      ) : null}
      {note ? (
        <ThemedText type="small" style={{ color: palette.subtext }}>
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

export type IconBadgeTone = StatusTone | Workspace;

/**
 * Colored icon container: a rounded square holding one text glyph (a
 * unicode symbol or a single letter — never an emoji; see the app-wide
 * screen-reader rule in pta-my-family.tsx). Decorative by contract: hidden
 * from the accessibility tree, so the row/card it decorates must carry the
 * meaning in its own label. Workspace tones are solid accent + white;
 * status tones use the AA tint pairs.
 */
export function IconBadge({ glyph, tone, size = 40 }: { glyph: string; tone: IconBadgeTone; size?: number }) {
  const scheme = useColorScheme() ?? 'light';
  const palette =
    tone === 'parent' || tone === 'admin'
      ? { background: WORKSPACE_PALETTES[tone].background, text: WORKSPACE_PALETTES[tone].text }
      : StatusColors[tone][scheme];
  return (
    <View
      style={[styles.iconBadge, { width: size, height: size, backgroundColor: palette.background }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <ThemedText style={{ color: palette.text, fontSize: size * 0.45, fontWeight: '700', lineHeight: size * 0.55 }}>
        {glyph}
      </ThemedText>
    </View>
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
  hero: {
    borderRadius: Radii.lg,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  iconBadge: {
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
  },
});
