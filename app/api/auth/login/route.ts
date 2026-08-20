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
      email?: string;
      password?: string;
    };
    const user = await authenticateUser(body.email ?? "", body.password ?? "");
    const response = jsonOk(user);
    response.cookies.set(SESSION_COOKIE, signSession(user), sessionCookieOptions());
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
