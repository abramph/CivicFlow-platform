import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getPtaDues, reportPtaDuesPayment, type PtaDuesSummary } from '@/lib/mobile-api';

const PAYMENT_METHODS = ['CASH', 'CHECK', 'ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'CARD', 'OTHER'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dues-only "I already paid" report for a pure PTA parent — the household
 * has no OrgMember, so the generic /report-payment (multi-category, receipt
 * upload) screen isn't reachable for this identity; this mirrors it scoped
 * to the household's own current dues charge, via reportPtaDuesPayment().
 */
export default function PtaReportPaymentScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const [summary, setSummary] = useState<PtaDuesSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [referenceNumber, setReferenceNumber] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const data = await getPtaDues(selectedOrganizationId);
    setSummary(data);
  }, [selectedOrganizationId]);

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

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-report-payment' } }} />;
  }
  if (status === 'signedIn' && !selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  async function handleSubmit() {
    if (!selectedOrganizationId) return;
    setError(null);
    const amountValue = Number(amount);
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }

    setSubmitting(true);
    try {
      await reportPtaDuesPayment({
        organizationId: selectedOrganizationId,
        duesChargeId: summary?.currentCharge?.id ?? null,
        amountCents: Math.round(amountValue * 100),
        paymentMethod,
        paymentDate: new Date(paymentDate).toISOString(),
        referenceNumber: referenceNumber || undefined,
        note: note || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit your payment report.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (success) {
    return (
      <ThemedView style={styles.successContainer} accessibilityLiveRegion="polite">
        <ThemedText type="title" style={styles.center}>Payment Reported</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          Your PTA&apos;s treasurer will review this and confirm it soon.
        </ThemedText>
        <Pressable style={styles.button} onPress={() => router.replace('/dues')} accessibilityRole="button" accessibilityLabel="Back to dues">
          <ThemedText style={styles.buttonText}>Back to Dues</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Report a Payment</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {selectedOrganization?.organizationName ?? 'Your PTA'} membership dues
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          accessibilityLabel="Amount"
        />

        <ThemedText type="small" themeColor="textSecondary">Payment Method</ThemedText>
        <ThemedView style={styles.methodRow} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {PAYMENT_METHODS.map((method) => (
            <Pressable
              key={method}
              style={[styles.methodChip, method === paymentMethod && styles.methodChipSelected]}
              onPress={() => setPaymentMethod(method)}
              accessibilityRole="radio"
              accessibilityLabel={method.replace('_', ' ')}
              accessibilityState={{ selected: method === paymentMethod }}
            >
              <ThemedText type="small" style={method === paymentMethod ? styles.methodChipTextSelected : undefined}>
                {method.replace('_', ' ')}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Payment Date (YYYY-MM-DD)</ThemedText>
        <TextInput
          style={styles.input}
          value={paymentDate}
          onChangeText={setPaymentDate}
          placeholder={todayIsoDate()}
          accessibilityLabel="Payment date, format YYYY-MM-DD"
        />

        <ThemedText type="small" themeColor="textSecondary">Reference Number (optional)</ThemedText>
        <TextInput
          style={styles.input}
          value={referenceNumber}
          onChangeText={setReferenceNumber}
          placeholder="Check #, confirmation code, etc."
          accessibilityLabel="Reference number, optional"
        />

        <ThemedText type="small" themeColor="textSecondary">Note (optional)</ThemedText>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={note}
          onChangeText={setNote}
          placeholder="Anything the treasurer should know"
          multiline
          accessibilityLabel="Note, optional"
        />

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
          accessibilityLabel="Submit payment report"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Submit Payment Report</ThemedText>}
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
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  methodChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  methodChipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  methodChipTextSelected: {
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
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  center: {
    textAlign: 'center',
  },
});
