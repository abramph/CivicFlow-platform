import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  generateAdminDuesForMember,
  getAdminMember,
  getAdminMemberDues,
  reinstateAdminMember,
  terminateAdminMember,
  type AdminMemberDetail,
  type AdminMemberDues,
} from '@/lib/mobile-api';

const TERMINATION_REASONS: { value: string; label: string }[] = [
  { value: 'MOVED_RELOCATED', label: 'Moved / relocated' },
  { value: 'RESIGNED_VOLUNTARY', label: 'Resigned voluntarily' },
  { value: 'NONPAYMENT_OF_DUES', label: 'Non-payment of dues' },
  { value: 'GOVERNING_DOCUMENT_VIOLATION', label: 'Violation of governing documents / bylaws' },
  { value: 'DECEASED', label: 'Deceased' },
  { value: 'NO_LONGER_ELIGIBLE', label: 'No longer eligible for membership' },
  { value: 'OTHER', label: 'Other' },
];

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mobile Admin program (PR B) — member detail. Re-fetches by (memberId,
 * organizationId) on every mount rather than trusting anything passed
 * through navigation params — a member object handed through router.push
 * is never treated as authorization, per the same rule the rest of this
 * app follows. Terminate/Reinstate are the only status actions PR B
 * exposes — see the doc comment on the server's terminate route for why.
 */
export default function AdminMemberDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageMembers = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageMembers'));
  const hasManagePayments = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePayments'));
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const [member, setMember] = useState<AdminMemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [showTerminateForm, setShowTerminateForm] = useState(false);
  const [reasonCode, setReasonCode] = useState<string | null>(null);

  const [dues, setDues] = useState<AdminMemberDues | null>(null);
  const [duesLoadError, setDuesLoadError] = useState<string | null>(null);
  const [generatingCharges, setGeneratingCharges] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !memberId || !hasManageMembers) return;
    try {
      setMember(await getAdminMember(selectedOrganizationId, memberId));
      setLoadError(null);
    } catch (error) {
      setMember(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This member could not be found.' : 'Unable to load this member. Check your connection and try again.');
    }
  }, [selectedOrganizationId, memberId, hasManageMembers]);

  const loadDues = useCallback(async () => {
    if (!selectedOrganizationId || !memberId || !hasManagePayments) return;
    try {
      setDues(await getAdminMemberDues(selectedOrganizationId, memberId));
      setDuesLoadError(null);
    } catch (error) {
      setDues(null);
      setDuesLoadError(
        error instanceof ApiError && error.status === 403
          ? "You don't have dues administration access for this organization."
          : 'Unable to load dues. Check your connection and try again.'
      );
    }
  }, [selectedOrganizationId, memberId, hasManagePayments]);

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

  useEffect(() => {
    (async () => {
      await loadDues();
    })();
  }, [loadDues]);

  async function handleGenerateCharges() {
    if (!selectedOrganizationId || !memberId || generatingCharges) return;
    setGeneratingCharges(true);
    try {
      await generateAdminDuesForMember(selectedOrganizationId, memberId);
      await loadDues();
    } catch (error) {
      Alert.alert('Unable to generate charges', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setGeneratingCharges(false);
    }
  }

  function confirmGenerateCharges() {
    Alert.alert('Generate dues charges?', 'This creates any dues charges this member is currently due for, based on their dues account schedule.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Generate', onPress: handleGenerateCharges },
    ]);
  }

  async function handleTerminate() {
    if (!selectedOrganizationId || !memberId || !reasonCode || actionPending) return;
    setActionPending(true);
    try {
      await terminateAdminMember(memberId, {
        organizationId: selectedOrganizationId,
        reasonCode,
        effectiveDate: todayIsoDate(),
      });
      setShowTerminateForm(false);
      setReasonCode(null);
      await load();
    } catch (error) {
      Alert.alert('Unable to terminate', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmReinstate() {
    Alert.alert('Reinstate member?', 'This restores active membership. It does not automatically restore app login access.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reinstate', onPress: handleReinstate },
    ]);
  }

  async function handleReinstate() {
    if (!selectedOrganizationId || !memberId || actionPending) return;
    setActionPending(true);
    try {
      await reinstateAdminMember(memberId, {
        organizationId: selectedOrganizationId,
        reason: 'Reinstated from mobile',
        effectiveDate: todayIsoDate(),
      });
      await load();
    } catch (error) {
      Alert.alert('Unable to reinstate', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  if (!hasManageMembers) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have member administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading member">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!member) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This member could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">
        {member.preferredName ?? member.firstName} {member.lastName}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {statusLabel(member.membershipStatus)}
        {member.isDelinquent ? ' · Delinquent' : ''}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        {member.email ? <ThemedText type="default">{member.email}</ThemedText> : null}
        {member.phone ? <ThemedText type="default">{member.phone}</ThemedText> : null}
        {member.addressLine1 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {member.addressLine1}
            {member.city ? `, ${member.city}` : ''}
            {member.state ? `, ${member.state}` : ''}
            {member.zipCode ? ` ${member.zipCode}` : ''}
          </ThemedText>
        ) : null}
        {member.householdName ? (
          <ThemedText type="small" themeColor="textSecondary">Household: {member.householdName}</ThemedText>
        ) : null}
        {member.notes ? <ThemedText type="small" themeColor="textSecondary">{member.notes}</ThemedText> : null}
      </ThemedView>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push(`/admin-members/${member.id}/edit`)}
        accessibilityRole="button"
        accessibilityLabel="Edit member"
      >
        <ThemedText type="link">Edit Member</ThemedText>
      </Pressable>

      {hasManagePayments ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Dues</ThemedText>
          <LoadErrorBanner message={duesLoadError} onRetry={loadDues} />

          {dues ? (
            <>
              {dues.charges.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No dues charges on file.</ThemedText>
              ) : (
                dues.charges.map((charge) => (
                  <ThemedView key={charge.id} type="backgroundElement" style={styles.duesChargeCard}>
                    <ThemedText type="small">
                      ${Number(charge.amountDue).toFixed(2)} due {new Date(charge.dueDate).toLocaleDateString()}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {charge.status} · ${Number(charge.amountPaid).toFixed(2)} paid
                    </ThemedText>
                  </ThemedView>
                ))
              )}

              <ThemedView style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => router.push(`/admin-members/${member.id}/record-payment`)}
                  accessibilityRole="button"
                  accessibilityLabel="Record payment"
                >
                  <ThemedText type="link">Record Payment</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => router.push(`/admin-members/${member.id}/add-adjustment`)}
                  accessibilityRole="button"
                  accessibilityLabel="Add adjustment"
                >
                  <ThemedText type="link">Add Adjustment</ThemedText>
                </Pressable>
              </ThemedView>
              <Pressable
                style={[styles.secondaryButton, generatingCharges && styles.buttonDisabled]}
                onPress={confirmGenerateCharges}
                disabled={generatingCharges}
                accessibilityRole="button"
                accessibilityLabel="Generate dues charges"
                accessibilityState={{ disabled: generatingCharges, busy: generatingCharges }}
              >
                <ThemedText type="link">{generatingCharges ? 'Generating…' : 'Generate Charges'}</ThemedText>
              </Pressable>
            </>
          ) : null}
        </ThemedView>
      ) : null}

      {member.membershipStatus === 'terminated' ? (
        <Pressable
          style={[styles.button, styles.buttonAmber, actionPending && styles.buttonDisabled]}
          onPress={confirmReinstate}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Reinstate member"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.buttonPrimaryText}>{actionPending ? 'Reinstating…' : 'Reinstate'}</ThemedText>
        </Pressable>
      ) : !showTerminateForm ? (
        <Pressable
          style={styles.secondaryButtonDanger}
          onPress={() => setShowTerminateForm(true)}
          accessibilityRole="button"
          accessibilityLabel="Terminate member"
        >
          <ThemedText style={styles.dangerText}>Terminate Membership</ThemedText>
        </Pressable>
      ) : (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Terminate membership</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Historical dues, contributions, and activity records are preserved. Choose a reason:
          </ThemedText>
          <ThemedView style={styles.reasonList} accessibilityRole="radiogroup" accessibilityLabel="Termination reason">
            {TERMINATION_REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                style={[styles.reasonChip, reasonCode === reason.value && styles.reasonChipSelected]}
                onPress={() => setReasonCode(reason.value)}
                accessibilityRole="radio"
                accessibilityLabel={reason.label}
                accessibilityState={{ selected: reasonCode === reason.value }}
              >
                <ThemedText type="small" style={reasonCode === reason.value ? styles.reasonChipTextSelected : undefined}>
                  {reason.label}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          <ThemedView style={styles.actionRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setShowTerminateForm(false);
                setReasonCode(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel termination"
            >
              <ThemedText type="link">Cancel</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonDanger, (!reasonCode || actionPending) && styles.buttonDisabled]}
              onPress={handleTerminate}
              disabled={!reasonCode || actionPending}
              accessibilityRole="button"
              accessibilityLabel="Confirm termination"
              accessibilityState={{ disabled: !reasonCode || actionPending, busy: actionPending }}
            >
              <ThemedText style={styles.buttonPrimaryText}>{actionPending ? 'Terminating…' : 'Confirm Terminate'}</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
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
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 6,
  },
  section: {
    gap: Spacing.two,
  },
  duesChargeCard: {
    borderRadius: 10,
    padding: Spacing.two,
    gap: 2,
  },
  button: {
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonAmber: {
    backgroundColor: '#B54708',
  },
  buttonDanger: {
    backgroundColor: '#B42318',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
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
  reasonList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  reasonChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  reasonChipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  reasonChipTextSelected: {
    color: '#fff',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
});
