import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  closeAdminAttendanceSession,
  createAdminEventAttendanceSession,
  getAdminAttendanceSessionQr,
  getAdminAttendanceSessionSummary,
  getAdminEventAttendanceSession,
  openAdminAttendanceSession,
  regenerateAdminAttendanceSession,
  type AdminAttendanceQr,
  type AdminAttendanceSession,
  type AdminAttendanceSummary,
} from '@/lib/mobile-api';

const SUMMARY_POLL_MS = 5000;

/**
 * Mobile Admin program (PR C) — QR check-in session control, mirroring the
 * web AttendanceSessionManager's lifecycle exactly: create (DRAFT) -> open
 * (mints a live QR) -> optionally regenerate -> close. Reopen is
 * deliberately not exposed on mobile -- the web route requires ORG_ADMIN
 * specifically, a materially higher bar than manageAttendance alone, and
 * this officer-facing screen isn't the right place to add that rank check.
 */
export default function AdminEventAttendanceSessionScreen() {
  const { selectedOrganizationId } = useAuth();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [session, setSession] = useState<AdminAttendanceSession | null>(null);
  const [qr, setQr] = useState<AdminAttendanceQr | null>(null);
  const [summary, setSummary] = useState<AdminAttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSession = useCallback(async () => {
    if (!selectedOrganizationId || !eventId) return;
    try {
      setSession(await getAdminEventAttendanceSession(selectedOrganizationId, eventId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load this session. Check your connection and try again.');
    }
  }, [selectedOrganizationId, eventId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadSession();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSession]);

  const refreshQrAndSummary = useCallback(async () => {
    if (!selectedOrganizationId || !session || session.status !== 'OPEN') return;
    try {
      const [nextQr, nextSummary] = await Promise.all([
        getAdminAttendanceSessionQr(selectedOrganizationId, session.id),
        getAdminAttendanceSessionSummary(selectedOrganizationId, session.id),
      ]);
      setQr(nextQr);
      setSummary(nextSummary);
    } catch {
      // Transient poll failures aren't surfaced as a hard error -- the last
      // successfully displayed QR/summary just stays on screen until the
      // next successful poll.
    }
  }, [selectedOrganizationId, session]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (session?.status !== 'OPEN') {
      setQr(null);
      return;
    }
    refreshQrAndSummary();
    const intervalMs = Math.min(session.rotationSeconds * 1000, SUMMARY_POLL_MS);
    pollRef.current = setInterval(refreshQrAndSummary, intervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.status, session?.id, session?.rotationSeconds, refreshQrAndSummary]);

  async function handleStart() {
    if (!selectedOrganizationId || !eventId || actionPending) return;
    setActionPending(true);
    try {
      setSession(await createAdminEventAttendanceSession(selectedOrganizationId, eventId));
    } catch (error) {
      Alert.alert('Unable to start session', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleOpen() {
    if (!selectedOrganizationId || !session || actionPending) return;
    setActionPending(true);
    try {
      setSession(await openAdminAttendanceSession(selectedOrganizationId, session.id));
    } catch (error) {
      Alert.alert('Unable to open session', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleRegenerate() {
    if (!selectedOrganizationId || !session || actionPending) return;
    setActionPending(true);
    try {
      setSession(await regenerateAdminAttendanceSession(selectedOrganizationId, session.id));
      await refreshQrAndSummary();
    } catch (error) {
      Alert.alert('Unable to regenerate code', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmClose() {
    Alert.alert('Close this session?', 'The QR code will stop working immediately.', [
      { text: 'Keep Open', style: 'cancel' },
      { text: 'Close Session', style: 'destructive', onPress: handleClose },
    ]);
  }

  async function handleClose() {
    if (!selectedOrganizationId || !session || actionPending) return;
    setActionPending(true);
    try {
      setSession(await closeAdminAttendanceSession(selectedOrganizationId, session.id));
    } catch (error) {
      Alert.alert('Unable to close session', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading attendance session">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Check-In / Attendance</ThemedText>

      {loadError ? (
        <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {loadError}
        </ThemedText>
      ) : null}

      {!session ? (
        <Pressable
          style={[styles.button, actionPending && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Start check-in session"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.buttonPrimaryText}>{actionPending ? 'Starting…' : 'Start Check-In Session'}</ThemedText>
        </Pressable>
      ) : session.status === 'DRAFT' ? (
        <Pressable
          style={[styles.button, actionPending && styles.buttonDisabled]}
          onPress={handleOpen}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Open session and display QR code"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.buttonPrimaryText}>{actionPending ? 'Opening…' : 'Open Session — Display QR'}</ThemedText>
        </Pressable>
      ) : session.status === 'OPEN' ? (
        <>
          {qr ? (
            <ThemedView type="backgroundElement" style={styles.qrCard}>
              <Image source={{ uri: qr.qrDataUrl }} style={styles.qrImage} accessibilityLabel="Check-in QR code" />
              {qr.secondsRemainingInSlot !== null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Refreshes in {qr.secondsRemainingInSlot}s
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">Static code — doesn&apos;t rotate</ThemedText>
              )}
            </ThemedView>
          ) : (
            <ThemedView style={styles.loadingContainer}>
              <ActivityIndicator />
            </ThemedView>
          )}

          {summary ? (
            <ThemedView type="backgroundElement" style={styles.summaryCard}>
              <ThemedText type="smallBold">
                {summary.checkedInCount} of {summary.eligibleCount} checked in ({summary.attendancePercent}%)
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Present {summary.counts.PRESENT} · Late {summary.counts.LATE} · Excused {summary.counts.EXCUSED} · Virtual {summary.counts.VIRTUAL}
              </ThemedText>
            </ThemedView>
          ) : null}

          <ThemedView style={styles.actionRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={handleRegenerate}
              disabled={actionPending}
              accessibilityRole="button"
              accessibilityLabel="Regenerate code"
              accessibilityState={{ disabled: actionPending, busy: actionPending }}
            >
              <ThemedText type="link">Regenerate Code</ThemedText>
            </Pressable>
            <Pressable
              style={styles.secondaryButtonDanger}
              onPress={confirmClose}
              disabled={actionPending}
              accessibilityRole="button"
              accessibilityLabel="Close session"
              accessibilityState={{ disabled: actionPending, busy: actionPending }}
            >
              <ThemedText style={styles.dangerText}>Close Session</ThemedText>
            </Pressable>
          </ThemedView>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          This session is closed.
        </ThemedText>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
  },
  error: {
    color: '#B42318',
  },
  qrCard: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  summaryCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonDanger: {
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
