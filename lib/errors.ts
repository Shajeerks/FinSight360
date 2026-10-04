/** Application errors that are safe to show to users. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "BAD_REQUEST",
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, 404, "NOT_FOUND");
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, 429, "RATE_LIMITED");
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: Record<string, string[]>, message = "Please correct the highlighted fields.") {
    super(message, 422, "VALIDATION_ERROR", fieldErrors);
  }
}

/** Result shape returned by server actions to client forms. */
export type ActionResult<T = void> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
