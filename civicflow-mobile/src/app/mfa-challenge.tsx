import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { resolveAllowedDeepLinkPath } from '@/lib/deep-links';

export default function MfaChallengeScreen() {
  const { completeMfaChallenge, sendMfaSms } = useAuth();
  const { mfaToken, redirectTo } = useLocalSearchParams<{ mfaToken: string; redirectTo?: string }>();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsStatus, setSmsStatus] = useState<string | null>(null);
  const [sendingSms, setSendingSms] = useState(false);

  async function handleSubmit() {
    if (!mfaToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeMfaChallenge(mfaToken, code.trim());
      const resumePath = redirectTo ? resolveAllowedDeepLinkPath(redirectTo) : null;
      router.replace((resumePath ?? '/') as never);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to verify that code.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendSms() {
    if (!mfaToken) return;
    setSendingSms(true);
    setSmsStatus(null);
    setError(null);
    try {
      const result = await sendMfaSms(mfaToken);
      setSmsStatus(
        result.sent
          ? `Code sent${result.maskedPhone ? ` to ${result.maskedPhone}` : ''}.`
          : 'Unable to send a text right now.'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send a text right now.');
    } finally {
      setSendingSms(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedView style={styles.card}>
          <ThemedText type="title" style={styles.title}>
            Verify It&apos;s You
          </ThemedText>
          <ThemedText type="subtitle" themeColor="textSecondary" style={styles.subtitle}>
            Enter the code from your authenticator app, a backup code, or text yourself one below.
          </ThemedText>

          <TextInput
            style={styles.input}
            placeholder="Verification code"
            autoCapitalize="characters"
            keyboardType="default"
            value={code}
            onChangeText={setCode}
            accessibilityLabel="Verification code"
          />

          {error ? (
            <ThemedText
              type="small"
              themeColor="text"
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {error}
            </ThemedText>
          ) : null}
          {smsStatus ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {smsStatus}
            </ThemedText>
          ) : null}

          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={submitting || !code}
            accessibilityRole="button"
            accessibilityLabel="Verify"
            accessibilityState={{ disabled: submitting || !code, busy: submitting }}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Verify</ThemedText>}
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={handleSendSms}
            disabled={sendingSms}
            accessibilityRole="button"
            accessibilityLabel="Text me a code instead"
            accessibilityState={{ disabled: sendingSms, busy: sendingSms }}
          >
            <ThemedText type="link" themeColor="textSecondary">
              {sendingSms ? 'Sending…' : 'Text me a code instead'}
            </ThemedText>
          </Pressable>
        </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  error: {
    color: '#B42318',
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
  secondaryButton: {
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
});
