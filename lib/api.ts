import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, ValidationError, type ActionResult } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(zodFieldErrors(result.error));
  return result.data;
}

/** Convert any thrown error into a safe, user-facing shape. Stack traces never leave the server. */
export function toSafeError(error: unknown): { status: number; body: { error: { code: string; message: string; fieldErrors?: Record<string, string[]> } } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } } };
  }
  if (error instanceof ZodError) {
    return { status: 422, body: { error: { code: "VALIDATION_ERROR", message: "Invalid input.", fieldErrors: zodFieldErrors(error) } } };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { status: 409, body: { error: { code: "CONFLICT", message: "This record already exists." } } };
    // Value too long / out of range for its column → the input was invalid, not a server fault.
    if (error.code === "P2000" || error.code === "P2020") return { status: 422, body: { error: { code: "VALIDATION_ERROR", message: "A value is too long or out of range." } } };
    if (error.code === "P2025") return { status: 404, body: { error: { code: "NOT_FOUND", message: "Record not found." } } };
  }
  logger.error("unhandled_error", { error });
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } } };
}

type RouteHandler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps API route handlers with consistent error handling. */
/**
 * CSRF defence for cookie-authenticated API calls: state-changing requests must
 * come from our own origin (browsers always send Origin on cross-site POST/PATCH/DELETE).
 */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, scripts) don't send Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) throw new AppError("Cross-site request blocked.", 403, "CSRF");
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Server-action arguments are client-controlled data, not typed values. Any id
 * that reaches Prisma must be a plain id string — an object such as {not: "x"}
 * would otherwise be treated as a filter. `null` is allowed (e.g. "create").
 */
export function assertIds(...values: unknown[]) {
  for (const v of values) {
    if (v === null) continue;
    if (Array.isArray(v)) {
      assertIds(...v);
      continue;
    }
    if (typeof v !== "string" || !ID_RE.test(v)) throw new AppError("Invalid id.", 400, "INVALID_ID");
  }
}

export function assertBool(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new AppError("Invalid value.", 400, "INVALID_INPUT");
}

export function apiHandler<C = unknown>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (error) {
      const { status, body } = toSafeError(error);
      return NextResponse.json(body, { status });
    }
  };
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

/** Wraps server actions: returns ActionResult instead of throwing. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (error) {
    // Let Next.js redirects/notFound propagate.
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw error;
    }
    const { body } = toSafeError(error);
    return { ok: false, error: body.error.message, fieldErrors: body.error.fieldErrors };
  }
}
