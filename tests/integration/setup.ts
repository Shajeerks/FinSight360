import "dotenv/config";

/**
 * Integration tests run against a SEPARATE database (DATABASE_URL_TEST) that is
 * wiped between test files. They never touch your real FinSight360 data.
 */
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST is not set. Add it to .env (see .env.example) to run integration tests.");
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_TEST must point to a different database than DATABASE_URL.");
}
process.env.DATABASE_URL = testUrl;
process.env.APP_URL = "http://localhost:3010";
process.env.ALLOW_REGISTRATION = "true";
process.env.REQUIRE_EMAIL_VERIFICATION = "false";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Uploaded statements from tests go to a throwaway folder, never ./storage.
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "finsight360-test-storage-"));

// OAuth tokens are encrypted at rest; tests use a throwaway key.
import { randomBytes } from "node:crypto";
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
