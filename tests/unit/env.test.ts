import { describe, expect, it } from "vitest";
import { productionIssues } from "@/lib/env";

describe("productionIssues", () => {
  const good = { AUTH_SECRET: "k".repeat(44), TOKEN_ENCRYPTION_KEY: "x", APP_URL: "https://money.example.in", EMAIL_TRANSPORT: "smtp", TRUST_PROXY: "true" };

  it("passes a hardened configuration", () => {
    expect(productionIssues(good)).toEqual({ errors: [], warnings: [] });
  });

  it("blocks weak or placeholder secrets", () => {
    expect(productionIssues({ ...good, AUTH_SECRET: "short" }).errors).toHaveLength(1);
    expect(productionIssues({ ...good, AUTH_SECRET: "change-me-change-me-change-me-change-me" }).errors[0]).toMatch(/placeholder/);
  });

  it("warns about http, console mail, missing proxy trust and encryption key", () => {
    const w = productionIssues({ ...good, APP_URL: "http://money.example.in", EMAIL_TRANSPORT: "console", TRUST_PROXY: undefined, TOKEN_ENCRYPTION_KEY: undefined }).warnings;
    expect(w).toHaveLength(4);
    expect(productionIssues({ ...good, APP_URL: "http://localhost:3010" }).warnings).toHaveLength(0);
  });
});
