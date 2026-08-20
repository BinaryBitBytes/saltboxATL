import {
  lookupInventoryByCode,
  ServiceError,
} from "@/backend/server/inventory-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code")?.trim();
    if (!code) {
      throw new ServiceError("Query parameter `code` is required.");
    }
    return jsonOk(await lookupInventoryByCode(code));
  } catch (error) {
    return jsonError(error);
  }
}
