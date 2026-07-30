// React 19's test-renderer needs this flag to recognize the test
// environment as concurrent-act-aware; without it every state update that
// happens after an awaited promise inside an event handler logs a spurious
// "not configured to support act(...)" warning even though the test passes.
global.IS_REACT_ACT_ENVIRONMENT = true;
