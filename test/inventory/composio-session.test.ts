import { describe, it } from "mocha";
import { expect } from "chai";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
import {
  COMPOSIO_AGENT_TOOLKITS,
  composioToolsForAgent,
} from "@/lib/composio/agent-session";

const coordinator = DEMO_ACCOUNTS.find((account) => account.role === "coordinator");

describe("Composio agent session", () => {
  it("gives the signed-in user only the composio toolkit and runs one tool", async function () {
    this.timeout(20_000);
    if (!process.env.COMPOSIO_API_KEY || !coordinator) {
      this.skip();
    }
    const { session, tools } = await composioToolsForAgent(coordinator.id);
    expect(COMPOSIO_AGENT_TOOLKITS).to.deep.equal(["composio"]);
    expect(session.config.toolkits).to.deep.equal({ enabled: ["composio"] });
    expect(session.sessionId).to.be.a("string").and.not.empty;
    const names = tools.map((tool) => {
      const record = tool as { function?: { name?: string } };
      return record.function?.name;
    });
    expect(names).to.include("COMPOSIO_MANAGE_CONNECTIONS");
    const result = await session.executeMeta("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: [{ name: "composio", action: "list" }],
    });
    expect(result.resultType).to.equal("completed");
    expect(result.logId).to.be.a("string").and.not.empty;
    expect(result.error).to.equal(null);
    const results = (result.data as { results?: Record<string, { status?: string }> }).results;
    expect(results?.composio?.status).to.equal("active");
  });
});
