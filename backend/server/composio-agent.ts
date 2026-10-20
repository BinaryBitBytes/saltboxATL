import "server-only";

import { requireUser } from "@/backend/server/dal";
import { composioToolsForAgent } from "@/lib/composio/agent-session";

/** Tools for the signed-in user, scoped to the composio toolkit. */
export async function composioToolsForCurrentUser() {
  const user = await requireUser();
  const { session, tools } = await composioToolsForAgent(user.id);
  return {
    userId: user.id,
    sessionId: session.sessionId,
    tools,
    session,
  };
}
