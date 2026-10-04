/**
 * Fixed-window rate limiter.
 *
 * The in-memory store is correct for a single Node process (local / single
 * server). For multi-instance deployments implement `RateLimitStore` with
 * Redis or Postgres and pass it to `createRateLimiter`.
 */
export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
  reset(key: string): Promise<void>;
  /** Remove every bucket (used by tests). */
  clear?(): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number, now: number) {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
      this.sweep(now);
      return bucket;
    }
    existing.count += 1;
    return existing;
  }

  async reset(key: string) {
    this.buckets.delete(key);
  }

  async clear() {
    this.buckets.clear();
  }

  private sweep(now: number) {
    if (this.buckets.size < 5000) return;
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function createRateLimiter(opts: { limit: number; windowMs: number; store?: RateLimitStore }) {
  const store = opts.store ?? new MemoryRateLimitStore();
  return {
    async check(key: string, now = Date.now()): Promise<RateLimitResult> {
      const { count, resetAt } = await store.increment(key, opts.windowMs, now);
      return {
        allowed: count <= opts.limit,
        remaining: Math.max(0, opts.limit - count),
        retryAfterSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
      };
    },
    reset: (key: string) => store.reset(key),
    clear: () => store.clear?.() ?? Promise.resolve(),
  };
}

const globalLimiters = globalThis as unknown as {
  __fsLimiters?: Record<string, ReturnType<typeof createRateLimiter>>;
};
globalLimiters.__fsLimiters ??= {};

/** Shared limiters (survive dev hot-reload). */
export const limiters = {
  /** 10 login attempts per 15 minutes per email+IP. */
  login: (globalLimiters.__fsLimiters.login ??= createRateLimiter({ limit: 10, windowMs: 15 * 60_000 })),
  /** 30 login attempts per 15 minutes per email (regardless of IP). */
  loginEmail: (globalLimiters.__fsLimiters.loginEmail ??= createRateLimiter({ limit: 30, windowMs: 15 * 60_000 })),
  /** 5 registrations per hour per IP. */
  register: (globalLimiters.__fsLimiters.register ??= createRateLimiter({ limit: 5, windowMs: 60 * 60_000 })),
  /** 5 password-reset / verification emails per hour per email. */
  email: (globalLimiters.__fsLimiters.email ??= createRateLimiter({ limit: 5, windowMs: 60 * 60_000 })),
  /** Ceiling on sign-ups across ALL clients (IP headers can be forged). */
  registerGlobal: (globalLimiters.__fsLimiters.registerGlobal ??= createRateLimiter({ limit: 30, windowMs: 60 * 60_000 })),
  /** Manual mailbox syncs per user. */
  emailSync: (globalLimiters.__fsLimiters.emailSync ??= createRateLimiter({ limit: 6, windowMs: 5 * 60_000 })),
  /** Statement uploads per user (also caps PDF password guessing). */
  upload: (globalLimiters.__fsLimiters.upload ??= createRateLimiter({ limit: 30, windowMs: 60 * 60_000 })),
};
