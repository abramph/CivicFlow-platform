import * as Sentry from "@sentry/nextjs";
import { ForbiddenError, UnauthenticatedError, OrganizationRequiredError, withForbiddenHandler } from "@/lib/auth-guards";
import { MobileAuthError, MobileForbiddenError } from "@/lib/mobile-auth";
import { ValidationError, jsonError } from "@/lib/validation";
import { PlanFeatureError, PlanLimitError } from "@/lib/plan-gate";
import { AdminSeatLimitError } from "@/lib/admin-seats";
import { AdminSeatOverrideError } from "@/lib/admin-seat-override";
import { LabFeatureError } from "@/lib/labs/access";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { PtaError } from "@/lib/labs/pta/errors";
import { EventRsvpError } from "@/lib/event-rsvp";
import { MeetingRsvpError } from "@/lib/meeting-rsvp";
import { HoaError } from "@/lib/hoa/errors";
import { UnionError } from "@/lib/union/errors";
import { ImportError } from "@/lib/imports/errors";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { SupportAssistantError } from "@/lib/support-assistant/errors";
import { MeetingMinutesError, meetingMinutesErrorResponse } from "@/lib/meeting-minutes";
import { MeetingOperationError } from "@/lib/meeting-operations";
import { GovernanceDocumentError } from "@/lib/governance-documents";
import { FinanceError } from "@/lib/finance-errors";
import { AccountDeletionError } from "@/lib/account-deletion";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import { SubscriptionRequiredError } from "@/lib/subscription-gate";

export async function withApiErrorHandling(
  fn: () => Promise<Response>
): Promise<Response> {
  return withForbiddenHandler(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(error.message, error.status, error.details);
      }
      if (error instanceof ForbiddenError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof UnauthenticatedError || error instanceof OrganizationRequiredError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof PlanFeatureError) {
        return Response.json(
          { ok: false, error: error.message, code: error.code, feature: error.feature },
          { status: error.status }
        );
      }
      if (error instanceof PlanLimitError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof AdminSeatLimitError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof AdminSeatOverrideError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof LabFeatureError) {
        return Response.json(
          { ok: false, error: error.message, code: error.code, feature: error.feature },
          { status: error.status }
        );
      }
      if (error instanceof MeetingIntelligenceError) {
        return Response.json(
          { ok: false, error: error.message, code: error.code, retryable: error.retryable },
          { status: error.status }
        );
      }
      if (error instanceof PtaError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof EventRsvpError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof MeetingRsvpError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof HoaError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof UnionError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof ImportError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof MemberLifecycleError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof SupportAssistantError) {
        return Response.json({ ok: false, error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
      }
      if (error instanceof MeetingMinutesError) {
        return meetingMinutesErrorResponse(error);
      }
      if (error instanceof MeetingOperationError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof GovernanceDocumentError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof FinanceError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof AccountDeletionError) {
        return Response.json(
          { ok: false, error: error.message, code: error.code, blockedByOrganizations: error.blockedByOrganizations },
          { status: error.status }
        );
      }
      if (error instanceof MemberIntakeError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof MobileAuthError || error instanceof MobileForbiddenError) {
        return jsonError(error.message, error.status);
      }
      if (error instanceof SubscriptionRequiredError) {
        // E2E-10 finding: an earlier version of this branch used
        // {code, reason, message} — diverging from the {ok, error, code}
        // shape every sibling branch in this file uses (see
        // PlanFeatureError/AdminSeatLimitError/etc. above). Both the web
        // client (data.error) and the mobile client (apiFetch reads
        // payload?.error/payload?.ok) depend on that shape; the divergent
        // one silently degraded to a generic "Request failed" on mobile
        // instead of the safe, pre-approved message from
        // subscription-gate.ts's accessDenialMessage(). Never include
        // Stripe identifiers or other internal billing detail here.
        return Response.json(
          { ok: false, error: error.message, code: error.code, reason: error.reason },
          { status: error.status }
        );
      }
      const referenceId = crypto.randomUUID().slice(0, 8);
      Sentry.captureException(error, { tags: { referenceId } });
      console.error(`[api-route] Unhandled error (ref: ${referenceId}):`, error);
      const isProd = process.env.NODE_ENV === "production";
      const message = isProd
        ? `Something went wrong on our end. Please try again, and include this reference if you contact support: ${referenceId}`
        : error instanceof Error
          ? error.message
          : "Internal server error";
      return jsonError(message, 500, undefined, referenceId);
    }
  });
}
