import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * The one shared "you can't be here" state (Build 27). Screens that used to
 * render a fully interactive form to unauthorized deep-link visitors — and
 * let the server's 403 be the only stop — early-return this instead. The
 * server remains the real gate; this exists so an unauthorized visit reads
 * as a deliberate, accessible answer instead of a broken screen.
 */
export function UnauthorizedNotice({ message, title }: { message: string; title?: string }) {
  return (
    <ThemedView style={styles.container}>
      {title ? <ThemedText type="title">{title}</ThemedText> : null}
      <ThemedText
        type="subtitle"
        themeColor="textSecondary"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        {message}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
