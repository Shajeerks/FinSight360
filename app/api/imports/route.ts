import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { limiters } from "@/lib/security/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/import/files";
import { createImport, listImports } from "@/services/import.service";

export const dynamic = "force-dynamic";

/** GET /api/imports — import history. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listImports(user.id));
});

/**
 * POST /api/imports — multipart upload: `file` (CSV / XLSX / PDF ≤ 10 MB),
 * `account` ("bank:<id>" | "card:<id>"), optional `password` for a protected PDF
 * (used once in memory, never stored or logged).
 */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const rl = await limiters.upload.check(`upload:${user.id}`);
  if (!rl.allowed) throw new AppError(`Too many uploads. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`, 429, "RATE_LIMITED");
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) throw new AppError("Upload the file as multipart/form-data.", 415, "UNSUPPORTED_MEDIA_TYPE");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("Couldn't read the upload.", 400, "BAD_UPLOAD");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Choose a statement file.", 400, "NO_FILE", { file: ["Choose a file"] });
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  const password = form.get("password");
  const result = await createImport(
    user.id,
    {
      file: { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) },
      account: form.get("account"),
      password: typeof password === "string" && password ? password.slice(0, 128) : null,
    },
    meta,
  );
  return ok(result, { status: 201 });
});
