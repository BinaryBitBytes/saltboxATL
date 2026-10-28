import type { InventorySystem, PublicUser } from "@/lib/inventory-schema";
import { toPublicUser } from "@/lib/validation/user-security";

/**
 * Restore the account for a valid session id.
 * A store failure (missing column, bad payload, or a brief outage) returns
 * null so the sign-in page can still render. The session cookie is left in
 * place and starts working again when the store recovers.
 */
export async function restoreSessionAccount(
  userId: string,
  read: () => Promise<InventorySystem>,
): Promise<PublicUser | null> {
  try {
    const system = await read();
    const user = system.users.find((entry) => entry.id === userId);
    if (!user || !user.isActive) return null;
    return toPublicUser(user);
  } catch (error) {
    console.error("Could not restore the signed-in account.", error);
    return null;
  }
}
