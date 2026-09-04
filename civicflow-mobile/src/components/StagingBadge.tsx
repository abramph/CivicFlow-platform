// STAGING-PREVIEW ONLY — exists ONLY on test/build26-staging-preview.
// NEVER merge this to main.
//
// A persistent but unobtrusive marker so an internal preview build can never
// be mistaken for the production app during device testing. Renders nothing
// at all unless the build was produced with APP_VARIANT=preview, so it is
// inert if this file ever reaches a normal build.
import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';

export function StagingBadge() {
  const extra = Constants.expoConfig?.extra as { isStagingPreview?: boolean } | undefined;
  if (!extra?.isStagingPreview) return null;

  return (
    <View style={styles.wrap} pointerEvents="none" accessible accessibilityRole="text"
          accessibilityLabel="Staging preview build. Not production data.">
      <Text style={styles.text}>STAGING</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#B45309',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderBottomLeftRadius: 6,
    opacity: 0.9,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
