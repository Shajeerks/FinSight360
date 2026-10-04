/**
 * Best-effort client IP for rate limiting and audit.
 *
 * Forwarding headers can be forged by the client unless a reverse proxy you
 * control overwrites them. So:
 *  - TRUST_PROXY=true  → use X-Real-IP, else the right-most X-Forwarded-For hop
 *    (your proxy must set/overwrite these).
 *  - otherwise         → only the right-most X-Forwarded-For hop, which Next.js
 *    fills from the socket when the client didn't send one. A client CAN still
 *    forge it, so IP limits are always backed by per-email and global limits.
 */
export function clientIpFromHeaders(h: Headers | undefined | null, trustProxy = process.env.TRUST_PROXY === "true"): string | null {
  if (!h) return null;
  if (trustProxy) {
    const real = h.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 64);
  }
  const xff = h.get("x-forwarded-for");
  if (!xff) return null;
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1].slice(0, 64) : null;
}
