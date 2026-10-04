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

export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
