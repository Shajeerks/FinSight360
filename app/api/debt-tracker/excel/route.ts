import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES } from "@/lib/import/files";
import { limiters } from "@/lib/security/rate-limit";
import { commitDebtExcel, previewDebtExcel } from "@/services/debt-tracker.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/debt-tracker/excel
 *  - multipart `file` (.xlsx / .csv): read the monthly or financial-year debt sheet and suggest lenders (nothing saved)
 *  - JSON { rows, mapping, overwrite, dueDays, incomes }: save the checked rows as entered figures
 */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("application/json")) {
    return ok(await commitDebtExcel(user.id, await readJson(req), meta));
  }
  const rl = await limiters.upload.check(`upload:${user.id}`);
  if (!rl.allowed) throw new AppError(`Too many uploads. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`, 429, "RATE_LIMITED");
  if (!type.startsWith("multipart/form-data")) throw new AppError("Upload the file as multipart/form-data.", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("Couldn't read the upload.", 400, "BAD_UPLOAD");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Choose your Excel file.", 400, "NO_FILE", { file: ["Choose a file"] });
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new AppError("Upload the workbook as .xlsx (Excel Workbook), or a CSV of the financial-year sheet.", 400, "BAD_FILE");
  return ok(await previewDebtExcel(user.id, Buffer.from(await file.arrayBuffer()), file.name));
});
