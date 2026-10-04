import "server-only";
import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/security/client-ip";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** Client IP + user agent for audit logs / rate limiting (best effort). */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const ip = clientIpFromHeaders(h);
    return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}
