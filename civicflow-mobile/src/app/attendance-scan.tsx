import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Redirect, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet } from 'react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '@/components/action-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
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
  const { status, selectedOrganization } = useAuth();
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
  // Direct-route defense: check-in is recorded against an OrgMember identity a
  // staff/owner login may not hold. The organization is derived server-side
  // from the scanned QR, not from the client, so this only avoids a doomed
  // scan — it does not weaken that guard.
  if (status === 'signedIn' && selectedOrganization && !selectedOrganization.memberId) {
    return <Redirect href="/dues" />;
  }

  if (!permission) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!permission.granted) {
    // Apple Guideline 5.1.1(iv) correction: this screen is only ever shown
    // in-context (the user already navigated here specifically to scan a
    // code), and its copy is neutral -- "Continue" only advances to the
    // system's own permission dialog; it does not itself claim to grant,
    // allow, or enable anything. This mirrors pta-family-photo.tsx's
    // priming/blocked pattern (Phase F of the same program). The previous
    // version's "Grant Camera Access" / "Open Settings to Grant Access"
    // wording tried to influence the system decision, and — separately — its
    // "Open Settings" label was misleading: the button's onPress was always
    // requestPermission, which is a no-op once canAskAgain is false, so it
    // never actually opened Settings. Both are corrected here.
    if (!permission.canAskAgain) {
      return (
        <ThemedView style={styles.centered}>
          <ThemedText type="title" style={styles.title}>Camera Access Is Off</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.explainer}>
            Camera access for Unestra is currently off. You can turn it back on in Settings if you want to scan a
            meeting QR code.
          </ThemedText>
          <PrimaryActionButton label="Open Settings" onPress={() => Linking.openSettings()} />
          <SecondaryLinkButton label="Back to Dashboard" onPress={() => router.replace('/dashboard')} />
        </ThemedView>
      );
    }
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="title" style={styles.title}>Use Your Camera</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.explainer}>
          To scan the meeting QR code and check in to attendance, Unestra needs to use your camera. You&apos;ll be
          asked to confirm on the next screen. Nothing is recorded or stored from your camera — it&apos;s only used
          to read the code.
        </ThemedText>
        <PrimaryActionButton label="Continue" onPress={requestPermission} />
        <SecondaryLinkButton label="Not Now" onPress={() => router.replace('/dashboard')} />
      </ThemedView>
    );
  }

  if (state.kind === 'success') {
    const { result } = state;
    return (
      <ThemedView style={styles.centered} accessibilityLiveRegion="assertive">
        <ThemedText style={styles.successIcon} accessibilityElementsHidden importantForAccessibility="no">✓</ThemedText>
        <ThemedText type="title" style={styles.title}>
          {result.alreadyCheckedIn ? "You're Already Checked In" : "You're Checked In"}
        </ThemedText>
        <ThemedView
          type="backgroundElement"
          style={styles.summaryCard}
          accessible
          accessibilityLabel={`${result.meetingTitle}, ${new Date(result.meetingDate).toLocaleString()}, checked in at ${new Date(result.checkInTime).toLocaleTimeString()}, ${result.attendanceStatus === 'LATE' ? 'marked late' : 'present'}`}
        >
          <ThemedText type="smallBold">{result.meetingTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{new Date(result.meetingDate).toLocaleString()}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Checked in at {new Date(result.checkInTime).toLocaleTimeString()}
          </ThemedText>
          <ThemedText type="smallBold" style={result.attendanceStatus === 'LATE' ? styles.lateBadge : styles.presentBadge}>
            {result.attendanceStatus === 'LATE' ? 'Marked Late' : 'Present'}
          </ThemedText>
        </ThemedView>
        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/dashboard')} accessibilityRole="button" accessibilityLabel="Back to dashboard">
          <ThemedText type="link">Back to Dashboard</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (state.kind === 'error') {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorIcon} accessibilityElementsHidden importantForAccessibility="no">✕</ThemedText>
        <ThemedText type="title" style={styles.title} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          Check-In Didn&apos;t Go Through
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.explainer}>{state.message}</ThemedText>
        <Pressable style={styles.primaryButton} onPress={retry} accessibilityRole="button" accessibilityLabel="Scan again">
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
    // Was #B45309, a one-off drift from the shared warning token (#B54708)
    // used everywhere else in the app -- see constants/theme.ts.
    color: ActionColors.warning,
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
