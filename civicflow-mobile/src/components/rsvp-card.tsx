import { type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { EventRsvpBlock, RsvpStatus } from '@/lib/mobile-api';

const RSVP_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'GOING', label: 'Going' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NOT_GOING', label: "Can't go" },
];

/**
 * Shared RSVP control for event and meeting detail screens (Core RSVP
 * programs). Renders nothing unless the rsvp block says this caller can
 * RSVP — the block, never the surrounding object's shape or the caller's
 * identity fields, decides what appears. The household head-count stepper is
 * driven by the block's own guestCounts flag: it appears only for a GOING
 * household response (a NOT_GOING household is 0 attendees by definition —
 * enforced server-side), with a minimum of 1 and no artificial maximum.
 */
export function RsvpCard({
  rsvp,
  submitting,
  onSelect,
  onChangeCount,
  children,
}: {
  rsvp: EventRsvpBlock | null;
  submitting: boolean;
  onSelect: (status: RsvpStatus) => void;
  /** Household mode only: called with the new head count when the household
   * adjusts how many people are attending. Omit for individual-mode screens. */
  onChangeCount?: (count: number) => void;
  children?: ReactNode;
}) {
  if (!rsvp?.canRsvp) return null;

  const count = rsvp.response?.attendeeCount ?? 1;
  const showStepper = rsvp.guestCounts && rsvp.response?.status === 'GOING' && onChangeCount;

  return (
    <ThemedView type="backgroundElement" style={styles.rsvpCard}>
      <ThemedText type="smallBold">{rsvp.guestCounts ? 'Will your household attend?' : 'Your RSVP'}</ThemedText>
      <ThemedView style={styles.rsvpRow} accessibilityRole="radiogroup" accessibilityLabel="RSVP status">
        {RSVP_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            disabled={submitting}
            style={[styles.rsvpChip, rsvp.response?.status === option.value && styles.rsvpChipSelected]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: rsvp.response?.status === option.value, disabled: submitting, busy: submitting }}
          >
            <ThemedText
              type="small"
              style={rsvp.response?.status === option.value ? styles.rsvpChipTextSelected : undefined}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>
      {showStepper ? (
        <ThemedView style={styles.countBlock}>
          <ThemedText type="small">How many people from your household will attend?</ThemedText>
          <ThemedView style={styles.countRow}>
            <Pressable
              disabled={submitting || count <= 1}
              onPress={() => onChangeCount(count - 1)}
              style={[styles.countButton, (submitting || count <= 1) && styles.countButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Decrease attendee count"
              accessibilityState={{ disabled: submitting || count <= 1 }}
            >
              <ThemedText type="smallBold">−</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" accessibilityLiveRegion="polite" accessibilityLabel={`${count} attendees`}>
              {count}
            </ThemedText>
            <Pressable
              disabled={submitting}
              onPress={() => onChangeCount(count + 1)}
              style={[styles.countButton, submitting && styles.countButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Increase attendee count"
              accessibilityState={{ disabled: submitting }}
            >
              <ThemedText type="smallBold">+</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      ) : rsvp.guestCounts && rsvp.response ? (
        <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
          {rsvp.response.attendeeCount} attendee{rsvp.response.attendeeCount === 1 ? '' : 's'} from your household
        </ThemedText>
      ) : null}
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  rsvpCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  rsvpChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  rsvpChipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  rsvpChipTextSelected: {
    color: '#fff',
  },
  countBlock: {
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  countButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countButtonDisabled: {
    opacity: 0.4,
  },
});
