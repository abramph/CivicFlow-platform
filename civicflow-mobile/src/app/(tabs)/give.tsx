import { GivingContent } from '@/components/giving-content';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';

/**
 * Church vertical's primary "Give" bottom tab (CHURCH-VERT-A §3/§6) --
 * Give, not Payments, is the member financial hub for a church: Give Now,
 * recurring management, pledges, history, statements. Renders the exact
 * same GivingContent as the Stack-pushed /giving screen other verticals
 * reach via a Quick Action, just inline in a headerShown:false tab (same
 * pattern as (tabs)/cases.tsx) instead of behind a Stack header.
 */
export default function GiveTabScreen() {
  const topPadding = useScreenTopPadding();
  return (
    <GivingContent
      containerStyle={topPadding}
      showHeading
      emptyStateMessage="This church hasn't set up giving yet."
    />
  );
}
