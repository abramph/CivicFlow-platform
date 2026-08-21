import { z } from "zod";

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "ValidationError";
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError("Validation failed", result.error.flatten());
  }

  return result.data;
}

export function jsonError(message: string, status = 400, details?: unknown, referenceId?: string): Response {
  return Response.json(
    {
      ok: false,
      error: message,
      ...(details ? { details } : {}),
      ...(referenceId ? { referenceId } : {}),
    },
    { status }
  );
}

export { z };
