import { requireApiUser } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    return jsonOk(await requireApiUser());
  } catch (error) {
    return jsonError(error);
  }
}
