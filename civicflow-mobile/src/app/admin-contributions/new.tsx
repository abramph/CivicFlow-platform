import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  createAdminContribution,
  getAdminMembers,
  type AdminMemberListRow,
  type DuesPaymentMethodValue,
} from '@/lib/mobile-api';

const PAYMENT_METHODS: DuesPaymentMethodValue[] = ['CASH', 'CHECK', 'CREDIT_CARD', 'ACH', 'ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'OTHER'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mobile Admin program (PR D) — record a contribution. Uses the exact same
 * createContribution() service the web /contributions page uses (via
 * POST /api/mobile/admin/contributions), source is always MANUAL since this
 * is an officer recording a contribution directly, never a member self-service
 * flow. Member attribution is optional (matches the web form) — a contribution
 * can be recorded against a contributor name with no OrgMember record.
 */
export default function AdminContributionCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<AdminMemberListRow[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [selectedMember, setSelectedMember] = useState<AdminMemberListRow | null>(null);
  const [contributorName, setContributorName] = useState('');
  const [amount, setAmount] = useState('');
  const [contributionDate, setContributionDate] = useState(todayIsoDate());
  const [paymentMethod, setPaymentMethod] = useState<DuesPaymentMethodValue>('CASH');
  const [receiptRequested, setReceiptRequested] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchMembers(query: string) {
    setMemberSearch(query);
    if (!selectedOrganizationId || query.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    setSearchingMembers(true);
    try {
      const result = await getAdminMembers(selectedOrganizationId, { search: query.trim(), page: 1 });
      setMemberResults(result.members.slice(0, 8));
    } catch {
      setMemberResults([]);
    } finally {
      setSearchingMembers(false);
    }
  }

  function validate(): string | null {
    const amountValue = Number(amount);
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) return 'Enter a valid amount.';
    if (!selectedMember && !contributorName.trim()) return 'Select a member or enter a contributor name.';
    return null;
  }

  async function handleSubmit() {
    if (!selectedOrganizationId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createAdminContribution({
        organizationId: selectedOrganizationId,
        memberId: selectedMember?.id ?? null,
        contributorName: selectedMember ? null : contributorName.trim(),
        amount: Number(amount),
        contributionDate: new Date(contributionDate).toISOString(),
        paymentMethod,
        source: 'MANUAL',
        receiptRequested,
        notes: notes.trim() || null,
      });
      router.replace(`/admin-contributions/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record this contribution. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Contribution</ThemedText>

        {selectedMember ? (
          <ThemedView type="backgroundElement" style={styles.selectedMemberCard}>
            <ThemedText type="smallBold">{selectedMember.firstName} {selectedMember.lastName}</ThemedText>
            <Pressable
              onPress={() => {
                setSelectedMember(null);
                setMemberSearch('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Change member"
            >
              <ThemedText type="link">Change</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">Member (optional)</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Search by name or email"
              value={memberSearch}
              onChangeText={searchMembers}
              accessibilityLabel="Search members"
            />
            {searchingMembers ? <ActivityIndicator /> : null}
            {memberResults.map((member) => (
              <Pressable
                key={member.id}
                onPress={() => {
                  setSelectedMember(member);
                  setMemberResults([]);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${member.firstName} ${member.lastName}`}
              >
                <ThemedView type="backgroundElement" style={styles.memberResultCard}>
                  <ThemedText type="small">{member.firstName} {member.lastName}</ThemedText>
                </ThemedView>
              </Pressable>
            ))}

            <ThemedText type="small" themeColor="textSecondary">Or contributor name</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g. Jane Smith"
              value={contributorName}
              onChangeText={setContributorName}
              accessibilityLabel="Contributor name"
            />
          </>
        )}

        <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
        <TextInput style={styles.input} placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} accessibilityLabel="Amount" />

        <ThemedText type="small" themeColor="textSecondary">Date (YYYY-MM-DD)</ThemedText>
        <TextInput style={styles.input} value={contributionDate} onChangeText={setContributionDate} accessibilityLabel="Contribution date, format YYYY-MM-DD" />

        <ThemedText type="small" themeColor="textSecondary">Payment Method</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {PAYMENT_METHODS.map((method) => (
            <Pressable
              key={method}
              style={[styles.chip, method === paymentMethod && styles.chipSelected]}
              onPress={() => setPaymentMethod(method)}
              accessibilityRole="radio"
              accessibilityLabel={method.replace('_', ' ')}
              accessibilityState={{ selected: method === paymentMethod }}
            >
              <ThemedText type="small" style={method === paymentMethod ? styles.chipTextSelected : undefined}>
                {method.replace('_', ' ')}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setReceiptRequested((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityLabel="Send receipt"
          accessibilityState={{ checked: receiptRequested }}
        >
          <ThemedView style={[styles.checkbox, receiptRequested && styles.checkboxChecked]} />
          <ThemedText type="small">Send a receipt</ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary">Notes (optional)</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline accessibilityLabel="Notes, optional" />

        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Record contribution"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Record Contribution</ThemedText>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  selectedMemberCard: {
    borderRadius: 10,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  memberResultCard: {
    borderRadius: 10,
    padding: Spacing.two,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  chipTextSelected: {
    color: '#fff',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    backgroundColor: 'transparent',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  checkboxChecked: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  error: {
    color: '#B42318',
    marginBottom: Spacing.two,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
