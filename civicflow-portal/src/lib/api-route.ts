import * as Sentry from "@sentry/nextjs";
import { ForbiddenError, UnauthenticatedError, OrganizationRequiredError, withForbiddenHandler } from "@/lib/auth-guards";
import { MobileAuthError, MobileForbiddenError } from "@/lib/mobile-auth";
import { ValidationError, jsonError } from "@/lib/validation";
import { PlanFeatureError, PlanLimitError } from "@/lib/plan-gate";
import { LabFeatureError } from "@/lib/labs/access";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { PtaError } from "@/lib/labs/pta/errors";
import { EventRsvpError } from "@/lib/event-rsvp";
import { HoaError } from "@/lib/hoa/errors";
import { ImportError } from "@/lib/imports/errors";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { SupportAssistantError } from "@/lib/support-assistant/errors";
import { MeetingMinutesError, meetingMinutesErrorResponse } from "@/lib/meeting-minutes";

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
      if (error instanceof HoaError) {
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
      if (error instanceof MobileAuthError || error instanceof MobileForbiddenError) {
        return jsonError(error.message, error.status);
      }
      Sentry.captureException(error);
      console.error("[api-route] Unhandled error:", error);
      const isProd = process.env.NODE_ENV === "production";
      const message = isProd
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Internal server error";
      return jsonError(message, 500);
    }
  });
}
