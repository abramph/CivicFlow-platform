import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getAdminContribution,
  updateAdminContribution,
  type AdminContributionDetail,
  type DuesPaymentMethodValue,
} from '@/lib/mobile-api';

const PAYMENT_METHODS: DuesPaymentMethodValue[] = ['CASH', 'CHECK', 'CREDIT_CARD', 'ACH', 'ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'OTHER'];

/**
 * Mobile Admin program (PR D) — edit a contribution. Uses the exact same
 * updateContribution() service the web edit form uses. Requires an edit
 * reason, matching the web form's audit convention for corrections to
 * already-recorded financial records.
 */
export default function AdminContributionEditScreen() {
  const { selectedOrganizationId } = useAuth();
  const { contributionId } = useLocalSearchParams<{ contributionId: string }>();

  const [contribution, setContribution] = useState<AdminContributionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [contributionDate, setContributionDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<DuesPaymentMethodValue | null>(null);
  const [notes, setNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !contributionId) return;
    try {
      const detail = await getAdminContribution(selectedOrganizationId, contributionId);
      setContribution(detail);
      setAmount(detail.amount);
      setContributionDate(detail.contributionDate.slice(0, 10));
      setPaymentMethod(detail.paymentMethod);
      setNotes(detail.notes ?? '');
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? 'This contribution could not be found.' : 'Unable to load this contribution. Check your connection and try again.');
    }
  }, [selectedOrganizationId, contributionId]);

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

  function validate(): string | null {
    const amountValue = Number(amount);
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) return 'Enter a valid amount.';
    if (!editReason.trim()) return 'An edit reason is required.';
    return null;
  }

  async function handleSubmit() {
    if (!selectedOrganizationId || !contributionId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateAdminContribution(contributionId, {
        organizationId: selectedOrganizationId,
        amount: Number(amount),
        contributionDate: new Date(contributionDate).toISOString(),
        paymentMethod,
        notes: notes.trim() || null,
        editReason: editReason.trim(),
      });
      router.replace(`/admin-contributions/${contributionId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save these changes. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading contribution">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!contribution) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This contribution could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Edit Contribution</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
        <TextInput style={styles.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} accessibilityLabel="Amount" />

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

        <ThemedText type="small" themeColor="textSecondary">Notes (optional)</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline accessibilityLabel="Notes, optional" />

        <ThemedText type="small" themeColor="textSecondary">Reason for this edit (required)</ThemedText>
        <TextInput style={styles.input} value={editReason} onChangeText={setEditReason} accessibilityLabel="Reason for this edit" />

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
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Changes</ThemedText>}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
