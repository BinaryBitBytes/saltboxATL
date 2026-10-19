import { describe, it } from "mocha";
import { expect } from "chai";
import {
  assessComposioSetup,
  classifyComposioFailure,
  executeComposioVision,
  maskApiKey,
} from "@/lib/documents/composio-vision";
import { EMBEDDED_NOTE, recognizePurchasePdf } from "@/lib/documents/recognize";

const PDF = new TextEncoder().encode("%PDF-1.4\ntrailer\n<<>>\n%%EOF\n");
const SECRET = "ak_test_value_1234";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withLogs<T>(work: () => Promise<T>): Promise<{ result: T; lines: string }> {
  const lines: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    const result = await work();
    return { result, lines: JSON.stringify(lines) };
  } finally {
    console.log = original;
  }
}

describe("Composio connection checks", () => {
  it("requires an API key and a real Vision parent before calling Composio", () => {
    const missing = assessComposioSetup({});
    expect(missing.apiKey).to.equal("missing");
    expect(missing.problems).to.include("COMPOSIO_API_KEY is missing.");
    expect(missing.problems.join(" ")).to.include("COMPOSIO_VISION_PARENT");
    expect(missing.parentIsPlaceholder).to.equal(true);

    const placeholder = assessComposioSetup({
      COMPOSIO_API_KEY: SECRET,
      COMPOSIO_VISION_PARENT: "projects/your-project/locations/us",
    });
    expect(placeholder.apiKey).to.equal("present");
    expect(placeholder.parentIsPlaceholder).to.equal(true);
    expect(placeholder.problems).to.deep.equal([
      "COMPOSIO_VISION_PARENT is still the example project.",
    ]);
    expect(placeholder.apiKeyHint).to.not.include(SECRET);
  });

  it("accepts a real parent and warns when the Vision account id is empty", () => {
    const setup = assessComposioSetup({
      COMPOSIO_API_KEY: SECRET,
      COMPOSIO_VISION_PARENT: "projects/warehouse-prod/locations/us",
      COMPOSIO_CONNECTED_ACCOUNT_ID: "",
    });
    expect(setup.problems).to.deep.equal([]);
    expect(setup.parentIsPlaceholder).to.equal(false);
    expect(setup.connectedAccountId).to.equal("missing");
    expect(setup.warnings.join(" ")).to.include("COMPOSIO_CONNECTED_ACCOUNT_ID");
    expect(maskApiKey(SECRET)).to.equal("ak_t…1234 (18 chars)");
  });

  it("treats HTTP 401 as an invalid API key", () => {
    const failure = classifyComposioFailure(401, {
      error: { message: "Invalid API key", status: 401 },
    });
    expect(failure.kind).to.equal("invalid-api-key");
    expect(failure.message).to.include("rejected the API key");
  });

  it("treats HTTP 403 as missing privileges", () => {
    const failure = classifyComposioFailure(403, {
      error: { message: "Forbidden", suggested_fix: "Ask an admin for access." },
    });
    expect(failure.kind).to.equal("privileges");
    expect(failure.message).to.include("privileges");
    expect(failure.message).to.include("Ask an admin");
  });

  it("treats HTTP 400 without a Vision connection as a missing connection, not a bad key", () => {
    const failure = classifyComposioFailure(400, {
      error: {
        message: "No connected account found for google_cloud_vision",
        status: 400,
      },
    });
    expect(failure.kind).to.equal("missing-connection");
    expect(failure.message).to.include("not an invalid API key");
    expect(failure.kind).to.not.equal("invalid-api-key");
  });

  it("treats other HTTP 400 responses as a bad request, not a bad key", () => {
    const failure = classifyComposioFailure(400, {
      error: { message: "Invalid parent resource", status: 400 },
    });
    expect(failure.kind).to.equal("bad-request");
    expect(failure.message).to.include("not an invalid API key");
    expect(failure.message).to.include("COMPOSIO_VISION_PARENT");
    expect(failure.message).to.include("Invalid parent resource");
  });

  it("logs a 400 from Composio without printing the API key", async () => {
    const { result, lines } = await withLogs(() =>
      executeComposioVision(
        PDF,
        "po.pdf",
        {
          apiKey: SECRET,
          parent: "projects/warehouse-prod/locations/us",
          userId: "saltbox-inbound",
        },
        async () =>
          jsonResponse(400, {
            error: { message: "Invalid parent resource", status: 400 },
          }),
      ),
    );
    expect(result.text).to.equal(null);
    expect(result.failure?.kind).to.equal("bad-request");
    expect(lines).to.include("[composio]");
    expect(lines).to.include("bad-request");
    expect(lines).to.include("not an invalid API key");
    expect(lines).to.not.include(SECRET);
  });

  it("logs an invalid key separately from a privileges refusal", async () => {
    const invalid = await executeComposioVision(PDF, "po.pdf", { apiKey: SECRET }, async () =>
      jsonResponse(401, { error: { message: "Invalid API key" } }),
    );
    expect(invalid.failure?.kind).to.equal("invalid-api-key");

    const denied = await executeComposioVision(PDF, "po.pdf", { apiKey: SECRET }, async () =>
      jsonResponse(403, { error: { message: "Insufficient permissions" } }),
    );
    expect(denied.failure?.kind).to.equal("privileges");
  });

  it("keeps the embedded PDF text and records the Composio failure on the note", async () => {
    const recognized = await recognizePurchasePdf(
      new TextEncoder().encode(
        "%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT (PO Number: PO-100) Tj ET\nendstream\nendobj\n%%EOF\n",
      ),
      {
        vision: async () => ({
          text: null,
          failure: {
            message:
              "HTTP 400 is a bad request, not an invalid API key. Invalid parent resource",
          },
        }),
      },
    );
    expect(recognized.source).to.equal("embedded-text");
    expect(recognized.purchaseOrderNumber).to.equal("PO-100");
    expect(recognized.note.startsWith(EMBEDDED_NOTE)).to.equal(true);
    expect(recognized.note).to.include("not an invalid API key");
  });
});
