/**
 * Only allow same-origin redirects (prevents open-redirect attacks).
 * The value is resolved against the app origin exactly as a browser would, and
 * accepted only if it stays on that origin. Control characters are rejected
 * outright (browsers strip tabs/newlines, which enables "/\t/evil.com" tricks).
 */
export function safeCallbackUrl(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || typeof value !== "string" || value.length > 2048) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let resolved: URL;
  const appOrigin = new URL(process.env.APP_URL || "http://localhost:3010").origin;
  try {
    resolved = new URL(value, appOrigin);
  } catch {
    return fallback;
  }
  if (resolved.origin !== appOrigin) return fallback;
  const path = `${resolved.pathname}${resolved.search}`;
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (/^\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(path)) return fallback;
  return path;
}
