import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet } from 'react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '@/components/action-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconBadge, StatusChip } from '@/components/ui';
import { UnauthorizedNotice } from '@/components/unauthorized-notice';
import { Elevation, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { checkInWithQrToken, type AttendanceCheckInResult } from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

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
  // Apple Guideline 5.1.1(iv) remediation: navigating here IS the user's
  // intentional "Scan QR" tap, so the native iOS permission dialog is
  // requested immediately — there is no custom pre-permission interstitial
  // that could be dismissed without ever reaching the system prompt.
  // `nativePromptSettled` exists for Android, where a denial can leave
  // canAskAgain true; without it the screen would spin forever instead of
  // moving to the denied state.
  const autoRequestedRef = useRef(false);
  const [nativePromptSettled, setNativePromptSettled] = useState(false);

  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain) return;
    if (autoRequestedRef.current) return;
    autoRequestedRef.current = true;
    requestPermission().finally(() => setNativePromptSettled(true));
  }, [permission, requestPermission]);

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
  // Direct-route defense (Build 27): scanning records attendance for a
  // constituent identity — a personal OrgMember, or (for a PTA parent) the
  // household's shared billing member, both resolved server-side. The old
  // gate keyed on `memberId` alone, which hid the scanner from every PTA
  // parent (their memberId is withheld — see org-capabilities.ts). Admin or
  // officer status alone still doesn't qualify: they mint and control
  // sessions instead of scanning themselves in. The organization is derived
  // server-side from the scanned QR, not from the client, so this only
  // avoids a doomed scan — it does not weaken that guard.
  if (status === 'signedIn' && selectedOrganization && !deriveOrgCapabilities(selectedOrganization).canScanAttendance) {
    return <UnauthorizedNotice title="Scan Attendance Code" message="Check-in records attendance for a member or family record, and your login doesn't have one in this organization." />;
  }

  if (!permission) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!permission.granted) {
    // While the automatic native prompt is pending (or about to fire), show
    // only a spinner — the system dialog is the first and only permission UI
    // the user sees. The informational screen below is reserved for a real
    // "no": iOS denied and restricted both surface here as granted:false +
    // canAskAgain:false, and an Android denial that leaves canAskAgain true
    // arrives via nativePromptSettled.
    if (permission.canAskAgain && !nativePromptSettled) {
      return (
        <ThemedView style={styles.centered}>
          <ActivityIndicator />
        </ThemedView>
      );
    }
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

  if (state.kind === 'success') {
    const { result } = state;
    return (
      <ThemedView style={styles.centered} accessibilityLiveRegion="assertive">
        <IconBadge glyph="✓" tone="approved" size={72} />
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
          <StatusChip
            tone={result.attendanceStatus === 'LATE' ? 'pending' : 'approved'}
            label={result.attendanceStatus === 'LATE' ? 'Marked Late' : 'Present'}
          />
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
        <IconBadge glyph="✕" tone="rejected" size={72} />
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
    ...(Elevation.card as object),
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
