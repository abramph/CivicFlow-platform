import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/lib/api-client';
import type { PayableMethod, PaymentReportCategory } from '@/lib/mobile-api';

/** Shared "Pay Now via Card" + "Ways to Pay" + "Report a Payment" section for
 * the Make a Payment detail screens (campaign / event / dues-in-advance). */
export function PaymentOptions({
  paymentLinkSlug,
  methods,
  reportCategory,
}: {
  paymentLinkSlug: string | null;
  methods: PayableMethod[];
  reportCategory: PaymentReportCategory;
}) {
  return (
    <>
      {paymentLinkSlug ? (
        <Pressable
          style={styles.payButton}
          onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/pay/${paymentLinkSlug}`)}
        >
          <ThemedText style={styles.payButtonText}>Pay Now via Card</ThemedText>
        </Pressable>
      ) : null}

      {methods.length > 0 ? (
        <ThemedView type="backgroundElement" style={styles.methodsCard}>
          <ThemedText type="smallBold">Ways to Pay</ThemedText>
          {methods.map((method) => {
            const isLink = method.accountIdentifier?.startsWith('http://') || method.accountIdentifier?.startsWith('https://');
            return (
              <ThemedView key={method.id} style={styles.methodRow}>
                <ThemedText type="smallBold">{method.label}</ThemedText>
                {method.accountIdentifier ? (
                  <ThemedText type="small" style={isLink ? styles.link : undefined}>
                    {method.accountIdentifier}
                  </ThemedText>
                ) : null}
                {method.instructions ? (
                  <ThemedText type="small" themeColor="textSecondary">{method.instructions}</ThemedText>
                ) : null}
              </ThemedView>
            );
          })}
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.reportButton}
        onPress={() => router.push({ pathname: '/report-payment', params: { category: reportCategory } })}
      >
        <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  payButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  payButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  methodsCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  methodRow: {
    gap: 2,
    backgroundColor: 'transparent',
  },
  link: {
    color: '#047857',
  },
  reportButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  reportButtonText: {
    fontWeight: '600',
  },
});
