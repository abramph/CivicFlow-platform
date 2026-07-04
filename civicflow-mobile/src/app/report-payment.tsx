import * as ImagePicker from 'expo-image-picker';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { submitPaymentReport } from '@/lib/mobile-api';

const PAYMENT_METHODS = ['CASH', 'CHECK', 'ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'CARD', 'OTHER'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportPaymentScreen() {
  const { status, organizations, selectedOrganizationId } = useAuth();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [referenceNumber, setReferenceNumber] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/report-payment' } }} />;
  }
  if (status === 'signedIn' && !selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  const selectedOrg = organizations.find((org) => org.organizationId === selectedOrganizationId);

  async function pickReceipt() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setReceipt({ uri: asset.uri, name: asset.fileName ?? 'receipt.jpg', type: asset.mimeType ?? 'image/jpeg' });
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
      await submitPaymentReport({
        organizationId: selectedOrganizationId,
        amount,
        paymentMethod,
        paymentDate: new Date(paymentDate).toISOString(),
        referenceNumber: referenceNumber || undefined,
        note: note || undefined,
        receipt,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit your payment report.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <ThemedView style={styles.successContainer}>
        <ThemedText type="title" style={styles.center}>Payment Reported</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          Your organization&apos;s treasurer will review this and confirm it soon.
        </ThemedText>
        <Pressable style={styles.button} onPress={() => router.replace('/dues')}>
          <ThemedText style={styles.buttonText}>Back to Dues</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Report a Payment</ThemedText>

        {organizations.length > 1 ? (
          <ThemedView type="backgroundElement" style={styles.orgRow}>
            <ThemedText type="small" themeColor="textSecondary">Reporting for</ThemedText>
            <ThemedText type="smallBold">{selectedOrg?.organizationName ?? 'Select an organization'}</ThemedText>
            <Pressable onPress={() => router.push('/org-switcher')}>
              <ThemedText type="link">Change organization</ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">Amount</ThemedText>
        <TextInput style={styles.input} placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

        <ThemedText type="small" themeColor="textSecondary">Payment Method</ThemedText>
        <ThemedView style={styles.methodRow}>
          {PAYMENT_METHODS.map((method) => (
            <Pressable
              key={method}
              style={[styles.methodChip, method === paymentMethod && styles.methodChipSelected]}
              onPress={() => setPaymentMethod(method)}
            >
              <ThemedText type="small" style={method === paymentMethod ? styles.methodChipTextSelected : undefined}>
                {method.replace('_', ' ')}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Payment Date (YYYY-MM-DD)</ThemedText>
        <TextInput style={styles.input} value={paymentDate} onChangeText={setPaymentDate} placeholder={todayIsoDate()} />

        <ThemedText type="small" themeColor="textSecondary">Reference Number (optional)</ThemedText>
        <TextInput style={styles.input} value={referenceNumber} onChangeText={setReferenceNumber} placeholder="Check #, confirmation code, etc." />

        <ThemedText type="small" themeColor="textSecondary">Note (optional)</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={note} onChangeText={setNote} placeholder="Anything the treasurer should know" multiline />

        <Pressable style={styles.secondaryButton} onPress={pickReceipt}>
          <ThemedText type="link">{receipt ? 'Change Receipt Photo' : 'Attach Receipt Photo (optional)'}</ThemedText>
        </Pressable>
        {receipt ? <Image source={{ uri: receipt.uri }} style={styles.preview} /> : null}

        {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

        <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={submitting}>
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
  orgRow: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 4,
    marginBottom: Spacing.two,
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
  secondaryButton: {
    marginBottom: Spacing.two,
  },
  preview: {
    width: 120,
    height: 120,
    borderRadius: 10,
    marginBottom: Spacing.three,
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
