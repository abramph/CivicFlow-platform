import { Stack } from 'expo-router';

import { GivingContent } from '@/components/giving-content';

/**
 * Pushed Stack entry point for My Giving, reached via a dashboard Quick
 * Action (non-Church verticals). Church orgs reach the same content through
 * the primary Give bottom tab instead (see (tabs)/give.tsx) -- both render
 * GivingContent so there is exactly one giving implementation.
 */
export default function GivingScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Giving' }} />
      <GivingContent />
    </>
  );
}
