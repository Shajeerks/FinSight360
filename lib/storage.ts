import "server-only";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function saveFile(userId: string, buffer: Buffer, extension: string): Promise<string> {
  const fileHash = sha256(buffer);
  const fileName = `${fileHash}.${extension}`;
  const dirPath = path.join(process.cwd(), "storage", "attachments", userId);
  await mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, fileName);
  await writeFile(filePath, buffer);
  return `attachments/${userId}/${fileName}`;
}
