import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminCampaign, type CampaignChannel, type CampaignCommunicationType } from '@/lib/mobile-api';

const TYPE_OPTIONS: { value: CampaignCommunicationType; label: string }[] = [
  { value: 'ANNOUNCEMENT', label: 'Announcement' },
  { value: 'EVENT_NOTICE', label: 'Event Notice' },
  { value: 'DUES_REMINDER', label: 'Dues Reminder' },
  { value: 'GENERAL', label: 'General' },
];

const CHANNEL_OPTIONS: { value: CampaignChannel; label: string }[] = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL_AND_SMS', label: 'Email + SMS' },
  { value: 'INTERNAL_LOG_ONLY', label: 'Log Only' },
];

/**
 * Mobile Admin program (PR C) — create campaign. Uses the exact same
 * createCommunicationCampaign() service the web Communications form uses
 * (entitlement gates, default active_with_email audience, audit) via
 * POST /api/mobile/admin/campaigns. Deliberately omits WhatsApp template
 * selection and custom audience filtering -- those stay web-only for now;
 * the default "active members with email/phone" audience covers the
 * common officer use case.
 */
export default function AdminCampaignCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [title, setTitle] = useState('');
  const [communicationType, setCommunicationType] = useState<CampaignCommunicationType>('ANNOUNCEMENT');
  const [channel, setChannel] = useState<CampaignChannel>('EMAIL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!title.trim()) return 'Title is required.';
    if (!subject.trim()) return 'Subject is required.';
    if (!body.trim()) return 'Message body is required.';
    return null;
  }

  async function submit(sendNow: boolean) {
    if (!selectedOrganizationId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createAdminCampaign({
        organizationId: selectedOrganizationId,
        title: title.trim(),
        communicationType,
        channel,
        subject: subject.trim(),
        body: body.trim(),
        sendNow,
      });
      router.replace(`/admin-campaigns/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this campaign. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Campaign</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Title</ThemedText>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} accessibilityLabel="Title" />

        <ThemedText type="small" themeColor="textSecondary">Type</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Campaign type">
          {TYPE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, option.value === communicationType && styles.chipSelected]}
              onPress={() => setCommunicationType(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.value === communicationType }}
            >
              <ThemedText type="small" style={option.value === communicationType ? styles.chipTextSelected : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Channel</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Channel">
          {CHANNEL_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, option.value === channel && styles.chipSelected]}
              onPress={() => setChannel(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.value === channel }}
            >
              <ThemedText type="small" style={option.value === channel ? styles.chipTextSelected : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Subject</ThemedText>
        <TextInput style={styles.input} value={subject} onChangeText={setSubject} accessibilityLabel="Subject" />

        <ThemedText type="small" themeColor="textSecondary">Message</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={body} onChangeText={setBody} accessibilityLabel="Message body" multiline />

        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          style={styles.secondaryButton}
          onPress={() => submit(false)}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Save as draft"
        >
          <ThemedText type="link">Save as Draft</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => submit(true)}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Send now"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Send Now</ThemedText>}
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
    minHeight: 120,
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
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
