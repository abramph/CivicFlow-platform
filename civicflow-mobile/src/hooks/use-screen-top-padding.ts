import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * The (tabs) screens render their own title as the first thing in a
 * headerShown:false scene (no native header to reserve the status bar/
 * Dynamic Island area), so without this every large title overlaps the
 * clock -- worst on devices with a tall Dynamic Island (e.g. Pro Max).
 * Returns a paddingTop override to replace Spacing.four on those screens'
 * outermost container.
 */
export function useScreenTopPadding() {
  const insets = useSafeAreaInsets();
  return { paddingTop: insets.top + Spacing.four };
}
