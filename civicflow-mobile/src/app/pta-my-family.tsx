import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet } from 'react-native';

import { PrimaryActionButton } from '@/components/action-buttons';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getPtaHouseholdPhoto, getPtaProgression, type PtaHouseholdPhoto } from '@/lib/mobile-api';

/**
 * "My Family" -- the parent-facing home for household-level PTA content.
 * Deliberately minimal today: a family profile card (photo or placeholder,
 * plus the Add/Edit Family Photo entry point) is the only content, since
 * that's the only household-level capability that exists yet. This is the
 * discoverable home the family-photo feature was missing -- previously
 * only reachable via a flat dashboard shortcut with no "family profile"
 * framing at all (see build-26-final-report.md's discoverability-gap
 * finding). Reuses pta-family-photo.tsx entirely for the actual
 * take/choose/crop/upload/replace/remove flow; this screen never touches
 * the photo pipeline directly.
 */
export default function PtaMyFamilyScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const householdName = selectedOrganization?.pta?.householdName ?? null;

  const [photo, setPhoto] = useState<PtaHouseholdPhoto | null>(null);
  const [progressionAvailable, setProgressionAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const topPadding = useScreenTopPadding();

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasPtaIdentity) return;
    try {
      setPhoto(await getPtaHouseholdPhoto(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your family photo. Check your connection and try again.');
    }
    // Progression availability is decided by the SERVER, not by the client:
    // both progression feature flags default OFF and are checked inside
    // /api/mobile/pta/progression, which 403s when either is off. Probing
    // it here is what keeps the entry point genuinely flag-respecting
    // without duplicating flag state into the org-capability payload. A
    // failure of any kind hides the card (fails closed) and is otherwise
    // silent -- the family photo is this screen's primary content and must
    // not show an error just because an optional card is unavailable.
    try {
      await getPtaProgression(selectedOrganizationId);
      setProgressionAvailable(true);
    } catch {
      setProgressionAvailable(false);
    }
  }, [selectedOrganizationId, hasPtaIdentity]);

  // useFocusEffect (not a plain mount-only useEffect) is required here:
  // Expo Router's stack keeps a pushed screen mounted while a screen above
  // it (pta-family-photo.tsx) is focused, so a mount-only fetch would never
  // see an upload/replace/remove that happened on that screen once the
  // user navigates back. Re-fetches every time this screen regains focus,
  // including the return trip from photo management -- see expo-router's
  // own useFocusEffect doc comment for this exact pattern.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          await load();
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-my-family' } }} />;
  }
  // Client-side convenience only -- not the security boundary. Every
  // family-photo API call independently re-authorizes server-side
  // (requirePtaHouseholdSelfAccess / requireMobilePtaHouseholdAccess), so a
  // direct navigation here by an unauthorized account still can't read or
  // change anything; this redirect just avoids showing a PTA-shaped screen
  // to an account with no PTA household to show.
  if (status === 'signedIn' && !hasPtaIdentity) {
    return <Redirect href="/dashboard" />;
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title">My Family</ThemedText>
      {householdName ? (
        <ThemedText type="small" themeColor="textSecondary">{householdName}</ThemedText>
      ) : null}

      <LoadErrorBanner message={loadError} onRetry={load} />

      <ThemedView type="backgroundElement" style={styles.card} accessible={false}>
        <ThemedText type="smallBold" style={styles.cardLabel}>Family Photo</ThemedText>

        {loading ? (
          <ThemedView style={styles.centered}>
            <ActivityIndicator />
          </ThemedView>
        ) : (
          <>
            {photo ? (
              <Image source={{ uri: photo.url }} style={styles.photo} accessibilityLabel="Your family's current photo" />
            ) : (
              <ThemedView style={styles.placeholder} accessible accessibilityLabel="No family photo set">
                <ThemedText type="title" style={styles.placeholderGlyph}>
                  {householdName ? householdName.trim().charAt(0).toUpperCase() : '👪'}
                </ThemedText>
              </ThemedView>
            )}

            <PrimaryActionButton
              label={photo ? '📷 Edit Family Photo' : '📷 Add Family Photo'}
              accessibilityLabel={photo ? 'Edit family photo' : 'Add family photo'}
              accessibilityHint="Opens family photo management, where you can take or choose a photo, replace it, or remove it."
              onPress={() => router.push('/pta-family-photo' as never)}
            />
          </>
        )}
      </ThemedView>

      {/* Rendered only when the server confirmed progression is available
          for this organization (both feature flags on) -- see load(). */}
      {!loading && progressionAvailable ? (
        <ThemedView type="backgroundElement" style={styles.card} accessible={false}>
          <ThemedText type="smallBold" style={styles.cardLabel}>Progression</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.cardLabel}>
            See each child&apos;s current placement and any confirmed next-year placement.
          </ThemedText>
          <PrimaryActionButton
            label="View Student Progression"
            accessibilityLabel="View student progression"
            accessibilityHint="Opens a read-only view of each child's current grade and class, and any confirmed placement for next school year."
            onPress={() => router.push('/pta-progression' as never)}
          />
        </ThemedView>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  cardLabel: {
    alignSelf: 'flex-start',
  },
  photo: {
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  placeholder: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderGlyph: {
    fontSize: 64,
  },
});
