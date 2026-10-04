import { z } from "zod";

/**
 * Server-side environment, validated once at startup.
 * Never import this file from client components.
 */
const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be set (openssl rand -base64 32)"),
  APP_URL: z.string().url().default("http://localhost:3010"),
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().positive().max(24 * 90).default(168),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("FinSight360 <no-reply@finsight360.local>"),
  REQUIRE_EMAIL_VERIFICATION: boolish,
  /** Where uploaded statements are kept (outside the web root; gitignored). */
  STORAGE_DIR: z.string().default("./storage"),
  ALLOW_REGISTRATION: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nCheck your .env file (see .env.example).`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Production readiness problems. Errors stop the server from starting in
 * production; warnings are logged. (Development is never blocked.)
 */
export function productionIssues(e: Record<string, string | undefined> = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if ((e.AUTH_SECRET ?? "").length < 32) errors.push("AUTH_SECRET must be at least 32 characters (run: openssl rand -base64 32).");
  if (/change[-_]?me|example|secret123/i.test(e.AUTH_SECRET ?? "")) errors.push("AUTH_SECRET still looks like a placeholder.");
  if (!e.TOKEN_ENCRYPTION_KEY) warnings.push("TOKEN_ENCRYPTION_KEY is not set — email inbox connections are disabled.");
  const appUrl = e.APP_URL ?? "";
  if (appUrl && !appUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(appUrl)) warnings.push("APP_URL is not https — sign-in cookies and links should use HTTPS in production.");
  if (e.EMAIL_TRANSPORT !== "smtp") warnings.push("EMAIL_TRANSPORT is not smtp — password-reset and notification emails are not delivered.");
  if (e.TRUST_PROXY !== "true") warnings.push("TRUST_PROXY is not true — behind a reverse proxy, rate limits apply per proxy instead of per client.");
  return { errors, warnings };
}

export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
