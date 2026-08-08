import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { ADMIN_REPORT_TYPE_LABELS, sendAdminReport, type AdminReportType } from '@/lib/mobile-api';

const REPORT_TYPES = Object.keys(ADMIN_REPORT_TYPE_LABELS) as AdminReportType[];
const FORMATS: { value: 'csv' | 'xlsx' | 'pdf'; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel' },
];

/**
 * Mobile Admin program (PR D) — reports. Unlike the web /reports page, this
 * never renders a report in-app or downloads a file to the device: it always
 * emails the finished report (buildReport → exportReport → sendReportEmail,
 * same services the web page uses) to the caller's own verified session
 * email. This satisfies "no unbounded dataset in mobile memory" and "secure
 * download" without inventing new file-serving infrastructure. Financial
 * report types are further gated server-side to FINANCE/ORG_ADMIN/ORG_OWNER/
 * SUPER_ADMIN roles (see mobile-report-send.ts) — a STAFF officer may see
 * this screen (manageReports) but still get a 403 sending GENERAL_FINANCIAL.
 */
export default function AdminReportsScreen() {
  const { selectedOrganization, selectedOrganizationId, user } = useAuth();
  const hasManageReports = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageReports'));

  const [reportType, setReportType] = useState<AdminReportType>('ACTIVE_MEMBER_ROSTER');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf'>('pdf');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  async function handleSend() {
    if (!selectedOrganizationId || sending) return;
    setSending(true);
    setError(null);
    setSentMessage(null);
    try {
      await sendAdminReport({
        organizationId: selectedOrganizationId,
        reportType,
        startDate: startDate.trim() ? new Date(startDate.trim()).toISOString() : null,
        endDate: endDate.trim() ? new Date(endDate.trim()).toISOString() : null,
        format,
      });
      setSentMessage(`Report sent to ${user?.email ?? 'your email'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send this report. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  if (!hasManageReports) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have reports administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Reports</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Reports are emailed to you — they aren&apos;t rendered or downloaded on this device.
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary">Report</ThemedText>
      <ThemedView style={styles.chipColumn} accessibilityRole="radiogroup" accessibilityLabel="Report type">
        {REPORT_TYPES.map((type) => (
          <Pressable
            key={type}
            style={[styles.reportChip, type === reportType && styles.chipSelected]}
            onPress={() => setReportType(type)}
            accessibilityRole="radio"
            accessibilityLabel={ADMIN_REPORT_TYPE_LABELS[type]}
            accessibilityState={{ selected: type === reportType }}
          >
            <ThemedText type="small" style={type === reportType ? styles.chipTextSelected : undefined}>
              {ADMIN_REPORT_TYPE_LABELS[type]}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <ThemedText type="small" themeColor="textSecondary">Start Date (optional, YYYY-MM-DD)</ThemedText>
      <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} accessibilityLabel="Start date, optional" />

      <ThemedText type="small" themeColor="textSecondary">End Date (optional, YYYY-MM-DD)</ThemedText>
      <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} accessibilityLabel="End date, optional" />

      <ThemedText type="small" themeColor="textSecondary">Format</ThemedText>
      <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Format">
        {FORMATS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.chip, option.value === format && styles.chipSelected]}
            onPress={() => setFormat(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: option.value === format }}
          >
            <ThemedText type="small" style={option.value === format ? styles.chipTextSelected : undefined}>
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      {error ? (
        <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </ThemedText>
      ) : null}
      {sentMessage ? (
        <ThemedText type="small" style={styles.success} accessibilityLiveRegion="polite">
          {sentMessage}
        </ThemedText>
      ) : null}

      <Pressable
        style={[styles.button, sending && styles.buttonDisabled]}
        onPress={handleSend}
        disabled={sending}
        accessibilityRole="button"
        accessibilityLabel="Email Report"
        accessibilityState={{ disabled: sending, busy: sending }}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Email Report</ThemedText>}
      </Pressable>
    </ScrollView>
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
  chipColumn: {
    gap: Spacing.two,
    marginBottom: Spacing.two,
    backgroundColor: 'transparent',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  reportChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
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
  success: {
    color: '#047857',
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
