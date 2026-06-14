import { withApiErrorHandling } from "@/lib/api-route";
import { requireRole } from "@/lib/auth-guards";
import { ValidationError } from "@/lib/validation";
import { runMigrationImport, type DesktopExport } from "@/lib/migration-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireRole("ORG_ADMIN", "throw");

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      throw new ValidationError("File too large (max 50 MB)");
    }

    let data: DesktopExport;
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        throw new ValidationError("No file provided");
      }
      if (file.size > MAX_BYTES) {
        throw new ValidationError("File too large (max 50 MB)");
      }
      const text = await file.text();
      data = JSON.parse(text) as DesktopExport;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError("Invalid JSON file");
    }

    if (data.schema !== "civicflow-desktop-export") {
      throw new ValidationError(
        "Unrecognized export format. Export the file from CivicFlow desktop (Settings → Export for Cloud Migration)."
      );
    }

    const counts = await runMigrationImport(organizationId, data);

    return Response.json({ ok: true, counts });
  });
}
