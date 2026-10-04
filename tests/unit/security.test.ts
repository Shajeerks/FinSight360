import { describe, expect, it } from "vitest";
import { hashPassword, passwordPolicyErrors, verifyAgainstDummy, verifyPassword } from "@/lib/security/password";
import { generateToken, sha256, safeEqual } from "@/lib/security/tokens";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { safeCallbackUrl } from "@/features/auth/callback-url";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import { boolField, pageNumber } from "@/validators/common";

describe("request helpers", () => {
  it("uses the proxy-appended (right-most) forwarded IP, not the client-supplied one", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
    // X-Real-IP is only trusted behind a reverse proxy we control (TRUST_PROXY=true).
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }), true)).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }), false)).toBe("6.6.6.6");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
  it("parses booleans and page numbers safely", () => {
    expect(boolField.parse("false")).toBe(false);
    expect(boolField.parse("true")).toBe(true);
    expect(boolField.parse(true)).toBe(true);
    expect(boolField.parse(undefined)).toBe(false);
    expect(pageNumber("1.3")).toBe(1);
    expect(pageNumber("abc")).toBe(1);
    expect(pageNumber(["3"])).toBe(3);
  });
});

describe("password hashing", () => {
  it("never stores plain text and verifies correctly", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(hash).not.toContain("Correct-Horse-9");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword("Correct-Horse-9", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyAgainstDummy("anything")).toBe(false);
  }, 20_000);

  it("enforces the password policy", () => {
    expect(passwordPolicyErrors("short")).not.toHaveLength(0);
    expect(passwordPolicyErrors("alllowercase1")).toContain("One uppercase letter");
    expect(passwordPolicyErrors("Good-Password1")).toHaveLength(0);
  });
});

describe("tokens", () => {
  it("are random, url-safe and stored only as hashes", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256(a)).toHaveLength(64);
    expect(safeEqual(sha256(a), sha256(a))).toBe(true);
    expect(safeEqual(sha256(a), sha256(b))).toBe(false);
  });
});

describe("AES-256-GCM secret encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("round-trips and uses a fresh IV", () => {
    const c1 = encryptSecret("ya29.oauth-access-token", key);
    const c2 = encryptSecret("ya29.oauth-access-token", key);
    expect(c1).not.toBe(c2);
    expect(c1).not.toContain("oauth");
    expect(decryptSecret(c1, key)).toBe("ya29.oauth-access-token");
  });
  it("detects tampering and wrong keys", () => {
    const c = encryptSecret("secret", key);
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(c, Buffer.alloc(32, 9).toString("base64"))).toThrow();
    expect(() => encryptSecret("x", "short")).toThrow(/32 bytes/);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", async () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t = 1_000_000;
    expect((await rl.check("k", t)).allowed).toBe(true);
    expect((await rl.check("k", t)).allowed).toBe(true);
    expect((await rl.check("k", t)).allowed).toBe(true);
    const blocked = await rl.check("k", t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect((await rl.check("other", t)).allowed).toBe(true);
    expect((await rl.check("k", t + 1001)).allowed).toBe(true);
  });
});

describe("log redaction", () => {
  it("removes sensitive keys from log context", () => {
    const out = logger.redact({ email: "a@b.c", password: "x", nested: { accessToken: "t", amount: 1250, cardNumber: "4111" } }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).accessToken).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).amount).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).cardNumber).toBe("[redacted]");
    expect(out.email).toBe("a@b.c");
  });
});

describe("callback URL sanitizing (open-redirect protection)", () => {
  it("allows only same-site relative paths", () => {
    expect(safeCallbackUrl("/credit-cards?x=1")).toBe("/credit-cards?x=1");
    expect(safeCallbackUrl("https://evil.example/phish")).toBe("/dashboard");
    expect(safeCallbackUrl("//evil.example")).toBe("/dashboard");
    expect(safeCallbackUrl("/\\evil.example")).toBe("/dashboard");
    expect(safeCallbackUrl("http://localhost:3010/loans")).toBe("/loans");
    expect(safeCallbackUrl("/login")).toBe("/dashboard");
    expect(safeCallbackUrl(undefined)).toBe("/dashboard");
    // Browsers strip tabs/newlines: "/\t/evil.com" would become "//evil.com"
    expect(safeCallbackUrl("/\t/evil.com")).toBe("/dashboard");
    expect(safeCallbackUrl("/\n/evil.com")).toBe("/dashboard");
    expect(safeCallbackUrl(decodeURIComponent("/%09/evil.com"))).toBe("/dashboard");
    expect(safeCallbackUrl("https://localhost:3010.evil.com/x")).toBe("/dashboard");
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/dashboard");
  });
});
