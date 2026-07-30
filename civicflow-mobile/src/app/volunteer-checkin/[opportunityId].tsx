import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  checkInPtaVolunteer,
  checkOutPtaVolunteer,
  getPtaVolunteerRoster,
  setPtaVolunteerAttendance,
  type PtaVolunteerRoster,
  type PtaVolunteerRosterSignup,
} from '@/lib/mobile-api';

/**
 * The actual event-day operational screen — large touch targets, one action
 * per tap, every action disabled while its own request is in flight so a
 * shaky connection can't turn a double-tap into a double check-in. Every
 * write is idempotent and server-timestamped (see
 * docs/pta-volunteer-management.md) — this screen never invents a local
 * timestamp.
 */
export default function VolunteerCheckinRosterScreen() {
  const { selectedOrganizationId } = useAuth();
  const { opportunityId } = useLocalSearchParams<{ opportunityId: string }>();
  const [roster, setRoster] = useState<PtaVolunteerRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingSignupId, setPendingSignupId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !opportunityId) return;
    setRoster(await getPtaVolunteerRoster(selectedOrganizationId, opportunityId));
  }, [selectedOrganizationId, opportunityId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  async function runAction(signupId: string, action: () => Promise<unknown>) {
    if (!selectedOrganizationId || pendingSignupId) return;
    setPendingSignupId(signupId);
    try {
      await action();
      await load();
    } catch (error) {
      Alert.alert('Action failed', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setPendingSignupId(null);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading roster">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!roster) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Roster</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          This opportunity isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }

  function renderSignup(signup: PtaVolunteerRosterSignup) {
    const isPending = pendingSignupId === signup.signupId;
    return (
      <ThemedView key={signup.signupId} type="backgroundElement" style={styles.signupCard}>
        <ThemedText type="smallBold">{signup.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {signup.attendanceStatus ?? signup.status.replace('_', ' ')}
          {signup.manuallyAssigned ? ' · assigned by officer' : ''}
        </ThemedText>

        <ThemedView style={styles.actionRow}>
          {!signup.checkInAt ? (
            <Pressable
              disabled={isPending}
              onPress={() => runAction(signup.signupId, () => checkInPtaVolunteer(selectedOrganizationId!, signup.signupId))}
              style={[styles.button, styles.buttonPrimary, isPending && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={`Check in ${signup.name}`}
              accessibilityState={{ disabled: isPending, busy: isPending }}
            >
              <ThemedText style={styles.buttonPrimaryText}>{isPending ? '…' : 'Check in'}</ThemedText>
            </Pressable>
          ) : !signup.checkOutAt ? (
            <Pressable
              disabled={isPending}
              onPress={() => runAction(signup.signupId, () => checkOutPtaVolunteer(selectedOrganizationId!, signup.signupId))}
              style={[styles.button, styles.buttonAmber, isPending && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={`Check out ${signup.name}`}
              accessibilityState={{ disabled: isPending, busy: isPending }}
            >
              <ThemedText style={styles.buttonPrimaryText}>{isPending ? '…' : 'Check out'}</ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">Checked out</ThemedText>
          )}

          {!signup.attendanceStatus ? (
            <>
              <Pressable
                disabled={isPending}
                onPress={() => runAction(signup.signupId, () => setPtaVolunteerAttendance(selectedOrganizationId!, signup.signupId, 'ATTENDED'))}
                style={[styles.button, styles.buttonOutline, isPending && styles.buttonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${signup.name} attended`}
                accessibilityState={{ disabled: isPending, busy: isPending }}
              >
                <ThemedText style={styles.buttonOutlineText}>Attended</ThemedText>
              </Pressable>
              <Pressable
                disabled={isPending}
                onPress={() => runAction(signup.signupId, () => setPtaVolunteerAttendance(selectedOrganizationId!, signup.signupId, 'NO_SHOW'))}
                style={[styles.button, styles.buttonOutlineDanger, isPending && styles.buttonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${signup.name} no-show`}
                accessibilityState={{ disabled: isPending, busy: isPending }}
              >
                <ThemedText style={styles.buttonOutlineDangerText}>No-show</ThemedText>
              </Pressable>
              <Pressable
                disabled={isPending}
                onPress={() => runAction(signup.signupId, () => setPtaVolunteerAttendance(selectedOrganizationId!, signup.signupId, 'EXCUSED'))}
                style={[styles.button, styles.buttonOutline, isPending && styles.buttonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${signup.name} excused`}
                accessibilityState={{ disabled: isPending, busy: isPending }}
              >
                <ThemedText style={styles.buttonOutlineText}>Excused</ThemedText>
              </Pressable>
            </>
          ) : null}
        </ThemedView>

        {signup.pendingHourEntry ? (
          <ThemedText type="small" themeColor="textSecondary">
            {(signup.pendingHourEntry.creditedMinutes / 60).toFixed(1)} hours proposed, awaiting approval
          </ThemedText>
        ) : null}
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{roster.title}</ThemedText>
      {roster.slots.map((slot) => (
        <ThemedView key={slot.id} style={styles.slotSection}>
          <ThemedText type="smallBold">
            {slot.label ?? 'Shift'} · {slot.claimedCount}/{slot.capacity}
          </ThemedText>
          {slot.signups.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No one signed up.</ThemedText>
          ) : (
            slot.signups.map(renderSignup)
          )}
        </ThemedView>
      ))}
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
  },
  slotSection: {
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  signupCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 6,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  button: {
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    minHeight: 44, // Apple HIG / Material minimum touch target — this screen is used one-handed at events.
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#047857',
  },
  buttonAmber: {
    backgroundColor: '#B54708',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  buttonOutlineText: {
    fontWeight: '600',
  },
  buttonOutlineDanger: {
    borderWidth: 1,
    borderColor: '#B42318',
  },
  buttonOutlineDangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
