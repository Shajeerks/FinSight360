import "server-only";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// Vercel's filesystem is read-only except the temp folder.
const STORAGE_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), "finsight360-storage")
  : path.resolve(process.env.STORAGE_DIR || "./storage");

export async function saveFile(userId: string, buffer: Buffer, extension: string): Promise<string> {
  const fileHash = sha256(buffer);
  const fileName = `${fileHash}.${extension}`;
  const dirPath = path.join(STORAGE_ROOT, "attachments", userId);
  await mkdir(dirPath, { recursive: true });
  await writeFile(path.join(dirPath, fileName), buffer);
  return `attachments/${userId}/${fileName}`;
}
