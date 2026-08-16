import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createUnionCase, UNION_CASE_TYPES, type UnionCaseSummary } from '@/lib/mobile-api';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Get Help" intake -- deliberately not called "File a Grievance": most
 * members don't know whether their issue qualifies as one, and submitting
 * here never files a formal grievance on its own (see createUnionCaseIntake
 * server-side; UnionCase.isFormalGrievance stays false until a steward
 * makes that call). Category taxonomy mirrors UnionCaseIntakeForm.tsx on
 * the web exactly -- one vocabulary, not a duplicated one.
 */
export default function GetUnionHelpScreen() {
  const { selectedOrganizationId } = useAuth();
  const [caseType, setCaseType] = useState(UNION_CASE_TYPES[0].value);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [representationRequested, setRepresentationRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<UnionCaseSummary | null>(null);

  async function handleSubmit() {
    if (!selectedOrganizationId) return;
    setError(null);
    if (!title.trim() || !description.trim()) {
      setError('Add a short subject and tell us what happened.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createUnionCase({
        organizationId: selectedOrganizationId,
        caseType,
        title: title.trim(),
        description: description.trim(),
        incidentDate: incidentDate ? new Date(incidentDate).toISOString() : null,
        representationRequested,
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit this. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <ScrollView contentContainerStyle={styles.successContainer} accessibilityLiveRegion="polite">
        <ThemedText type="title" style={styles.center}>Your request has been sent to your union.</ThemedText>

        <ThemedView type="backgroundElement" style={styles.summaryCard}>
          <ThemedText type="small" themeColor="textSecondary">Reference</ThemedText>
          <ThemedText type="smallBold">UC-{created.caseNumber}</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Submitted</ThemedText>
          <ThemedText type="smallBold">{new Date(created.createdAt).toLocaleDateString()}</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Status</ThemedText>
          <ThemedText type="smallBold">New</ThemedText>
        </ThemedView>

        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          A steward will review this and follow up with you. You can check for updates any time in Cases.
        </ThemedText>

        <Pressable
          style={styles.button}
          onPress={() => router.replace(`/union-cases/${created.id}`)}
          accessibilityRole="button"
          accessibilityLabel="View case"
        >
          <ThemedText style={styles.buttonText}>View Case</ThemedText>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace('/cases')}
          accessibilityRole="button"
          accessibilityLabel="Back to Cases"
        >
          <ThemedText type="link">Back to Cases</ThemedText>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">How can your union help?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
          Tell us what&apos;s going on -- you don&apos;t need to know exactly what to call it.
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary">What do you need help with?</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="What do you need help with">
          {UNION_CASE_TYPES.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, option.value === caseType && styles.chipSelected]}
              onPress={() => setCaseType(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.value === caseType }}
            >
              <ThemedText type="small" style={option.value === caseType ? styles.chipTextSelected : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Brief subject</ThemedText>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="A few words about what happened"
          accessibilityLabel="Brief subject"
        />

        <ThemedText type="small" themeColor="textSecondary">Tell us what happened</ThemedText>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="As much detail as you can share -- dates, who was involved, what you'd like to see happen."
          multiline
          accessibilityLabel="Tell us what happened"
        />

        <ThemedText type="small" themeColor="textSecondary">Date it happened (optional, YYYY-MM-DD)</ThemedText>
        <TextInput
          style={styles.input}
          value={incidentDate}
          onChangeText={setIncidentDate}
          placeholder={todayIsoDate()}
          accessibilityLabel="Date it happened, optional"
        />

        <ThemedView style={styles.toggleRow}>
          <ThemedText type="default" style={styles.toggleLabel}>I need a union representative to contact me</ThemedText>
          <Switch
            value={representationRequested}
            onValueChange={setRepresentationRequested}
            accessibilityLabel="I need a union representative to contact me"
          />
        </ThemedView>

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
          accessibilityLabel="Send to your union"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Send to Your Union</ThemedText>}
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
  intro: {
    marginBottom: Spacing.two,
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
    minHeight: 100,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingVertical: Spacing.two,
  },
  toggleLabel: {
    flex: 1,
    marginRight: Spacing.two,
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
  secondaryButton: {
    marginTop: Spacing.three,
    alignItems: 'center',
  },
  successContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  summaryCard: {
    borderRadius: 12,
    padding: Spacing.four,
    width: '100%',
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  center: {
    textAlign: 'center',
  },
});
