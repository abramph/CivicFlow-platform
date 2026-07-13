import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Redirect, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { checkInWithQrToken, type AttendanceCheckInResult } from '@/lib/mobile-api';

/** The scanned QR encodes the full web check-in URL — only the token query
 * param is meaningful to us; everything else about the URL is ignored. */
function extractToken(scannedValue: string): string | null {
  try {
    const url = new URL(scannedValue);
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

type ScreenState = { kind: 'scanning' } | { kind: 'processing' } | { kind: 'success'; result: AttendanceCheckInResult } | { kind: 'error'; message: string };

export default function AttendanceScanScreen() {
  const { status } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScreenState>({ kind: 'scanning' });
  const processingRef = useRef(false);

  const handleScan = useCallback(async (result: BarcodeScanningResult) => {
    // A CameraView fires onBarcodeScanned repeatedly for the same code while
    // it's in frame — this is the guard against sending many requests for
    // one scan, and against starting a second request while one's in flight.
    if (processingRef.current) return;
    const token = extractToken(result.data);
    if (!token) {
      processingRef.current = true;
      setState({ kind: 'error', message: "That code isn't a Unestra attendance code." });
      return;
    }

    processingRef.current = true;
    setState({ kind: 'processing' });
    try {
      const outcome = await checkInWithQrToken(token);
      setState({ kind: 'success', result: outcome });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Unable to connect. Check your connection and try again.',
      });
    }
  }, []);

  function retry() {
    processingRef.current = false;
    setState({ kind: 'scanning' });
  }

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/attendance-scan' } }} />;
  }

  if (!permission) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="title" style={styles.title}>Camera Access Needed</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.explainer}>
          Unestra uses your camera to scan the meeting QR code so you can check in to attendance. Nothing is recorded
          or stored from your camera — it&apos;s only used to read the code.
        </ThemedText>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <ThemedText style={styles.primaryButtonText}>
            {permission.canAskAgain ? 'Grant Camera Access' : 'Open Settings to Grant Access'}
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (state.kind === 'success') {
    const { result } = state;
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.successIcon}>✓</ThemedText>
        <ThemedText type="title" style={styles.title}>
          {result.alreadyCheckedIn ? "You're Already Checked In" : "You're Checked In"}
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.summaryCard}>
          <ThemedText type="smallBold">{result.meetingTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{new Date(result.meetingDate).toLocaleString()}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Checked in at {new Date(result.checkInTime).toLocaleTimeString()}
          </ThemedText>
          <ThemedText type="smallBold" style={result.attendanceStatus === 'LATE' ? styles.lateBadge : styles.presentBadge}>
            {result.attendanceStatus === 'LATE' ? 'Marked Late' : 'Present'}
          </ThemedText>
        </ThemedView>
        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/dashboard')}>
          <ThemedText type="link">Back to Dashboard</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (state.kind === 'error') {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorIcon}>✕</ThemedText>
        <ThemedText type="title" style={styles.title}>Check-In Didn&apos;t Go Through</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.explainer}>{state.message}</ThemedText>
        <Pressable style={styles.primaryButton} onPress={retry}>
          <ThemedText style={styles.primaryButtonText}>Scan Again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <CameraView
        style={styles.flex}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={state.kind === 'scanning' ? handleScan : undefined}
      />
      <ThemedView style={styles.overlay}>
        {state.kind === 'processing' ? (
          <>
            <ActivityIndicator color="#fff" />
            <ThemedText style={styles.overlayText}>Checking in…</ThemedText>
          </>
        ) : (
          <ThemedText style={styles.overlayText}>Point your camera at the meeting QR code</ThemedText>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  explainer: {
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: Spacing.two,
  },
  summaryCard: {
    width: '100%',
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 48,
    color: '#047857',
  },
  errorIcon: {
    fontSize: 48,
    color: '#B42318',
  },
  presentBadge: {
    color: '#047857',
  },
  lateBadge: {
    color: '#B45309',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  overlayText: {
    color: '#fff',
  },
});
