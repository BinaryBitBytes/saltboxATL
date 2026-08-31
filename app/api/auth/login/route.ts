import { authenticateUser } from "@/backend/server/auth-service";
import {
  authFailure,
  readRequestObject,
  requestWantsJson,
  sessionRedirect,
} from "@/backend/server/auth-http";
import { jsonOk } from "@/backend/server/http";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/token";

export async function POST(request: Request) {
  try {
    const body = await readRequestObject(request);
    const identifier = String(
      body.identifier ?? body.email ?? body.username ?? "",
    );
    const user = await authenticateUser(identifier, String(body.password ?? ""));
    if (requestWantsJson(request)) {
      const response = jsonOk(user);
      response.cookies.set(
        SESSION_COOKIE,
        signSession(user),
        sessionCookieOptions(),
      );
      return response;
    }
    return sessionRedirect(request, user, body.from);
  } catch (error) {
    return authFailure(request, error, "signin", "Unable to sign in.");
  }
}
