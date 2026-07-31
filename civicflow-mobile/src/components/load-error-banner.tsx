import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * apiFetch() throws on any network or HTTP failure, but until now no screen
 * caught it — a real connectivity drop produced an unhandled promise
 * rejection and left the screen silently stuck on stale/empty state forever,
 * with no indication anything went wrong and no way to retry. Screens that
 * catch their load() failure and set an error message render this instead.
 */
export function LoadErrorBanner({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  if (!message) return null;

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <ThemedText type="small">{message}</ThemedText>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading">
        <ThemedText type="linkPrimary">Retry</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
