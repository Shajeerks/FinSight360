#!/usr/bin/env node
/**
 * Creates .env from .env.example with fresh random secrets.
 *   npm run setup:env                 (Docker PostgreSQL on port 5433)
 *   npm run setup:env -- --port 5432  (Homebrew / existing PostgreSQL)
 * Never overwrites an existing .env unless you pass --force.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const force = args.includes("--force");
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? args[portIdx + 1] : null;

if (existsSync(".env") && !force) {
  console.log("✓ .env already exists — leaving it unchanged (use --force to recreate).");
  process.exit(0);
}

let env = readFileSync(".env.example", "utf8");
const secret = () => randomBytes(32).toString("base64");
env = env.replace(/^AUTH_SECRET=""$/m, `AUTH_SECRET="${secret()}"`);
env = env.replace(/^TOKEN_ENCRYPTION_KEY=""$/m, `TOKEN_ENCRYPTION_KEY="${secret()}"`);
if (port) {
  if (!/^\d{2,5}$/.test(port)) {
    console.error("--port must be a number, e.g. --port 5432");
    process.exit(1);
  }
  env = env.replace(/@localhost:5433\//g, `@localhost:${port}/`);
}
writeFileSync(".env", env, { mode: 0o600 });
console.log(`✓ Created .env with new secrets${port ? ` (PostgreSQL port ${port})` : " (PostgreSQL port 5433)"}.`);
