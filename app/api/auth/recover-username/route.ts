import { recoverUsername } from "@/backend/server/auth-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    return jsonOk(await recoverUsername(body));
  } catch (error) {
    return jsonError(error);
  }
}
