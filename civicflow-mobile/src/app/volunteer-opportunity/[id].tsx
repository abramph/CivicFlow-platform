import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  cancelPtaVolunteerSlot,
  claimPtaVolunteerSlot,
  getPtaVolunteerOpportunity,
  type PtaVolunteerOpportunityDetail,
} from '@/lib/mobile-api';

export default function VolunteerOpportunityDetailScreen() {
  const { selectedOrganizationId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [opportunity, setOpportunity] = useState<PtaVolunteerOpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    setOpportunity(await getPtaVolunteerOpportunity(selectedOrganizationId, id));
  }, [selectedOrganizationId, id]);

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

  async function handleClaim(slotId: string) {
    if (!selectedOrganizationId || pendingSlotId) return; // guards double-tap
    setPendingSlotId(slotId);
    try {
      await claimPtaVolunteerSlot(selectedOrganizationId, slotId);
      await load();
    } catch (error) {
      // A shift filled or was closed between load and tap — surfaced
      // honestly rather than silently retried, since the server is the only
      // source of truth for capacity.
      Alert.alert('Unable to sign up', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
    } finally {
      setPendingSlotId(null);
    }
  }

  async function handleCancel(slotId: string) {
    if (!selectedOrganizationId || pendingSlotId) return;
    setPendingSlotId(slotId);
    try {
      await cancelPtaVolunteerSlot(selectedOrganizationId, slotId);
      await load();
    } catch (error) {
      Alert.alert('Unable to cancel', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
    } finally {
      setPendingSlotId(null);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading volunteer opportunity">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!opportunity) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Volunteer opportunity</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          This opportunity isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{opportunity.title}</ThemedText>
      {opportunity.description ? <ThemedText type="default">{opportunity.description}</ThemedText> : null}
      {opportunity.instructions ? (
        <ThemedText type="small" themeColor="textSecondary">Instructions: {opportunity.instructions}</ThemedText>
      ) : null}
      {opportunity.signupDeadline ? (
        <ThemedText type="small" themeColor="textSecondary">
          Sign up by {new Date(opportunity.signupDeadline).toLocaleDateString()}
        </ThemedText>
      ) : null}
      {opportunity.cancellationDeadline ? (
        <ThemedText type="small" themeColor="textSecondary">
          Cancellations accepted until {new Date(opportunity.cancellationDeadline).toLocaleDateString()}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Shifts</ThemedText>
      {opportunity.slots.map((slot) => {
        const isPending = pendingSlotId === slot.id;
        return (
          <ThemedView key={slot.id} type="backgroundElement" style={styles.slotCard}>
            <ThemedText type="smallBold">{slot.label ?? 'Shift'}</ThemedText>
            {slot.startAt ? (
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(slot.startAt).toLocaleString()}
                {slot.endAt ? ` – ${new Date(slot.endAt).toLocaleTimeString()}` : ''}
              </ThemedText>
            ) : null}
            {slot.locationOverride ? <ThemedText type="small" themeColor="textSecondary">{slot.locationOverride}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">
              {slot.claimedCount}/{slot.capacity} filled
            </ThemedText>

            {slot.mySignup && slot.mySignup.status !== 'CANCELLED' ? (
              <Pressable
                disabled={isPending}
                onPress={() => handleCancel(slot.id)}
                style={[styles.button, styles.buttonDanger, isPending && styles.buttonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Cancel signup for ${slot.label ?? 'shift'}`}
                accessibilityState={{ disabled: isPending, busy: isPending }}
              >
                <ThemedText style={styles.buttonDangerText}>{isPending ? 'Cancelling…' : 'Cancel signup'}</ThemedText>
              </Pressable>
            ) : (
              <Pressable
                disabled={isPending || slot.full}
                onPress={() => handleClaim(slot.id)}
                style={[styles.button, slot.full ? styles.buttonDisabled : styles.buttonPrimary]}
                accessibilityRole="button"
                accessibilityLabel={slot.full ? `${slot.label ?? 'Shift'}, full` : `Claim ${slot.label ?? 'shift'}`}
                accessibilityState={{ disabled: isPending || slot.full, busy: isPending }}
              >
                <ThemedText style={styles.buttonPrimaryText}>
                  {isPending ? 'Signing up…' : slot.full ? 'Full' : 'Claim shift'}
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>
        );
      })}
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
  sectionLabel: {
    marginTop: Spacing.two,
  },
  slotCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  button: {
    marginTop: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#047857',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDanger: {
    borderWidth: 1,
    borderColor: '#B42318',
  },
  buttonDangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
