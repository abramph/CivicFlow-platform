import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StatusChip } from '@/components/ui';
import { ActionColors, Radii, Spacing, type StatusTone } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { API_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getDues, getPtaDues, type DuesSummary, type PtaDuesStatus, type PtaDuesSummary } from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatCentsCurrency(cents: number) {
  return formatCurrency(cents / 100);
}

const STATUS_LABELS: Record<PtaDuesStatus, string> = {
  NO_CHARGE: 'No charge on file',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  WAIVED: 'Waived',
  VOIDED: 'Voided',
  PENDING_REVIEW: 'Payment pending review',
};

// Semantic status tones (Build 27 vocabulary) — the chip palette carries
// AA-contrast pairs for both schemes, so no per-screen status hex exists.
const STATUS_TONES: Record<PtaDuesStatus, StatusTone> = {
  NO_CHARGE: 'neutral',
  UNPAID: 'rejected',
  PARTIALLY_PAID: 'pending',
  PAID: 'approved',
  WAIVED: 'approved',
  VOIDED: 'neutral',
  PENDING_REVIEW: 'pending',
};

export default function DuesScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  // Build 27 additive identities: a dual member+parent has BOTH a personal
  // balance and a household charge, and they are different balances against
  // different records — load and show both instead of letting the member
  // identity suppress the household one.
  const { hasMemberIdentity, hasParentIdentity } = deriveOrgCapabilities(selectedOrganization);
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [ptaSummary, setPtaSummary] = useState<PtaDuesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      await Promise.all([
        hasMemberIdentity ? getDues(selectedOrganizationId).then(setSummary) : Promise.resolve(),
        hasParentIdentity ? getPtaDues(selectedOrganizationId).then(setPtaSummary) : Promise.resolve(),
      ]);
      setLoadError(null);
    } catch {
      setLoadError('Unable to load dues status. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasMemberIdentity, hasParentIdentity]);

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

  const topPadding = useScreenTopPadding();

  if (hasParentIdentity && !hasMemberIdentity) {
    const charge = ptaSummary?.currentCharge ?? null;

    return (
      <ThemedView style={[styles.container, topPadding]}>
        <ThemedText type="title">Membership Dues</ThemedText>
        <LoadErrorBanner message={loadError} onRetry={load} />

        {!loading && ptaSummary?.hasBillingIdentity === false ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Your household doesn&apos;t have a dues billing record yet. Contact your PTA if you believe this is a mistake.
          </ThemedText>
        ) : null}

        {!loading && charge ? (
          <ThemedView
            type="backgroundElement"
            style={styles.summaryCard}
            accessible
            accessibilityLabel={`${ptaSummary?.currentSchoolYear ?? 'Current'} membership, ${formatCentsCurrency(charge.remainingBalanceCents)} remaining, ${STATUS_LABELS[charge.status]}, due ${new Date(charge.dueDate).toLocaleDateString()}`}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {ptaSummary?.currentSchoolYear ?? 'Current'} membership
            </ThemedText>
            <ThemedText type="subtitle">{formatCentsCurrency(charge.remainingBalanceCents)} remaining</ThemedText>
            <StatusChip tone={STATUS_TONES[charge.status]} label={STATUS_LABELS[charge.status]} />
            <ThemedText type="small" themeColor="textSecondary">
              Due {new Date(charge.dueDate).toLocaleDateString()} · {formatCentsCurrency(charge.amountDueCents)} due · {formatCentsCurrency(charge.amountPaidCents)} paid
            </ThemedText>
          </ThemedView>
        ) : null}

        {charge && charge.adjustments.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Adjustments</ThemedText>
            {charge.adjustments.map((adj) => (
              <ThemedView key={adj.id} type="backgroundElement" style={styles.chargeRow}>
                <ThemedText type="smallBold">{adj.type.replace('_', ' ')} · {formatCentsCurrency(adj.amountCents)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{adj.reason}</ThemedText>
              </ThemedView>
            ))}
          </>
        ) : null}

        {charge && charge.payments.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Payments</ThemedText>
            {charge.payments.map((p) => (
              <ThemedView key={p.id} type="backgroundElement" style={styles.chargeRow}>
                <ThemedText type="smallBold">{formatCentsCurrency(p.amountCents)} · {p.method}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{new Date(p.paymentDate).toLocaleDateString()}</ThemedText>
              </ThemedView>
            ))}
          </>
        ) : null}

        {ptaSummary?.onlinePaymentLinkSlug ? (
          <Pressable
            style={styles.payButton}
            onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/pay/${ptaSummary.onlinePaymentLinkSlug}`)}
            accessibilityRole="button"
            accessibilityLabel="Open payment options"
            accessibilityHint="Opens payment options in your browser"
          >
            <ThemedText style={styles.payButtonText}>Open Payment Options</ThemedText>
          </Pressable>
        ) : null}

        {charge && charge.status !== 'PAID' && charge.status !== 'WAIVED' && charge.status !== 'VOIDED' ? (
          <Pressable
            style={styles.reportButton}
            onPress={() => router.push('/pta-report-payment')}
            accessibilityRole="button"
            accessibilityLabel="Report a payment"
          >
            <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
          </Pressable>
        ) : null}

        {ptaSummary && ptaSummary.priorCharges.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Prior school years</ThemedText>
            <FlatList
              data={ptaSummary.priorCharges}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <ThemedView type="backgroundElement" style={styles.chargeRow}>
                  <ThemedText type="smallBold">{STATUS_LABELS[item.status]}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Due {new Date(item.dueDate).toLocaleDateString()} · {formatCentsCurrency(item.amountDueCents)} due · {formatCentsCurrency(item.amountPaidCents)} paid
                  </ThemedText>
                </ThemedView>
              )}
            />
          </>
        ) : null}
      </ThemedView>
    );
  }

  // Neither a constituent (OrgMember) identity nor a PTA household identity in
  // this org — e.g. a staff/owner login with no linked member record. Such an
  // account has no personal dues, and every action below is scoped by an
  // identity it doesn't have, so each would 403 server-side. Show the state
  // plainly instead of falling through to the member UI with doomed buttons.
  if (!hasMemberIdentity && !hasParentIdentity) {
    return (
      <ThemedView style={[styles.container, topPadding]}>
        <ThemedText type="title">Dues Status</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No personal dues or payment account is associated with this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, topPadding]}>
      <ThemedText type="title">Dues Status</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />

      {!loading && summary ? (
        <ThemedView
          type="backgroundElement"
          style={styles.summaryCard}
          accessible
          accessibilityLabel={`Outstanding balance, ${formatCurrency(summary.outstandingBalance)}${summary.isDelinquent ? `, past due${summary.delinquentSince ? ` since ${new Date(summary.delinquentSince).toLocaleDateString()}` : ''}` : ''}`}
        >
          <ThemedText type="small" themeColor="textSecondary">Outstanding Balance</ThemedText>
          <ThemedText type="subtitle">{formatCurrency(summary.outstandingBalance)}</ThemedText>
          {summary.isDelinquent ? (
            <ThemedText type="small" style={styles.due}>
              Your dues are past due{summary.delinquentSince ? ` since ${new Date(summary.delinquentSince).toLocaleDateString()}` : ''}.
            </ThemedText>
          ) : null}
        </ThemedView>
      ) : null}

      <Pressable style={styles.payButton} onPress={() => router.push('/make-payment')} accessibilityRole="button" accessibilityLabel="Make a payment">
        <ThemedText style={styles.payButtonText}>Make a Payment</ThemedText>
      </Pressable>

      <Pressable style={styles.reportButton} onPress={() => router.push('/report-payment')} accessibilityRole="button" accessibilityLabel="Report a payment">
        <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={() => router.push('/payment-history')} accessibilityRole="link" accessibilityLabel="View payment history">
        <ThemedText type="link">View Payment History</ThemedText>
      </Pressable>

      {hasParentIdentity && ptaSummary?.currentCharge ? (
        <>
          <ThemedText type="smallBold" style={styles.sectionLabel}>Household dues</ThemedText>
          <ThemedView
            type="backgroundElement"
            style={styles.summaryCard}
            accessible
            accessibilityLabel={`Household ${ptaSummary.currentSchoolYear ?? 'current'} membership, ${formatCentsCurrency(ptaSummary.currentCharge.remainingBalanceCents)} remaining, ${STATUS_LABELS[ptaSummary.currentCharge.status]}`}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {ptaSummary.currentSchoolYear ?? 'Current'} membership · your household
            </ThemedText>
            <ThemedText type="subtitle">{formatCentsCurrency(ptaSummary.currentCharge.remainingBalanceCents)} remaining</ThemedText>
            <StatusChip tone={STATUS_TONES[ptaSummary.currentCharge.status]} label={STATUS_LABELS[ptaSummary.currentCharge.status]} />
          </ThemedView>
          {ptaSummary.onlinePaymentLinkSlug ? (
            <Pressable
              style={styles.reportButton}
              onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/pay/${ptaSummary.onlinePaymentLinkSlug}`)}
              accessibilityRole="button"
              accessibilityLabel="Open household payment options"
              accessibilityHint="Opens payment options in your browser"
            >
              <ThemedText style={styles.reportButtonText}>Household Payment Options</ThemedText>
            </Pressable>
          ) : null}
          {ptaSummary.currentCharge.status !== 'PAID' && ptaSummary.currentCharge.status !== 'WAIVED' && ptaSummary.currentCharge.status !== 'VOIDED' ? (
            <Pressable
              style={styles.reportButton}
              onPress={() => router.push('/pta-report-payment')}
              accessibilityRole="button"
              accessibilityLabel="Report a household payment"
            >
              <ThemedText style={styles.reportButtonText}>Report a Household Payment</ThemedText>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Charges</ThemedText>
      <FlatList
        data={summary?.charges ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.chargeRow}>
            <ThemedText type="smallBold">{item.duesAccount.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Due {new Date(item.dueDate).toLocaleDateString()} · {item.status}
            </ThemedText>
            <ThemedText type="small">
              {formatCurrency(Number(item.amountDue))} due · {formatCurrency(Number(item.amountPaid))} paid
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No dues charges on file.
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
  summaryCard: {
    borderRadius: Radii.md,
    padding: Spacing.three,
    gap: 4,
  },
  due: {
    color: ActionColors.danger,
    marginTop: 4,
  },
  payButton: {
    backgroundColor: ActionColors.primary,
    borderRadius: Radii.sm,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  payButtonText: {
    color: ActionColors.primaryText,
    fontWeight: '600',
  },
  reportButton: {
    borderWidth: 1,
    borderColor: ActionColors.border,
    borderRadius: Radii.sm,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  reportButtonText: {
    fontWeight: '600',
  },
  linkButton: {
    alignSelf: 'center',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  chargeRow: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
