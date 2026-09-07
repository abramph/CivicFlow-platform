/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Semantic action colors — unlike `Colors` above, these don't branch by
 * light/dark mode (every screen that uses them today uses the identical
 * value in both modes already). Introduced because the same handful of
 * hex values were independently hardcoded across 40+ screens with no
 * shared source of truth — including two slightly different ambers
 * (#B54708 in five places, #B45309 as a one-off drift in
 * attendance-scan.tsx) that were clearly meant to be the same color.
 * Adoption is deliberately incremental — see mobile-ui-tokens.md.
 */
export const ActionColors = {
  primary: '#047857',
  primaryText: '#fff',
  danger: '#B42318',
  warning: '#B54708',
  border: '#D0D5DD',
} as const;

/**
 * Build 27 semantic design system. Everything below extends — never
 * replaces — the tokens above, and every color pair keeps WCAG-AA contrast
 * for its documented use (text tone on tint background, or white on solid).
 *
 * Two workspace accents give Parent and Admin surfaces a recognizably
 * different temperature while staying one product: the parent/member
 * experience keeps the Unestra green as its accent; administrative
 * surfaces use a deep slate. Status tones are the app-wide vocabulary for
 * pending/approved/rejected/needs-correction/completed chips — screens
 * must never invent a new hex for a state these already name.
 */
export const Brand = {
  /** The Unestra green — same value as ActionColors.primary. */
  primary: '#047857',
  primaryDark: '#065F46',
  /** Tint suitable as a light-mode surface behind primary-toned text. */
  primaryTintLight: '#ECFDF5',
  /** Tint suitable as a dark-mode surface behind primary-toned text. */
  primaryTintDark: '#123B2E',
  onPrimary: '#FFFFFF',
} as const;

export const WorkspaceColors = {
  /** Parent/member surfaces — warm, welcoming. */
  parentAccent: '#047857',
  parentHeaderText: '#FFFFFF',
  parentHeaderSubtext: '#D1FAE5',
  /** Admin surfaces — operational slate. */
  adminAccent: '#1D2939',
  adminHeaderText: '#FFFFFF',
  adminHeaderSubtext: '#D0D5DD',
} as const;

export type StatusTone = 'pending' | 'approved' | 'rejected' | 'needsCorrection' | 'completed' | 'info' | 'neutral';

/** Chip/badge palette per status tone: solid text color on a soft tint,
 * with a separate pair per scheme so both modes keep AA contrast. */
export const StatusColors: Record<StatusTone, { light: { text: string; background: string }; dark: { text: string; background: string } }> = {
  pending: {
    light: { text: '#92400E', background: '#FEF3C7' },
    dark: { text: '#FDE68A', background: '#452C03' },
  },
  approved: {
    light: { text: '#065F46', background: '#D1FAE5' },
    dark: { text: '#6EE7B7', background: '#123B2E' },
  },
  rejected: {
    light: { text: '#991B1B', background: '#FEE2E2' },
    dark: { text: '#FCA5A5', background: '#450A0A' },
  },
  needsCorrection: {
    light: { text: '#9A3412', background: '#FFEDD5' },
    dark: { text: '#FDBA74', background: '#431407' },
  },
  completed: {
    light: { text: '#1E40AF', background: '#DBEAFE' },
    dark: { text: '#93C5FD', background: '#172554' },
  },
  info: {
    light: { text: '#1E40AF', background: '#DBEAFE' },
    dark: { text: '#93C5FD', background: '#172554' },
  },
  neutral: {
    light: { text: '#374151', background: '#F3F4F6' },
    dark: { text: '#D1D5DB', background: '#1F2937' },
  },
} as const;

/** Corner radii — the values already used ad hoc across the app, named. */
export const Radii = {
  sm: 10,
  md: 12,
  lg: 14,
  pill: 999,
} as const;

/** Subtle elevation for layered cards — restrained on purpose (no heavy
 * drop shadows), and a no-op-ish elevation on Android to avoid harsh
 * banding on dark surfaces. */
export const Elevation = {
  card: Platform.select({
    ios: { shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
    android: { elevation: 2 },
    default: {},
  }) as object,
} as const;

/** Minimum touch target — Apple HIG/Android accessibility floor. */
export const MinTouchTarget = 44;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
