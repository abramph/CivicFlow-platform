import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  createGivingPledge,
  getGiving,
  getGivingStatementUrl,
  manageRecurringGiving,
  startGivingCheckout,
  startRecurringGivingCheckout,
  type GivingPledge,
  type GivingSummary,
} from '@/lib/mobile-api';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUALLY: 'Yearly',
};

/**
 * CORE-GIVE-L — My Giving (§38), extracted so it can render both as its own
 * pushed Stack screen (src/app/giving.tsx, reached via a Quick Action) AND
 * as the Church vertical's primary "Give" bottom tab (CHURCH-VERT-A §6),
 * with zero duplicated giving logic between the two entry points. Member
 * self-service only: Give Now, recurring management, pledges, history,
 * statements. Checkout always happens in the SYSTEM BROWSER (§64 — card data
 * never touches the app); failure copy never implies debt (§16).
 */
export function GivingContent({
  containerStyle,
  showHeading = false,
  emptyStateMessage = 'This organization has not enabled online giving.',
  emptyStateAction,
}: {
  /** Extra style merged onto the scroll container -- callers reaching this
   * from a headerShown:false tab pass useScreenTopPadding() here so the
   * heading doesn't sit under the status bar/Dynamic Island. */
  containerStyle?: object;
  /** Tab entry points have no navigation header to show a title, so they
   * render one inline; the Stack-pushed entry point already gets a header
   * from Stack.Screen and would otherwise show the title twice. */
  showHeading?: boolean;
  /** Church-specific empty-state copy (§17) overrides the generic one. */
  emptyStateMessage?: string;
  /** Optional extra content rendered directly below the empty-state
   * message, e.g. a "Give Now" button pointing an org admin at setup. */
  emptyStateAction?: React.ReactNode;
}) {
  const { selectedOrganizationId } = useAuth();
  const [summary, setSummary] = useState<GivingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fundId, setFundId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'>('MONTHLY');
  // CORE-GIVE-E give-toward-pledge -- the backend has always supported this
  // (see checkout.ts's pledgeId validation), but no client ever surfaced it.
  // Recurring schedules never accept a pledgeId (the recurring checkout
  // route hardcodes pledgeId: null), so entering pledge mode always forces
  // a one-time gift.
  const [pledgeId, setPledgeId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      const data = await getGiving(selectedOrganizationId);
      setSummary(data);
      if (data.enabled && data.funds.length > 0) setFundId((current) => current ?? data.funds[0].id);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load giving.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedOrganizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const enabled = summary?.enabled === true ? summary : null;
  const selectedFund = enabled?.funds.find((fund) => fund.id === fundId) ?? enabled?.funds[0] ?? null;

  async function give() {
    if (!selectedOrganizationId || !selectedFund) return;
    const value = Number(amount);
    if (!(value > 0)) {
      Alert.alert('Enter an amount', 'Choose or enter the amount you want to give.');
      return;
    }
    setBusy(true);
    try {
      const { url } = recurring
        ? await startRecurringGivingCheckout(selectedOrganizationId, selectedFund.id, value, frequency)
        : await startGivingCheckout(selectedOrganizationId, selectedFund.id, value, pledgeId);
      await WebBrowser.openBrowserAsync(url);
      setAmount('');
      setPledgeId(null);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start your gift.';
      if (recurring && /already have a recurring/i.test(message)) {
        Alert.alert('You already give to this fund', message, [
          { text: 'Keep the existing one', style: 'cancel' },
          {
            text: 'Add another anyway',
            onPress: async () => {
              try {
                const { url } = await startRecurringGivingCheckout(selectedOrganizationId, selectedFund.id, value, frequency, true);
                await WebBrowser.openBrowserAsync(url);
                await load();
              } catch (retryError) {
                Alert.alert('Unable to start', retryError instanceof Error ? retryError.message : 'Please try again.');
              }
            },
          },
        ]);
      } else {
        Alert.alert('Unable to start', message);
      }
    } finally {
      setBusy(false);
    }
  }

  function giveTowardPledge(pledge: GivingPledge) {
    setFundId(pledge.fundId);
    setPledgeId(pledge.id);
    setRecurring(false);
    setAmount(pledge.remainingTowardPledge > 0 ? String(pledge.remainingTowardPledge) : '');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function manage(scheduleId: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    if (!selectedOrganizationId) return;
    const run = async () => {
      setBusy(true);
      try {
        await manageRecurringGiving(selectedOrganizationId, scheduleId, action);
        await load();
      } catch (error) {
        Alert.alert('Unable to update', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setBusy(false);
      }
    };
    if (action === 'cancel') {
      Alert.alert(
        'Cancel recurring giving?',
        'Future contributions stop immediately. Nothing is owed — recurring giving is always voluntary.',
        [
          { text: 'Keep giving', style: 'cancel' },
          { text: 'Cancel it', style: 'destructive', onPress: run },
        ]
      );
    } else {
      await run();
    }
  }

  async function makePledge() {
    if (!selectedOrganizationId || !selectedFund) return;
    const value = Number(amount);
    if (!(value > 0)) {
      Alert.alert('Enter an amount', 'Enter the total you intend to give, then tap Pledge.');
      return;
    }
    Alert.alert(
      `Pledge ${formatCurrency(value)} to ${selectedFund.name}?`,
      'A pledge is a stated intention — it never becomes a debt or a balance owed.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Pledge',
          onPress: async () => {
            setBusy(true);
            try {
              await createGivingPledge(selectedOrganizationId, selectedFund.id, value);
              setAmount('');
              await load();
            } catch (error) {
              Alert.alert('Unable to pledge', error instanceof Error ? error.message : 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  async function openStatement(statementId: string) {
    if (!selectedOrganizationId) return;
    try {
      const { url } = await getGivingStatementUrl(selectedOrganizationId, statementId);
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      Alert.alert('Unable to open', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  return (
    <ThemedView type="background" style={styles.container}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, containerStyle]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {showHeading ? <ThemedText type="title">{enabled?.terminology ?? 'Give'}</ThemedText> : null}

        {loadError ? <LoadErrorBanner message={loadError} onRetry={load} /> : null}

        {!loading && summary && !summary.enabled ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {emptyStateMessage}
            </ThemedText>
            {emptyStateAction}
          </>
        ) : null}

        {enabled ? (
          <>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date().getFullYear()} {enabled.terminology.toLowerCase()}
              </ThemedText>
              <ThemedText type="title">{formatCurrency(enabled.yearTotal)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Every gift is voluntary — changing your mind never creates a balance owed.
              </ThemedText>
            </ThemedView>

            {enabled.funds.length > 0 && selectedFund ? (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="subtitle">Give Now</ThemedText>
                {pledgeId ? (
                  <ThemedView style={styles.pledgeBanner}>
                    <ThemedText type="small" style={styles.pledgeBannerText}>
                      Giving toward your {selectedFund.name} pledge
                    </ThemedText>
                    <Pressable onPress={() => setPledgeId(null)} accessibilityRole="button" accessibilityLabel="Stop giving toward pledge">
                      <ThemedText type="small" style={styles.pledgeBannerClear}>Clear</ThemedText>
                    </Pressable>
                  </ThemedView>
                ) : null}
                {enabled.funds.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {enabled.funds.map((fund) => (
                      <Pressable
                        key={fund.id}
                        onPress={() => { setFundId(fund.id); setPledgeId(null); }}
                        style={[styles.chip, fund.id === selectedFund.id && styles.chipActive]}
                        accessibilityRole="button"
                      >
                        <ThemedText type="small" style={fund.id === selectedFund.id ? styles.chipActiveText : undefined}>
                          {fund.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">Giving to {selectedFund.name}</ThemedText>
                )}
                {selectedFund.suggestedAmounts.length > 0 ? (
                  <ThemedView style={styles.chipRow}>
                    {selectedFund.suggestedAmounts.map((suggested) => (
                      <Pressable
                        key={suggested}
                        onPress={() => setAmount(String(suggested))}
                        style={[styles.chip, Number(amount) === suggested && styles.chipActive]}
                        accessibilityRole="button"
                      >
                        <ThemedText type="small" style={Number(amount) === suggested ? styles.chipActiveText : undefined}>
                          ${suggested}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>
                ) : null}
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="Amount (USD)"
                  style={styles.input}
                  accessibilityLabel="Gift amount in dollars"
                />
                {selectedFund.allowRecurring && !pledgeId ? (
                  <Pressable onPress={() => setRecurring(!recurring)} style={styles.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: recurring }}>
                    <ThemedText type="small">{recurring ? '◉' : '○'} Make this recurring</ThemedText>
                  </Pressable>
                ) : null}
                {recurring && !pledgeId ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {(Object.keys(FREQUENCY_LABELS) as (keyof typeof FREQUENCY_LABELS)[]).map((value) => (
                      <Pressable
                        key={value}
                        onPress={() => setFrequency(value as typeof frequency)}
                        style={[styles.chip, frequency === value && styles.chipActive]}
                        accessibilityRole="button"
                      >
                        <ThemedText type="small" style={frequency === value ? styles.chipActiveText : undefined}>
                          {FREQUENCY_LABELS[value]}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                <Pressable
                  style={[styles.primaryButton, busy && styles.disabled]}
                  disabled={busy}
                  onPress={give}
                  accessibilityRole="button"
                  accessibilityLabel="Continue to secure payment"
                >
                  <ThemedText type="smallBold" style={styles.primaryButtonText}>
                    {busy ? 'Preparing…' : 'Continue to secure payment'}
                  </ThemedText>
                </Pressable>
                {selectedFund.allowPledges && !pledgeId ? (
                  <Pressable style={styles.secondaryButton} disabled={busy} onPress={makePledge} accessibilityRole="button">
                    <ThemedText type="smallBold">Pledge this amount instead</ThemedText>
                  </Pressable>
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  Payment happens in your browser via Stripe — card details never touch this app.
                </ThemedText>
              </ThemedView>
            ) : null}

            {enabled.schedules.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>Recurring giving</ThemedText>
                {enabled.schedules.map((schedule) => (
                  <ThemedView key={schedule.id} type="backgroundElement" style={styles.card}>
                    <ThemedText type="smallBold">
                      {formatCurrency(schedule.amount)} {FREQUENCY_LABELS[schedule.frequency]?.toLowerCase() ?? schedule.frequency} · {schedule.fundName}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {schedule.status === 'PAYMENT_FAILED'
                        ? 'Last payment did not go through — nothing is owed; you can retry or update your card on the web.'
                        : schedule.status === 'PAUSED'
                          ? 'Paused — no contributions are collected while paused.'
                          : schedule.nextContributionDate
                            ? `Next contribution ${new Date(schedule.nextContributionDate).toLocaleDateString()}`
                            : schedule.status}
                      {schedule.paymentMethodDescriptor ? ` · ${schedule.paymentMethodDescriptor}` : ''}
                    </ThemedText>
                    <ThemedView style={styles.actionRow}>
                      {schedule.status === 'ACTIVE' ? (
                        <Pressable style={styles.smallButton} disabled={busy} onPress={() => manage(schedule.id, 'pause')} accessibilityRole="button">
                          <ThemedText type="small">Pause</ThemedText>
                        </Pressable>
                      ) : null}
                      {schedule.status === 'PAUSED' ? (
                        <Pressable style={styles.smallButton} disabled={busy} onPress={() => manage(schedule.id, 'resume')} accessibilityRole="button">
                          <ThemedText type="small">Resume</ThemedText>
                        </Pressable>
                      ) : null}
                      {schedule.status === 'PAYMENT_FAILED' ? (
                        <Pressable style={styles.smallButton} disabled={busy} onPress={() => manage(schedule.id, 'retry')} accessibilityRole="button">
                          <ThemedText type="small">Retry payment</ThemedText>
                        </Pressable>
                      ) : null}
                      {schedule.status !== 'CANCELLED' && schedule.status !== 'COMPLETED' ? (
                        <Pressable style={styles.smallButton} disabled={busy} onPress={() => manage(schedule.id, 'cancel')} accessibilityRole="button">
                          <ThemedText type="small" style={styles.danger}>Cancel</ThemedText>
                        </Pressable>
                      ) : null}
                    </ThemedView>
                  </ThemedView>
                ))}
              </>
            ) : null}

            {enabled.pledges.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>My pledges</ThemedText>
                {enabled.pledges.map((pledge) => (
                  <ThemedView key={pledge.id} type="backgroundElement" style={styles.card}>
                    <ThemedText type="smallBold">
                      {pledge.fundName}
                      {pledge.campaignName ? ` · ${pledge.campaignName}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatCurrency(pledge.contributed)} of {formatCurrency(pledge.pledged)} ({pledge.progressPercent}%)
                      {pledge.remainingTowardPledge > 0
                        ? ` · ${formatCurrency(pledge.remainingTowardPledge)} remaining toward your pledge`
                        : ' · fulfilled — thank you!'}
                    </ThemedText>
                    {pledge.remainingTowardPledge > 0 ? (
                      <Pressable
                        style={styles.smallButton}
                        onPress={() => giveTowardPledge(pledge)}
                        accessibilityRole="button"
                        accessibilityLabel={`Give toward your ${pledge.fundName} pledge`}
                      >
                        <ThemedText type="small">Give toward this pledge</ThemedText>
                      </Pressable>
                    ) : null}
                  </ThemedView>
                ))}
              </>
            ) : null}

            {enabled.history.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>Recent</ThemedText>
                {enabled.history.map((row) => (
                  <ThemedView key={row.id} type="backgroundElement" style={styles.rowCard}>
                    <ThemedText type="smallBold">
                      {formatCurrency(row.amount)} · {row.designation}
                      {row.refundedAmount ? ` (${formatCurrency(row.refundedAmount)} refunded)` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(row.date).toLocaleDateString()}
                      {row.contributionNumber ? ` · ${row.contributionNumber}` : ''}
                    </ThemedText>
                  </ThemedView>
                ))}
              </>
            ) : null}

            {enabled.statements.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>Statements</ThemedText>
                {enabled.statements.map((statement) => (
                  <Pressable key={statement.id} onPress={() => openStatement(statement.id)} accessibilityRole="button">
                    <ThemedView type="backgroundElement" style={styles.rowCard}>
                      <ThemedText type="smallBold">
                        {statement.year} Contribution Statement · v{statement.version}
                        {statement.status === 'SUPERSEDED' ? ' (superseded)' : ''}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatCurrency(statement.total)} · tap to open
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 8,
  },
  rowCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  pledgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pledgeBannerText: {
    color: '#047857',
    flex: 1,
  },
  pledgeBannerClear: {
    color: '#047857',
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  chipActiveText: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  toggleRow: {
    paddingVertical: 4,
  },
  primaryButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  smallButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  danger: {
    color: '#B42318',
  },
  disabled: {
    opacity: 0.5,
  },
});
