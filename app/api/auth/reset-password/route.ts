import { resetPasswordWithIdentity } from "@/backend/server/auth-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    await resetPasswordWithIdentity(body);
    return jsonOk({ reset: true });
  } catch (error) {
    return jsonError(error);
  }
}
