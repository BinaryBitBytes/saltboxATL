import { resetPasswordWithIdentity } from "@/backend/server/auth-service";
import {
  authFailure,
  authFormRedirect,
  readRequestObject,
  requestWantsJson,
} from "@/backend/server/auth-http";
import { jsonOk } from "@/backend/server/http";

export async function POST(request: Request) {
  try {
    const body = await readRequestObject(request);
    await resetPasswordWithIdentity(body);
    if (requestWantsJson(request)) {
      return jsonOk({ reset: true });
    }
    return authFormRedirect(request, "signin", { reset: true });
  } catch (error) {
    return authFailure(
      request,
      error,
      "reset-password",
      "Unable to reset that password.",
    );
  }
}
