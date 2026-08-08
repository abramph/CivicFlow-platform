import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getAdminMemberDues,
  recordAdminDuesPayment,
  type AdminDuesCharge,
  type DuesPaymentMethodValue,
} from '@/lib/mobile-api';

const PAYMENT_METHODS: DuesPaymentMethodValue[] = ['CASH', 'CHECK', 'CREDIT_CARD', 'ACH', 'ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'OTHER'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mobile Admin program (PR D) — record a dues payment for one member. Uses
 * the exact same resolveAndRecordDuesPayment() service the web /dues/payments
 * form uses (member/charge/account resolution, allocation rules, the
 * compare-and-swap-safe recordDuesPayment underneath). A charge selection is
 * optional, matching the web form's "unallocated payment" support.
 */
export default function AdminMemberRecordPaymentScreen() {
  const { selectedOrganizationId } = useAuth();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const [charges, setCharges] = useState<AdminDuesCharge[]>([]);
  const [duesChargeId, setDuesChargeId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [method, setMethod] = useState<DuesPaymentMethodValue>('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCharges = useCallback(async () => {
    if (!selectedOrganizationId || !memberId) return;
    try {
      const detail = await getAdminMemberDues(selectedOrganizationId, memberId);
      setCharges(detail.charges.filter((c) => c.status !== 'PAID' && c.status !== 'VOID'));
    } catch {
      setCharges([]);
    }
  }, [selectedOrganizationId, memberId]);

  useEffect(() => {
    (async () => {
      await loadCharges();
    })();
  }, [loadCharges]);

  function validate(): string | null {
    const amountValue = Number(amount);
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) return 'Enter a valid amount.';
    return null;
  }

  async function handleSubmit() {
    if (!selectedOrganizationId || !memberId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await recordAdminDuesPayment({
        organizationId: selectedOrganizationId,
        memberId,
        duesChargeId,
        amount: Number(amount),
        paymentDate: new Date(paymentDate).toISOString(),
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record this payment. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Record Payment</ThemedText>

        {charges.length > 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">Apply to a charge (optional)</ThemedText>
            <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Dues charge">
              {charges.map((charge) => (
                <Pressable
                  key={charge.id}
                  style={[styles.chip, charge.id === duesChargeId && styles.chipSelected]}
                  onPress={() => setDuesChargeId(charge.id === duesChargeId ? null : charge.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={`$${Number(charge.amountDue).toFixed(2)} due ${new Date(charge.dueDate).toLocaleDateString()}`}
                  accessibilityState={{ selected: charge.id === duesChargeId }}
                >
                  <ThemedText type="small" style={charge.id === duesChargeId ? styles.chipTextSelected : undefined}>
                    ${Number(charge.amountDue).toFixed(2)} · {new Date(charge.dueDate).toLocaleDateString()}
                  </ThemedText>
                </Pressable>
              ))}
            </ThemedView>
          </>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
        <TextInput style={styles.input} placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} accessibilityLabel="Amount" />

        <ThemedText type="small" themeColor="textSecondary">Payment Date (YYYY-MM-DD)</ThemedText>
        <TextInput style={styles.input} value={paymentDate} onChangeText={setPaymentDate} accessibilityLabel="Payment date, format YYYY-MM-DD" />

        <ThemedText type="small" themeColor="textSecondary">Method</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {PAYMENT_METHODS.map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, m === method && styles.chipSelected]}
              onPress={() => setMethod(m)}
              accessibilityRole="radio"
              accessibilityLabel={m.replace('_', ' ')}
              accessibilityState={{ selected: m === method }}
            >
              <ThemedText type="small" style={m === method ? styles.chipTextSelected : undefined}>{m.replace('_', ' ')}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Reference (optional)</ThemedText>
        <TextInput style={styles.input} value={reference} onChangeText={setReference} placeholder="Check #, confirmation code, etc." accessibilityLabel="Reference, optional" />

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
          accessibilityLabel="Record payment"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Record Payment</ThemedText>}
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
