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
export function LoadErrorBanner({
  message,
  onRetry,
  /** What the retry actually reloads, e.g. "student progression". Screen
   * readers otherwise announce a bare "Retry loading" with no object, which is
   * ambiguous when more than one thing on screen can fail. */
  retryTarget,
}: {
  message: string | null;
  onRetry: () => void;
  retryTarget?: string;
}) {
  if (!message) return null;

  return (
    // The banner appears after a failed load, so nothing moves focus to it.
    // Announcing it as a live region is what tells a screen-reader user the
    // load failed at all, rather than leaving them on a silently empty screen.
    <ThemedView
      type="backgroundElement"
      style={styles.container}
      testID="load-error-banner"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <ThemedText type="small" style={styles.message}>
        {message}
      </ThemedText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryTarget ? `Retry loading ${retryTarget}` : 'Retry loading'}
        style={styles.retry}
        hitSlop={8}
      >
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
  // Let the message wrap instead of squeezing the retry control off-screen at
  // larger Dynamic Type sizes.
  message: {
    flexShrink: 1,
  },
  // Platform guidance is a ~44pt minimum target; the label alone is shorter.
  retry: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
