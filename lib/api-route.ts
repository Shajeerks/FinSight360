import "server-only";
import { requireApiUser } from "@/lib/auth/session";
import { getRequestMeta } from "@/lib/security/request";
import { AppError } from "@/lib/errors";

/** Signed-in user + request metadata for API route handlers. */
export async function apiContext() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function readJson(req: Request): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new AppError("Send a JSON body (Content-Type: application/json).", 415, "UNSUPPORTED_MEDIA_TYPE");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("Malformed JSON body.", 400, "BAD_JSON");
  }
  // Every endpoint takes a JSON object; null / arrays / scalars are rejected up front.
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Send a JSON object.", 400, "BAD_JSON");
  return body;
}

export function searchParamsObject(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}
