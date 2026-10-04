import bcrypt from "bcryptjs";

/** bcrypt work factor. 12 ≈ 250ms on a modern laptop. */
export const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * Compares against a throwaway hash so a login for an unknown email takes the
 * same time as a real one (prevents user enumeration via timing).
 */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= bcrypt.hash(`dummy-${Math.random()}`, BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}

/** Password policy shared by registration, reset and change-password. */
export const PASSWORD_RULES = {
  minLength: 10,
  maxLength: 128,
} as const;

export function passwordPolicyErrors(pw: string): string[] {
  const errors: string[] = [];
  if (pw.length < PASSWORD_RULES.minLength) errors.push(`At least ${PASSWORD_RULES.minLength} characters`);
  if (pw.length > PASSWORD_RULES.maxLength) errors.push(`At most ${PASSWORD_RULES.maxLength} characters`);
  if (!/[a-z]/.test(pw)) errors.push("One lowercase letter");
  if (!/[A-Z]/.test(pw)) errors.push("One uppercase letter");
  if (!/[0-9]/.test(pw)) errors.push("One number");
  return errors;
}
