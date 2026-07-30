import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/lib/api-client';
import type { PayableMethod, PaymentReportCategory } from '@/lib/mobile-api';

/**
 * Builds a tappable deep link for methods that have a real universal payment
 * URL. Cash, check, Zelle, ACH, and card/OTHER methods have no such link (Zelle
 * in particular only works from inside the sender's own banking app, with no
 * public "pay to this handle" URL) — those stay as plain text with instructions.
 */
function buildPayLink(method: string, accountIdentifier: string): string | null {
  const trimmed = accountIdentifier.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  switch (method) {
    case 'CASH_APP': {
      const cashtag = trimmed.replace(/^\$/, '');
      return cashtag ? `https://cash.app/$${encodeURIComponent(cashtag)}` : null;
    }
    case 'VENMO': {
      const username = trimmed.replace(/^@/, '');
      return username ? `https://venmo.com/u/${encodeURIComponent(username)}` : null;
    }
    case 'PAYPAL': {
      const handle = trimmed.replace(/^@/, '');
      return handle ? `https://paypal.me/${encodeURIComponent(handle)}` : null;
    }
    default:
      return null;
  }
}

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
          accessibilityRole="button"
          accessibilityLabel="Pay now via card"
          accessibilityHint="Opens payment in your browser"
        >
          <ThemedText style={styles.payButtonText}>Pay Now via Card</ThemedText>
        </Pressable>
      ) : null}

      {methods.length > 0 ? (
        <ThemedView type="backgroundElement" style={styles.methodsCard}>
          <ThemedText type="smallBold">Ways to Pay</ThemedText>
          {methods.map((method) => {
            const payLink = method.accountIdentifier ? buildPayLink(method.method, method.accountIdentifier) : null;
            return (
              <ThemedView
                key={method.id}
                style={styles.methodRow}
                accessible={!payLink}
                accessibilityLabel={!payLink ? `${method.label}${method.accountIdentifier ? `, ${method.accountIdentifier}` : ''}${method.instructions ? `, ${method.instructions}` : ''}` : undefined}
              >
                <ThemedText type="smallBold">{method.label}</ThemedText>
                {method.accountIdentifier ? (
                  payLink ? (
                    <Pressable onPress={() => WebBrowser.openBrowserAsync(payLink)} accessibilityRole="link" accessibilityLabel={`Pay via ${method.label}, ${method.accountIdentifier}`}>
                      <ThemedText type="small" style={styles.link}>{method.accountIdentifier}</ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText type="small">{method.accountIdentifier}</ThemedText>
                  )
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
        accessibilityRole="button"
        accessibilityLabel="Report a payment"
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
