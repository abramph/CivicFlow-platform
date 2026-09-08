import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet } from 'react-native';

import { PrimaryActionButton } from '@/components/action-buttons';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { StudentAvatar, useStudentPhotos } from '@/components/student-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Elevation, Spacing, WorkspaceColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getMyPtaHousehold, getPtaHouseholdPhoto, getPtaProgression, type MyPtaHousehold, type PtaHouseholdPhoto } from '@/lib/mobile-api';

/**
 * "My Family" -- the parent-facing home for household-level PTA content:
 * the family photo card, the family roster (adults and students with their
 * placements and photo entry points), and the Build 27 Edit Family flow for
 * updating contact info and requesting roster changes. Reuses
 * pta-family-photo.tsx / pta-student-photo.tsx entirely for photo
 * management; this screen never touches the photo pipeline directly.
 */
export default function PtaMyFamilyScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const householdName = selectedOrganization?.pta?.householdName ?? null;
  // Falls back to the organization's initial so the avatar still reads as a
  // deliberate placeholder rather than an empty circle.
  const initial =
    householdName?.trim().charAt(0).toUpperCase() ||
    selectedOrganization?.organizationName?.trim().charAt(0).toUpperCase() ||
    '';

  // The organization the loaded photo belongs to is tracked alongside it. A
  // family photo is household data, so it must never be visible for even one
  // frame after the user switches organization -- and the fetch for the new
  // organization is asynchronous, so without this the previous family's photo
  // would stay on screen for the whole of that request.
  const [photo, setPhoto] = useState<{ organizationId: string; data: PtaHouseholdPhoto } | null>(null);
  const visiblePhoto = photo && photo.organizationId === selectedOrganizationId ? photo.data : null;
  const [household, setHousehold] = useState<{ organizationId: string; data: MyPtaHousehold } | null>(null);
  const visibleHousehold = household && household.organizationId === selectedOrganizationId ? household.data : null;
  // Student photos follow the same org-tagged staleness contract as the
  // family photo above (the hook tags and gates on organizationId), and
  // refresh whenever the focus-driven reload above produces a new roster.
  const studentPhotos = useStudentPhotos(selectedOrganizationId, visibleHousehold?.students ?? null);
  const [progressionAvailable, setProgressionAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const topPadding = useScreenTopPadding();
  const scheme = useColorScheme() ?? 'light';
  // Parent-workspace tint on the photo placeholder — the same documented-AA
  // pairs the student avatars use, so the whole family card reads green.
  const placeholderPalette =
    scheme === 'dark'
      ? { background: Brand.primaryTintDark, text: WorkspaceColors.parentHeaderSubtext }
      : { background: Brand.primaryTintLight, text: Brand.primaryDark };

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasPtaIdentity) return;
    try {
      const [loaded, householdData] = await Promise.all([
        getPtaHouseholdPhoto(selectedOrganizationId),
        getMyPtaHousehold(selectedOrganizationId),
      ]);
      setPhoto(loaded ? { organizationId: selectedOrganizationId, data: loaded } : null);
      setHousehold({ organizationId: selectedOrganizationId, data: householdData });
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
      <ThemedText type="title" accessibilityRole="header">
        My Family
      </ThemedText>
      {householdName ? (
        <ThemedText type="small" themeColor="textSecondary">{householdName}</ThemedText>
      ) : null}

      <LoadErrorBanner message={loadError} onRetry={load} retryTarget="your family photo" />

      <ThemedView type="backgroundElement" style={styles.card} accessible={false}>
        <ThemedText type="smallBold" style={styles.cardLabel} accessibilityRole="header">
          Family Photo
        </ThemedText>

        {loading ? (
          <ThemedView
            style={styles.centered}
            accessible
            accessibilityLabel="Loading your family photo"
            accessibilityRole="progressbar"
            accessibilityState={{ busy: true }}
          >
            <ActivityIndicator />
          </ThemedView>
        ) : (
          <>
            {visiblePhoto ? (
              <Image
                source={{ uri: visiblePhoto.uri }}
                style={styles.photo}
                accessible
                accessibilityRole="image"
                accessibilityLabel="Your family's current photo"
              />
            ) : (
              // An initial-based avatar, not an emoji: the emoji fallback read
              // aloud as "family" and looked off-system next to the rest of
              // the app's typography. When there is no name to initial, the
              // circle stays empty and the label carries the meaning.
              <ThemedView
                style={[styles.placeholder, { backgroundColor: placeholderPalette.background }]}
                accessible
                accessibilityRole="image"
                accessibilityLabel="No family photo set"
              >
                {initial ? (
                  <ThemedText type="title" style={[styles.placeholderGlyph, { color: placeholderPalette.text }]}>
                    {initial}
                  </ThemedText>
                ) : null}
              </ThemedView>
            )}

            {/* No emoji in the label: every other PrimaryActionButton in the
                app is plain text, and a screen reader reads the glyph aloud
                ("camera Add Family Photo") when no accessibilityLabel wins. */}
            <PrimaryActionButton
              label={visiblePhoto ? 'Edit Family Photo' : 'Add Family Photo'}
              accessibilityLabel={visiblePhoto ? 'Edit family photo' : 'Add family photo'}
              accessibilityHint="Opens family photo management, where you can take or choose a photo, replace it, or remove it."
              onPress={() => router.push('/pta-family-photo' as never)}
            />
          </>
        )}
      </ThemedView>

      {!loading && visibleHousehold ? (
        <>
          <ThemedView type="backgroundElement" style={styles.card} accessible={false}>
            <ThemedText type="smallBold" style={styles.cardLabel} accessibilityRole="header">
              Family Members
            </ThemedText>
            {visibleHousehold.adults.map((adult) => (
              <ThemedView key={adult.id} style={styles.rosterRow} accessible accessibilityLabel={`${adult.name}${adult.relationshipLabel ? `, ${adult.relationshipLabel}` : ''}${adult.isSelf ? ', you' : ''}`}>
                <ThemedText type="default">
                  {adult.name}
                  {adult.isSelf ? ' (you)' : ''}
                </ThemedText>
                {adult.relationshipLabel ? (
                  <ThemedText type="small" themeColor="textSecondary">{adult.relationshipLabel}</ThemedText>
                ) : null}
              </ThemedView>
            ))}
            {visibleHousehold.students.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={styles.cardLabel} accessibilityRole="header">
                  Students
                </ThemedText>
                {visibleHousehold.students.map((student) => (
                  <ThemedView key={student.id} style={styles.studentRow} accessible={false}>
                    <StudentAvatar name={student.displayName} uri={studentPhotos[student.id] ?? null} />
                    <ThemedView style={styles.studentInfo}>
                      <ThemedText type="default">{student.displayName}</ThemedText>
                      {student.placementLabel ? (
                        <ThemedText type="small" themeColor="textSecondary">{student.placementLabel}</ThemedText>
                      ) : null}
                      <ThemedText
                        type="link"
                        onPress={() =>
                          router.push({ pathname: '/pta-student-photo' as never, params: { studentId: student.id, name: student.displayName } as never })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${student.hasPhoto ? 'Edit' : 'Add'} photo for ${student.displayName}`}
                      >
                        {student.hasPhoto ? 'Edit Photo' : 'Add Photo'}
                      </ThemedText>
                    </ThemedView>
                  </ThemedView>
                ))}
              </>
            ) : null}
            <PrimaryActionButton
              label="Edit Family"
              accessibilityLabel="Edit family"
              accessibilityHint="Update your contact information, volunteer interests, and request changes to your family's records."
              onPress={() => router.push('/pta-edit-family' as never)}
            />
          </ThemedView>
        </>
      ) : null}

      {/* Rendered only when the server confirmed progression is available
          for this organization (both feature flags on) -- see load(). */}
      {!loading && progressionAvailable ? (
        <ThemedView type="backgroundElement" style={styles.card} accessible={false}>
          <ThemedText type="smallBold" style={styles.cardLabel} accessibilityRole="header">
            Progression
          </ThemedText>
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
    ...(Elevation.card as object),
  },
  cardLabel: {
    alignSelf: 'flex-start',
  },
  rosterRow: {
    alignSelf: 'stretch',
    gap: 2,
    backgroundColor: 'transparent',
  },
  studentRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    backgroundColor: 'transparent',
  },
  studentInfo: {
    flex: 1,
    gap: 2,
    backgroundColor: 'transparent',
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
