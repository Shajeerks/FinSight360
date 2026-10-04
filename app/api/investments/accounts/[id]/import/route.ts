import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES } from "@/lib/import/files";
import { limiters } from "@/lib/security/rate-limit";
import { importInvestmentFile } from "@/services/groww.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/investments/accounts/:id/import — multipart `file` (Groww holdings or
 * order-history XLSX/CSV). `commit=1` applies it; otherwise a preview is returned.
 * `removeMissing=0` keeps holdings that aren't in a holdings statement.
 */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  const rl = await limiters.upload.check(`upload:${user.id}`);
  if (!rl.allowed) throw new AppError(`Too many uploads. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`, 429, "RATE_LIMITED");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) throw new AppError("Upload the file as multipart/form-data.", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("Couldn't read the upload.", 400, "BAD_UPLOAD");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Choose the file exported from Groww.", 400, "NO_FILE", { file: ["Choose a file"] });
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  return ok(
    await importInvestmentFile(
      user.id,
      (await params).id,
      { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      { commit: form.get("commit") === "1", removeMissing: form.get("removeMissing") !== "0" },
      meta,
    ),
  );
});
