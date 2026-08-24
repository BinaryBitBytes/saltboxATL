import { authenticateUser } from "@/backend/server/auth-service";
import { jsonError, jsonOk } from "@/backend/server/http";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/token";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      identifier?: string;
      email?: string;
      username?: string;
      password?: string;
    };
    const identifier = body.identifier ?? body.email ?? body.username ?? "";
    const user = await authenticateUser(identifier, body.password ?? "");
    const response = jsonOk(user);
    response.cookies.set(SESSION_COOKIE, signSession(user), sessionCookieOptions());
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
