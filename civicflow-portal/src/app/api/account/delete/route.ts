import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { deleteUserAccount } from "@/lib/account-deletion";

/**
 * Authenticated in-app deletion — Profile/Settings -> Account -> Delete
 * Account. Requires BOTH the current password AND typing the literal word
 * "DELETE" (case-insensitive), matching the DisableMfaForm-style
 * password-confirmation pattern already used for other irreversible
 * account actions in this app, plus the explicit "no single-tap deletion"
 * requirement.
 */
const deleteSchema = z.object({
  password: z.string().min(1),
  confirmText: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const input = await parseJsonBody(request, deleteSchema);
    if (input.confirmText.trim().toUpperCase() !== "DELETE") {
      throw new ValidationError('Type "DELETE" to confirm.');
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });
    if (!user) return Response.json({ ok: false, error: "Account not found." }, { status: 404 });

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      throw new ValidationError("Incorrect password.");
    }

    const result = await deleteUserAccount({ userId: session.userId });
    return Response.json({ ok: true, result });
  });
}
