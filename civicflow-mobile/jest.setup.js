// React 19's test-renderer needs this flag to recognize the test
// environment as concurrent-act-aware; without it every state update that
// happens after an awaited promise inside an event handler logs a spurious
// "not configured to support act(...)" warning even though the test passes.
global.IS_REACT_ACT_ENVIRONMENT = true;

// (tabs) screens call useSafeAreaInsets() directly (see useScreenTopPadding)
// without a <SafeAreaProvider> ancestor in these unit tests, which the real
// hook throws on. This is the library's own documented jest mock -- spread
// at the top level (rather than left under `.default`) so both `import
// safeArea from '...'` and `import { useSafeAreaInsets } from '...'` resolve.
jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  ...require('react-native-safe-area-context/jest/mock').default,
}));
