import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/api-client';
import { getDues, getProfile, updateProfile, type DuesSummary, type MobileProfile } from '@/lib/mobile-api';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function ProfileScreen() {
  const { user, selectedOrganization, selectedOrganizationId, logout } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  // Union foregrounds Cases in primary nav, so Payments isn't a bottom tab
  // for these orgs (see (tabs)/_layout.tsx) — dues/payment status and
  // actions relocate here instead of disappearing. Never deletes the
  // capability, just moves it out of the payment-first spot other
  // verticals use.
  const isUnion = selectedOrganization?.capability?.primaryVertical === 'UNION';
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [dues, setDues] = useState<DuesSummary | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Comms preferences (commsPushEnabled/commsEmailEnabled/commsSmsEnabled) live
  // on the conventional OrgMember record. A PTA household's OrgMember is a
  // shared billing identity (see mobile-auth.ts), never a per-adult one, so
  // there's no existing per-adult comms-preference model to bridge onto —
  // this section is hidden rather than editing a shared household record or
  // fabricating new schema. Name/email/organization above still render
  // correctly for a PTA parent from the org-discovery response alone.
  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasMemberIdentity) return;
    setProfile(await getProfile(selectedOrganizationId));
    if (isUnion) setDues(await getDues(selectedOrganizationId));
  }, [selectedOrganizationId, hasMemberIdentity, isUnion]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleToggle(field: 'commsPushEnabled' | 'commsEmailEnabled' | 'commsSmsEnabled', value: boolean) {
    if (!selectedOrganizationId || !profile) return;
    setSaving(field);
    const previous = profile[field];
    setProfile({ ...profile, [field]: value });
    try {
      const updated = await updateProfile(selectedOrganizationId, { [field]: value });
      setProfile((current) => (current ? { ...current, ...updated } : current));
    } catch {
      setProfile((current) => (current ? { ...current, [field]: previous } : current));
    } finally {
      setSaving(null);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  const topPadding = useScreenTopPadding();

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title">Profile</ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">Name</ThemedText>
        <ThemedText type="smallBold">
          {hasMemberIdentity ? `${selectedOrganization!.firstName} ${selectedOrganization!.lastName}` : user?.displayName ?? '—'}
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Email</ThemedText>
        <ThemedText type="smallBold">{user?.email ?? '—'}</ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Organization</ThemedText>
        <ThemedText type="smallBold">{selectedOrganization?.organizationName ?? '—'}</ThemedText>
      </ThemedView>

      {/* Always visible, even with exactly one organization -- see GitHub #71:
          gating this on organizations.length > 1 left no discoverable way to
          reach /org-switcher for the common single-org case (only reachable
          before via an automatic Redirect, e.g. when selectedOrganizationId
          is null). A single-org account still benefits from confirming which
          org it's in and from a working path if a second org gets added
          later without a re-login. */}
      <Pressable style={styles.secondaryButton} onPress={() => router.push('/org-switcher')} accessibilityRole="button" accessibilityLabel="Switch organization">
        <ThemedText type="link">Switch Organization</ThemedText>
      </Pressable>

      {hasMemberIdentity ? (
        <Pressable style={styles.secondaryButton} onPress={() => router.push('/attendance-history')} accessibilityRole="button" accessibilityLabel="Attendance history">
          <ThemedText type="link">Attendance History</ThemedText>
        </Pressable>
      ) : null}

      {hasMemberIdentity && isUnion ? (
        <>
          <ThemedText type="smallBold" style={styles.sectionLabel}>Membership &amp; Dues</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Balance</ThemedText>
            <ThemedText type="subtitle">{dues ? formatCurrency(dues.outstandingBalance) : '—'}</ThemedText>
            {dues?.isDelinquent ? <ThemedText type="small" style={styles.delinquent}>Past due</ThemedText> : null}
          </ThemedView>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/make-payment')} accessibilityRole="button" accessibilityLabel="Make a payment">
            <ThemedText type="link">Make a Payment</ThemedText>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/report-payment')} accessibilityRole="button" accessibilityLabel="Report a payment">
            <ThemedText type="link">Report a Payment</ThemedText>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/payment-history')} accessibilityRole="button" accessibilityLabel="Payment history">
            <ThemedText type="link">Payment History</ThemedText>
          </Pressable>
        </>
      ) : null}

      {hasMemberIdentity ? (
        <>
          <ThemedText type="smallBold" style={styles.sectionLabel}>Notifications</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Push Notifications</ThemedText>
              <Switch
                value={profile?.commsPushEnabled ?? false}
                disabled={!profile || saving === 'commsPushEnabled'}
                onValueChange={(value) => handleToggle('commsPushEnabled', value)}
                accessibilityLabel="Push notifications"
              />
            </ThemedView>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Email Updates</ThemedText>
              <Switch
                value={profile?.commsEmailEnabled ?? false}
                disabled={!profile || saving === 'commsEmailEnabled'}
                onValueChange={(value) => handleToggle('commsEmailEnabled', value)}
                accessibilityLabel="Email updates"
              />
            </ThemedView>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Text Messages</ThemedText>
              <Switch
                value={profile?.commsSmsEnabled ?? false}
                disabled={!profile || saving === 'commsSmsEnabled' || Boolean(profile?.smsOptedOutAt)}
                onValueChange={(value) => handleToggle('commsSmsEnabled', value)}
                accessibilityLabel="Text messages"
                accessibilityHint={profile?.smsOptedOutAt ? "Blocked because you've texted STOP" : undefined}
              />
            </ThemedView>
            {profile?.smsOptedOutAt ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.optOutNote}>
                You&apos;ve texted STOP, so text messages are blocked until you text START to re-enable them.
              </ThemedText>
            ) : null}
          </ThemedView>
        </>
      ) : null}

      {/* Opens the public web deletion-request page rather than the
          authenticated /settings/security flow -- the app's own session is
          token-based and isn't shared with the system browser, so there's no
          way to land the user already signed in there. The public page
          (email + link, same as password reset) works regardless. */}
      <Pressable
        style={styles.secondaryButton}
        onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/delete-account`)}
        accessibilityRole="button"
        accessibilityLabel="Delete account"
      >
        <ThemedText type="link" style={styles.deleteAccountText}>Delete Account</ThemedText>
      </Pressable>

      <Pressable style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button" accessibilityLabel="Log out">
        <ThemedText style={styles.logoutText}>Log Out</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
  },
  deleteAccountText: {
    color: '#B42318',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  delinquent: {
    color: '#B42318',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingVertical: Spacing.one,
  },
  optOutNote: {
    marginTop: Spacing.two,
  },
  logoutButton: {
    marginTop: Spacing.three,
    backgroundColor: '#B42318',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
});
