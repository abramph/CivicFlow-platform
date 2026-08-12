import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAttendanceHistory, type AttendanceHistoryRow } from '@/lib/mobile-api';

const STATUS_LABEL: Record<AttendanceHistoryRow['attendanceStatus'], string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  EXCUSED: 'Excused',
  ABSENT: 'Absent',
  VIRTUAL: 'Virtual',
};

export default function AttendanceHistoryScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const [rows, setRows] = useState<AttendanceHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setRows(await getAttendanceHistory(selectedOrganizationId));
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

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/attendance-history' } }} />;
  }
  // Direct-route defense: attendance history is scoped by an OrgMember
  // identity a staff/owner login may not hold. Reachable by deep link even
  // though the Profile entry point gates on it.
  if (status === 'signedIn' && selectedOrganization && !selectedOrganization.memberId) {
    return <Redirect href="/dues" />;
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Attendance History</ThemedText>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView
            type="backgroundElement"
            style={styles.row}
            accessible
            accessibilityLabel={`${item.meetingTitle ?? 'Meeting'}, ${new Date(item.meetingDate).toLocaleDateString()}, ${STATUS_LABEL[item.attendanceStatus]}`}
          >
            <ThemedText type="smallBold">{item.meetingTitle ?? 'Meeting'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(item.meetingDate).toLocaleDateString()} · {STATUS_LABEL[item.attendanceStatus]}
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No attendance recorded yet.
            </ThemedText>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
