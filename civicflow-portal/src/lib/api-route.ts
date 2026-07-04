import * as Sentry from "@sentry/nextjs";
import { ForbiddenError, withForbiddenHandler } from "@/lib/auth-guards";
import { MobileAuthError, MobileForbiddenError } from "@/lib/mobile-auth";
import { ValidationError, jsonError } from "@/lib/validation";
import { PlanLimitError } from "@/lib/plan-gate";

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
      if (error instanceof PlanLimitError) {
        return jsonError(error.message, error.status);
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
