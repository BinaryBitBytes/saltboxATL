import { Composio } from "@composio/core";

/** The signed-in user's agent may only discover and run this toolkit. */
export const COMPOSIO_AGENT_TOOLKITS = ["composio"] as const;

/**
 * Open a Composio session for one application user and return that session's
 * tools. `userId` is the signed-in user's id. The SDK reads COMPOSIO_API_KEY
 * from the environment.
 */
export async function composioToolsForAgent(userId: string) {
  const id = userId.trim();
  if (!id) {
    throw new Error("A signed-in user id is required for a Composio session.");
  }
  const composio = new Composio();
  const session = await composio.create(id, {
    toolkits: [...COMPOSIO_AGENT_TOOLKITS],
  });
  const tools = await session.tools();
  return { session, tools };
}
