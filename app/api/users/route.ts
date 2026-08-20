import {
  createUserRecord,
  listPublicUsers,
  updateUserRecord,
} from "@/backend/server/auth-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiPermission("manageUsers");
    return jsonOk(await listPublicUsers());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiPermission("manageUsers");
    const body = await request.json();
    return jsonOk(await createUserRecord(body, actor.name), 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireApiPermission("manageUsers");
    const body = await request.json();
    return jsonOk(await updateUserRecord(body, actor.id));
  } catch (error) {
    return jsonError(error);
  }
}
