import { recoverUsername } from "@/backend/server/auth-service";
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
    const result = await recoverUsername(body);
    if (requestWantsJson(request)) {
      return jsonOk(result);
    }
    return authFormRedirect(request, "recover-username", {
      username: result.username,
    });
  } catch (error) {
    return authFailure(
      request,
      error,
      "recover-username",
      "Unable to recover that username.",
    );
  }
}
