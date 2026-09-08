import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, WorkspaceColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPtaStudentPhoto } from '@/lib/mobile-api';

/**
 * Student avatar for roster surfaces (My Family, Edit Family). Renders the
 * student's photo when one exists, otherwise an initials circle -- the same
 * deliberate-placeholder approach the family-photo card uses (an empty or
 * emoji avatar reads as broken; initials read as "no photo yet").
 *
 * The photo bytes come exclusively through getPtaStudentPhoto's data-URI
 * contract (bearer-token fetch, never a storage URL -- see
 * docs/pta-family-photo-privacy.md in the portal). This component never
 * receives or builds a URL itself; it only displays a data URI the hook
 * below fetched for the caller's own household.
 */

export function StudentAvatar({ name, uri, size = 48 }: { name: string; uri?: string | null; size?: number }) {
  const scheme = useColorScheme() ?? 'light';
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={circle}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Photo of ${name}`}
      />
    );
  }

  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (
    words.length > 1 ? `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}` : (words[0]?.charAt(0) ?? '')
  ).toUpperCase();
  // Existing token pairs only: deep green on the green tint in light mode,
  // the parent-header subtext green on the dark tint in dark mode -- both
  // documented-AA combinations from constants/theme.ts.
  const palette =
    scheme === 'dark'
      ? { background: Brand.primaryTintDark, text: WorkspaceColors.parentHeaderSubtext }
      : { background: Brand.primaryTintLight, text: Brand.primaryDark };

  return (
    <View
      style={[styles.placeholder, circle, { backgroundColor: palette.background }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`No photo set for ${name}`}
    >
      {initials ? (
        <ThemedText type="smallBold" style={[styles.initials, { color: palette.text, fontSize: size * 0.375 }]}>
          {initials}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * Fetches the photos for a household's students and returns a
 * studentId -> data-URI map, empty until loaded.
 *
 * Staleness rules mirror pta-my-family.tsx's family-photo state exactly:
 * the loaded map is tagged with the organization it belongs to and is only
 * ever exposed while that organization is still selected, so a previous
 * organization's student photos can never appear for even one frame after
 * an org switch. Refresh comes for free from the screens' existing
 * focus-driven reloads: every reload produces a new `students` array, this
 * effect re-runs, and upload/replace/remove all land as different fetch
 * results (a student whose hasPhoto flag dropped simply gets no entry in
 * the rebuilt map, so the initials fallback returns immediately).
 */
export function useStudentPhotos(
  organizationId: string | null,
  students: readonly { id: string; hasPhoto: boolean }[] | null
): Record<string, string> {
  const [photos, setPhotos] = useState<{ organizationId: string; byStudentId: Record<string, string> } | null>(null);

  useEffect(() => {
    if (!organizationId || !students) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        students
          .filter((student) => student.hasPhoto)
          .map(async (student) => {
            try {
              const photo = await getPtaStudentPhoto(organizationId, student.id);
              return photo ? ([student.id, photo.uri] as const) : null;
            } catch {
              // An avatar is never worth an error state on a roster: a
              // failed fetch just leaves that student on initials, and the
              // next focus-driven reload retries naturally.
              return null;
            }
          })
      );
      if (cancelled) return;
      setPhotos({
        organizationId,
        byStudentId: Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, students]);

  return photos && photos.organizationId === organizationId ? photos.byStudentId : {};
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    lineHeight: undefined,
  },
});
