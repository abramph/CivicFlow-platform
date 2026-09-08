import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MinTouchTarget, Spacing, WorkspaceColors } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  createAdminCampaign,
  getAdminCampaignTargetingOptions,
  previewAdminCampaignRecipients,
  type CampaignChannel,
  type CampaignCommunicationType,
} from '@/lib/mobile-api';
import { requireAdminCapability } from '@/components/require-admin-capability';

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

type AudienceKey = 'active_with_email' | 'outstanding_dues' | 'delinquent' | 'pta_all' | 'pta_unpaid';

interface AudienceOption {
  key: AudienceKey;
  label: string;
}

/**
 * The announcement composer (Build 27 completion of Mobile Admin PR C).
 * Still the exact same createCommunicationCampaign() backend the web form
 * uses — entitlement gates, server-resolved audiences, audit attribution —
 * now with the audience choices that backend already supports: the base
 * selectors, plus PTA "all families" / "unpaid households" targeting for
 * PTA organizations (resolved server-side by resolvePtaTargetMemberIds —
 * the client only ever names a rule). Grade/class/committee/event
 * targeting stays web-only until those entity lists have mobile admin
 * endpoints; the composer says so instead of showing broken pickers.
 *
 * Send is a two-step: preview/confirm with the real recipient count (the
 * same resolver the create uses), then create+send. A duplicate create of
 * identical content within two minutes is answered by the server with a
 * conflict, so a retry after a timeout can't fan out twice.
 */
function AdminCampaignCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [title, setTitle] = useState('');
  const [communicationType, setCommunicationType] = useState<CampaignCommunicationType>('ANNOUNCEMENT');
  const [channel, setChannel] = useState<CampaignChannel>('EMAIL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AudienceKey>('active_with_email');
  const [isPta, setIsPta] = useState(false);
  const [currentSchoolYear, setCurrentSchoolYear] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!selectedOrganizationId) return;
      try {
        const options = await getAdminCampaignTargetingOptions(selectedOrganizationId);
        setIsPta(options.isPta);
        setCurrentSchoolYear(options.currentSchoolYear);
        if (options.isPta) setAudience('pta_all');
      } catch {
        // Older portal without the endpoint — base audience only.
      }
    })();
  }, [selectedOrganizationId]);

  const audienceOptions: AudienceOption[] = isPta
    ? [
        { key: 'pta_all', label: 'All families' },
        ...(currentSchoolYear ? [{ key: 'pta_unpaid' as const, label: 'Unpaid households' }] : []),
        { key: 'active_with_email', label: 'All active with email' },
      ]
    : [
        { key: 'active_with_email', label: 'All active with email' },
        { key: 'outstanding_dues', label: 'Outstanding dues' },
        { key: 'delinquent', label: 'Delinquent members' },
      ];

  const buildRecipientFilter = useCallback((): Record<string, unknown> => {
    switch (audience) {
      case 'pta_all':
        return { selector: 'pta_target', ptaRule: { type: 'all' } };
      case 'pta_unpaid':
        return { selector: 'pta_target', ptaRule: { type: 'unpaid', schoolYear: currentSchoolYear } };
      default:
        return { selector: audience };
    }
  }, [audience, currentSchoolYear]);

  // The previewed count belongs to one (audience, channel) pair — switching
  // either invalidates it so a stale count can never be confirmed.
  useEffect(() => {
    setPreviewCount(null);
  }, [audience, channel]);

  function validate(): string | null {
    if (!title.trim()) return 'Title is required.';
    if (!subject.trim()) return 'Subject is required.';
    if (!body.trim()) return 'Message body is required.';
    return null;
  }

  async function previewAudience(): Promise<number | null> {
    if (!selectedOrganizationId || previewing) return previewCount;
    setPreviewing(true);
    setError(null);
    try {
      const { count } = await previewAdminCampaignRecipients(selectedOrganizationId, buildRecipientFilter(), channel);
      setPreviewCount(count);
      return count;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to preview the audience. Check your connection and try again.');
      return null;
    } finally {
      setPreviewing(false);
    }
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
        recipientFilter: buildRecipientFilter(),
      });
      router.replace(`/admin-campaigns/${created.id}`);
    } catch (err) {
      // Form state is preserved on every failure path, so a retry never
      // re-types anything; the server's duplicate window makes the retry
      // itself safe.
      setError(err instanceof ApiError ? err.message : 'Unable to create this campaign. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmAndSend() {
    if (submitting || previewing) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const count = previewCount ?? (await previewAudience());
    if (count == null) return;
    const audienceLabel = audienceOptions.find((option) => option.key === audience)?.label ?? 'the selected audience';
    Alert.alert(
      'Send this announcement?',
      `“${subject.trim()}” will go to ${count} recipient${count === 1 ? '' : 's'} (${audienceLabel}) via ${CHANNEL_OPTIONS.find((c) => c.value === channel)?.label ?? channel}. This can't be unsent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Send to ${count}`, onPress: () => submit(true) },
      ]
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Announcement</ThemedText>

        <ThemedText type="smallBold">Title</ThemedText>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} accessibilityLabel="Title" />

        <ThemedText type="smallBold">Type</ThemedText>
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

        <ThemedText type="smallBold">Channel</ThemedText>
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

        <ThemedText type="smallBold">Audience</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Audience">
          {audienceOptions.map((option) => (
            <Pressable
              key={option.key}
              style={[styles.chip, option.key === audience && styles.chipSelected]}
              onPress={() => setAudience(option.key)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.key === audience }}
            >
              <ThemedText type="small" style={option.key === audience ? styles.chipTextSelected : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>
        {isPta ? (
          <ThemedText type="small" themeColor="textSecondary">
            Grade, class, committee, and event targeting are available on the web.
          </ThemedText>
        ) : null}

        <Pressable
          style={styles.secondaryButton}
          onPress={() => previewAudience()}
          disabled={previewing || submitting}
          accessibilityRole="button"
          accessibilityLabel="Preview audience size"
          accessibilityState={{ disabled: previewing || submitting, busy: previewing }}
        >
          <ThemedText type="link">{previewing ? 'Counting…' : 'Preview audience size'}</ThemedText>
        </Pressable>
        {previewCount != null ? (
          <ThemedText type="small" accessibilityLiveRegion="polite">
            {previewCount} recipient{previewCount === 1 ? '' : 's'} will receive this.
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold">Subject</ThemedText>
        <TextInput style={styles.input} value={subject} onChangeText={setSubject} accessibilityLabel="Subject" />

        <ThemedText type="smallBold">Message</ThemedText>
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
          onPress={confirmAndSend}
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
    minHeight: MinTouchTarget,
    justifyContent: 'center',
  },
  // Slate selection, not green: the composer is an admin-workspace surface.
  chipSelected: {
    backgroundColor: WorkspaceColors.adminAccent,
    borderColor: WorkspaceColors.adminAccent,
  },
  chipTextSelected: {
    color: WorkspaceColors.adminHeaderText,
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
    backgroundColor: WorkspaceColors.adminAccent,
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

export default requireAdminCapability('manageCommunications', 'communications administration', AdminCampaignCreateScreen);
