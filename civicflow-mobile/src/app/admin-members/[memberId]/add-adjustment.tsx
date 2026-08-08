import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  createAdminDuesAdjustment,
  getAdminMemberDues,
  type AdminDuesCharge,
  type DuesAdjustmentType,
} from '@/lib/mobile-api';

const ADJUSTMENT_TYPES: { value: DuesAdjustmentType; label: string }[] = [
  { value: 'WAIVER', label: 'Waiver' },
  { value: 'DISCOUNT', label: 'Discount' },
  { value: 'CREDIT', label: 'Credit' },
  { value: 'WRITE_OFF', label: 'Write-Off' },
  { value: 'MANUAL_ADJUSTMENT', label: 'Manual Adjustment' },
];

/**
 * Mobile Admin program (PR D) — add a dues adjustment for one member. Uses
 * the exact same createDuesAdjustment() service the web /dues/adjustments
 * form uses. A charge selection is required, matching the web form (an
 * adjustment always applies against a specific charge).
 */
export default function AdminMemberAddAdjustmentScreen() {
  const { selectedOrganizationId } = useAuth();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const [charges, setCharges] = useState<AdminDuesCharge[]>([]);
  const [duesChargeId, setDuesChargeId] = useState<string | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<DuesAdjustmentType>('WAIVER');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCharges = useCallback(async () => {
    if (!selectedOrganizationId || !memberId) return;
    try {
      const detail = await getAdminMemberDues(selectedOrganizationId, memberId);
      setCharges(detail.charges.filter((c) => c.status !== 'VOID'));
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
    if (!duesChargeId) return 'Select a dues charge.';
    if (!reason.trim()) return 'A reason is required.';
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
      await createAdminDuesAdjustment({
        organizationId: selectedOrganizationId,
        memberId,
        duesChargeId,
        adjustmentType,
        amount: Number(amount),
        reason: reason.trim(),
      });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to add this adjustment. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Add Adjustment</ThemedText>

        {charges.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">This member has no dues charges to adjust.</ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">Charge</ThemedText>
            <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Dues charge">
              {charges.map((charge) => (
                <Pressable
                  key={charge.id}
                  style={[styles.chip, charge.id === duesChargeId && styles.chipSelected]}
                  onPress={() => setDuesChargeId(charge.id)}
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

            <ThemedText type="small" themeColor="textSecondary">Type</ThemedText>
            <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Adjustment type">
              {ADJUSTMENT_TYPES.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.chip, option.value === adjustmentType && styles.chipSelected]}
                  onPress={() => setAdjustmentType(option.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: option.value === adjustmentType }}
                >
                  <ThemedText type="small" style={option.value === adjustmentType ? styles.chipTextSelected : undefined}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
            <TextInput style={styles.input} placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} accessibilityLabel="Amount" />

            <ThemedText type="small" themeColor="textSecondary">Reason (required)</ThemedText>
            <TextInput style={[styles.input, styles.multiline]} value={reason} onChangeText={setReason} multiline accessibilityLabel="Reason" />

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
              accessibilityLabel="Add adjustment"
              accessibilityState={{ disabled: submitting, busy: submitting }}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Add Adjustment</ThemedText>}
            </Pressable>
          </>
        )}
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
