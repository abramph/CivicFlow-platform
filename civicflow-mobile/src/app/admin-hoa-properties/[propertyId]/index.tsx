import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  archiveAdminHoaProperty,
  assignAdminHoaResident,
  endAdminHoaResident,
  getAdminHoaProperty,
  getAdminMembers,
  reactivateAdminHoaProperty,
  type AdminHoaPropertyDetail,
  type AdminMemberListRow,
  type HoaResidentType,
} from '@/lib/mobile-api';

const RELATIONSHIP_TYPES: { value: HoaResidentType; label: string }[] = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'CO_OWNER', label: 'Co-Owner' },
  { value: 'RESIDENT', label: 'Resident' },
  { value: 'TENANT', label: 'Tenant' },
  { value: 'NON_RESIDENT_OWNER', label: 'Non-Resident Owner' },
  { value: 'OTHER', label: 'Other' },
];

function propertyLabel(property: AdminHoaPropertyDetail) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — HOA property detail. Re-fetches by
 * (propertyId, organizationId) on every mount. Assigning a resident
 * searches the organization's real member roster (getAdminMembers) rather
 * than accepting free text, matching the web form's member picker and
 * preventing a crafted orgMemberId from a different organization (the
 * server independently re-validates this too).
 */
export default function AdminHoaPropertyDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaProperties = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaProperties'));
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();

  const [property, setProperty] = useState<AdminHoaPropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const [showAssign, setShowAssign] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<AdminMemberListRow[]>([]);
  const [selectedMember, setSelectedMember] = useState<AdminMemberListRow | null>(null);
  const [relationshipType, setRelationshipType] = useState<HoaResidentType>('OWNER');
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !propertyId || !hasManageHoaProperties) return;
    try {
      setProperty(await getAdminHoaProperty(selectedOrganizationId, propertyId));
      setLoadError(null);
    } catch (error) {
      setProperty(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This property could not be found.' : 'Unable to load this property. Check your connection and try again.');
    }
  }, [selectedOrganizationId, propertyId, hasManageHoaProperties]);

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

  async function searchMembers(query: string) {
    setMemberSearch(query);
    if (!selectedOrganizationId || query.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      const result = await getAdminMembers(selectedOrganizationId, { search: query.trim(), page: 1 });
      setMemberResults(result.members.slice(0, 8));
    } catch {
      setMemberResults([]);
    }
  }

  async function handleAssign() {
    if (!selectedOrganizationId || !propertyId || !selectedMember || actionPending) return;
    setActionPending(true);
    try {
      await assignAdminHoaResident(propertyId, {
        organizationId: selectedOrganizationId,
        orgMemberId: selectedMember.id,
        relationshipType,
        isPrimaryContact,
      });
      setShowAssign(false);
      setSelectedMember(null);
      setMemberSearch('');
      setIsPrimaryContact(false);
      await load();
    } catch (error) {
      Alert.alert('Unable to assign resident', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmEndResident(residentId: string, name: string) {
    Alert.alert(`End ${name}'s relationship to this property?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: () => handleEndResident(residentId) },
    ]);
  }

  async function handleEndResident(residentId: string) {
    if (!selectedOrganizationId || !propertyId || actionPending) return;
    setActionPending(true);
    try {
      await endAdminHoaResident(propertyId, residentId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to end this relationship', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmArchive() {
    Alert.alert('Archive this property?', 'It will no longer appear in active listings. You can reactivate it later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: handleArchive },
    ]);
  }

  async function handleArchive() {
    if (!selectedOrganizationId || !propertyId || actionPending) return;
    setActionPending(true);
    try {
      await archiveAdminHoaProperty(propertyId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to archive', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleReactivate() {
    if (!selectedOrganizationId || !propertyId || actionPending) return;
    setActionPending(true);
    try {
      await reactivateAdminHoaProperty(propertyId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to reactivate', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  if (!hasManageHoaProperties) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have property administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading property">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!property) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This property could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  const activeResidents = property.residents.filter((r) => r.status === 'ACTIVE');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{propertyLabel(property)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {property.status === 'INACTIVE' ? 'Archived' : 'Active'}
        {property.city ? ` · ${property.city}${property.state ? `, ${property.state}` : ''}` : ''}
      </ThemedText>

      {property.notes ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">{property.notes}</ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push(`/admin-hoa-properties/${property.id}/edit`)}
        accessibilityRole="button"
        accessibilityLabel="Edit property"
      >
        <ThemedText type="link">Edit Property</ThemedText>
      </Pressable>

      <ThemedView style={styles.section}>
        <ThemedView style={styles.sectionHeaderRow}>
          <ThemedText type="subtitle">Residents</ThemedText>
          <Pressable onPress={() => setShowAssign((v) => !v)} accessibilityRole="button" accessibilityLabel="Assign resident">
            <ThemedText type="link">{showAssign ? 'Cancel' : '+ Assign'}</ThemedText>
          </Pressable>
        </ThemedView>

        {showAssign ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            {selectedMember ? (
              <ThemedView style={styles.selectedMemberRow}>
                <ThemedText type="smallBold">{selectedMember.firstName} {selectedMember.lastName}</ThemedText>
                <Pressable onPress={() => { setSelectedMember(null); setMemberSearch(''); }} accessibilityRole="button" accessibilityLabel="Change member">
                  <ThemedText type="link">Change</ThemedText>
                </Pressable>
              </ThemedView>
            ) : (
              <>
                <TextInput style={styles.input} placeholder="Search members" value={memberSearch} onChangeText={searchMembers} accessibilityLabel="Search members" />
                {memberResults.map((member) => (
                  <Pressable key={member.id} onPress={() => { setSelectedMember(member); setMemberResults([]); }} accessibilityRole="button" accessibilityLabel={`${member.firstName} ${member.lastName}`}>
                    <ThemedText type="small" style={styles.memberResult}>{member.firstName} {member.lastName}</ThemedText>
                  </Pressable>
                ))}
              </>
            )}

            <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Relationship type">
              {RELATIONSHIP_TYPES.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.chip, option.value === relationshipType && styles.chipSelected]}
                  onPress={() => setRelationshipType(option.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: option.value === relationshipType }}
                >
                  <ThemedText type="small" style={option.value === relationshipType ? styles.chipTextSelected : undefined}>{option.label}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>

            <Pressable
              style={styles.checkboxRow}
              onPress={() => setIsPrimaryContact((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityLabel="Primary contact"
              accessibilityState={{ checked: isPrimaryContact }}
            >
              <ThemedView style={[styles.checkbox, isPrimaryContact && styles.checkboxChecked]} />
              <ThemedText type="small">Primary contact</ThemedText>
            </Pressable>

            <Pressable
              style={[styles.button, (!selectedMember || actionPending) && styles.buttonDisabled]}
              onPress={handleAssign}
              disabled={!selectedMember || actionPending}
              accessibilityRole="button"
              accessibilityLabel="Save resident"
              accessibilityState={{ disabled: !selectedMember || actionPending, busy: actionPending }}
            >
              {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Resident</ThemedText>}
            </Pressable>
          </ThemedView>
        ) : null}

        {activeResidents.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No active residents on file.</ThemedText>
        ) : (
          activeResidents.map((resident) => (
            <ThemedView key={resident.id} type="backgroundElement" style={styles.rowCard}>
              <ThemedView style={styles.rowCardText}>
                <ThemedText type="small">
                  {resident.orgMember ? `${resident.orgMember.firstName} ${resident.orgMember.lastName}` : 'Unknown member'}
                  {resident.isPrimaryContact ? ' · Primary' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{resident.relationshipType.replace(/_/g, ' ')}</ThemedText>
              </ThemedView>
              <Pressable
                onPress={() => confirmEndResident(resident.id, resident.orgMember ? `${resident.orgMember.firstName} ${resident.orgMember.lastName}` : 'this resident')}
                accessibilityRole="button"
                accessibilityLabel={`End relationship for ${resident.orgMember ? resident.orgMember.firstName : 'this resident'}`}
              >
                <ThemedText type="link" style={styles.dangerText}>End</ThemedText>
              </Pressable>
            </ThemedView>
          ))
        )}
      </ThemedView>

      {property.status === 'INACTIVE' ? (
        <Pressable
          style={[styles.button, styles.buttonAmber, actionPending && styles.buttonDisabled]}
          onPress={handleReactivate}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Reactivate property"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.buttonText}>{actionPending ? 'Reactivating…' : 'Reactivate Property'}</ThemedText>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.secondaryButtonDanger, actionPending && styles.buttonDisabled]}
          onPress={confirmArchive}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Archive property"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.dangerText}>Archive Property</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  rowCard: {
    borderRadius: 10,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowCardText: {
    flex: 1,
    gap: 2,
    backgroundColor: 'transparent',
  },
  selectedMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  memberResult: {
    paddingVertical: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    backgroundColor: 'transparent',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  checkboxChecked: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonAmber: {
    backgroundColor: '#B54708',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonDanger: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
