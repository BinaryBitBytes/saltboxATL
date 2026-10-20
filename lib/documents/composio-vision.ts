/**
 * Composio image recognition for inbound PDFs.
 * Default tool: Google Cloud Vision file annotation (DOCUMENT_TEXT_DETECTION),
 * which reads scanned purchase orders and invoices. Embedded PDF text is used
 * when Composio is not configured or the call does not return text.
 */

const EXECUTE_URL = "https://backend.composio.dev/api/v3.1/tools/execute";
const CONSUMER_MCP_URL = "https://connect.composio.dev/mcp";
const DEFAULT_SLUG = "GOOGLE_CLOUD_VISION_ANNOTATE_FILES";
const DEFAULT_PARENT = "projects/saltbox/locations/us";
const DEFAULT_USER = "saltbox-inbound";

export type ComposioVisionEnv = {
  apiKey?: string;
  userId?: string;
  parent?: string;
  toolSlug?: string;
  connectedAccountId?: string;
};

export type ComposioFailureKind =
  | "missing-api-key"
  | "invalid-api-key"
  | "privileges"
  | "missing-connection"
  | "bad-request"
  | "unavailable";

export type ComposioFailure = {
  kind: ComposioFailureKind;
  status: number | null;
  message: string;
};

export type ComposioVisionResult = {
  text: string | null;
  failure: ComposioFailure | null;
};

export type ComposioKeyKind = "missing" | "consumer" | "user" | "project";

export type ComposioSetupReport = {
  apiKey: "missing" | "present";
  apiKeyHint: string;
  apiKeyKind: ComposioKeyKind;
  userId: string;
  parent: string;
  parentIsPlaceholder: boolean;
  toolSlug: string;
  connectedAccountId: "missing" | "present";
  problems: string[];
  warnings: string[];
};

const PLACEHOLDER_PARENTS = new Set([
  "projects/saltbox/locations/us",
  "projects/your-project/locations/us",
  "projects/your-gcp-project/locations/us",
]);

export function composioVisionEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): ComposioVisionEnv {
  return {
    apiKey: env.COMPOSIO_API_KEY?.trim() || undefined,
    userId: env.COMPOSIO_USER_ID?.trim() || DEFAULT_USER,
    parent: env.COMPOSIO_VISION_PARENT?.trim() || DEFAULT_PARENT,
    toolSlug: env.COMPOSIO_VISION_TOOL_SLUG?.trim() || DEFAULT_SLUG,
    connectedAccountId: env.COMPOSIO_CONNECTED_ACCOUNT_ID?.trim() || undefined,
  };
}

export function composioVisionArguments(
  bytes: Uint8Array,
  fileName: string,
  env: ComposioVisionEnv,
): Record<string, unknown> {
  const slug = (env.toolSlug || DEFAULT_SLUG).toUpperCase();
  const content = Buffer.from(bytes).toString("base64");
  const safeName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  if (slug.startsWith("ENCODIAN_")) {
    return {
      FileName: safeName,
      FileContent: {
        name: safeName,
        mimetype: "application/pdf",
        content,
      },
      ocrLanguage: "English",
      RotateConfidenceLevel: 60,
    };
  }
  return {
    parent: env.parent || DEFAULT_PARENT,
    requests: [
      {
        inputConfig: {
          content,
          mimeType: "application/pdf",
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        pages: [1, 2, 3, 4, 5],
      },
    ],
  };
}

export function composioKeyKind(apiKey: string | undefined): ComposioKeyKind {
  if (!apiKey) return "missing";
  if (apiKey.startsWith("ck_")) return "consumer";
  if (apiKey.startsWith("uak_")) return "user";
  return "project";
}

export function composioAuthHeaders(apiKey: string): Record<string, string> {
  const kind = composioKeyKind(apiKey);
  if (kind === "consumer") return { "x-consumer-api-key": apiKey };
  if (kind === "user") return { "x-user-api-key": apiKey };
  return { "x-api-key": apiKey };
}

export function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) return "missing";
  if (apiKey.length <= 8) return `set (${apiKey.length} chars)`;
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (${apiKey.length} chars)`;
}

export function composioErrorText(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error.slice(0, 500);
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const parts = [details.message, details.slug, details.suggested_fix].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    if (parts.length > 0) return parts.join(" — ").slice(0, 500);
  }
  if (typeof record.message === "string") return record.message.slice(0, 500);
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * HTTP 401 is an invalid API key. HTTP 403 is a privileges refusal.
 * HTTP 400 is a bad request or a missing Vision connection, not a bad key.
 */
export function classifyComposioFailure(
  status: number,
  body: unknown,
): ComposioFailure {
  const detail = composioErrorText(body).replace(/\s+/g, " ").trim();
  const haystack = detail.toLowerCase();
  if (
    status === 401 ||
    haystack.includes("invalid api key") ||
    haystack.includes("invalid x-api-key") ||
    haystack.includes("unauthorized")
  ) {
    if (haystack.includes("ck_") || haystack.includes("consumer")) {
      return {
        kind: "invalid-api-key",
        status,
        message:
          "Composio rejected this Connect consumer key (ck_). Copy the current key from For You, Settings, Sessions and API Key. A project API key starts with ak_ and is a different credential.",
      };
    }
    return {
      kind: "invalid-api-key",
      status,
      message: detail
        ? `Composio rejected the API key (HTTP ${status}): ${detail}`
        : `Composio rejected the API key (HTTP ${status}).`,
    };
  }
  if (
    status === 403 ||
    haystack.includes("forbidden") ||
    haystack.includes("permission") ||
    haystack.includes("not authorized") ||
    haystack.includes("insufficient")
  ) {
    return {
      kind: "privileges",
      status,
      message: detail
        ? `Composio refused this key's privileges (HTTP ${status}): ${detail}`
        : `Composio refused this key's privileges (HTTP ${status}).`,
    };
  }
  if (
    status === 400 &&
    (haystack.includes("connected account") ||
      haystack.includes("no active connection") ||
      haystack.includes("not connected") ||
      haystack.includes("connection"))
  ) {
    return {
      kind: "missing-connection",
      status,
      message:
        `HTTP 400 is a missing Google Cloud Vision connection, not an invalid API key. ${detail}`.trim(),
    };
  }
  if (status === 400) {
    return {
      kind: "bad-request",
      status,
      message:
        `HTTP 400 is a bad request, not an invalid API key. Check COMPOSIO_VISION_PARENT and the Vision tool arguments. ${detail}`.trim(),
    };
  }
  return {
    kind: "unavailable",
    status,
    message: detail
      ? `Composio image recognition was unavailable (HTTP ${status}): ${detail}`
      : `Composio image recognition was unavailable (HTTP ${status}).`,
  };
}

export function assessComposioSetup(
  env: Record<string, string | undefined> = process.env,
): ComposioSetupReport {
  const config = composioVisionEnvFromProcess(env as NodeJS.ProcessEnv);
  const parent = config.parent || DEFAULT_PARENT;
  const parentIsPlaceholder =
    PLACEHOLDER_PARENTS.has(parent) ||
    parent.includes("your-project") ||
    parent.includes("your-gcp-project");
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!config.apiKey) problems.push("COMPOSIO_API_KEY is missing.");
  if (parentIsPlaceholder) {
    problems.push("COMPOSIO_VISION_PARENT is still the example project.");
  }
  if (!config.connectedAccountId) {
    warnings.push(
      "COMPOSIO_CONNECTED_ACCOUNT_ID is empty. Set it when more than one Google Cloud Vision account is connected.",
    );
  }
  return {
    apiKey: config.apiKey ? "present" : "missing",
    apiKeyHint: maskApiKey(config.apiKey),
    apiKeyKind: composioKeyKind(config.apiKey),
    userId: config.userId || DEFAULT_USER,
    parent,
    parentIsPlaceholder,
    toolSlug: config.toolSlug || DEFAULT_SLUG,
    connectedAccountId: config.connectedAccountId ? "present" : "missing",
    problems,
    warnings,
  };
}

export function textFromVisionPayload(payload: unknown): string {
  const full: string[] = [];
  const paragraphs: string[] = [];
  walkVision(payload, full, paragraphs, new Set());
  if (full.length > 0) {
    return full.sort((left, right) => right.length - left.length)[0] ?? "";
  }
  return paragraphs.join("\n");
}

export async function executeComposioVision(
  bytes: Uint8Array,
  fileName: string,
  env: ComposioVisionEnv = composioVisionEnvFromProcess(),
  fetchImpl: typeof fetch = fetch,
): Promise<ComposioVisionResult> {
  const setup = assessComposioSetup({
    COMPOSIO_API_KEY: env.apiKey,
    COMPOSIO_USER_ID: env.userId,
    COMPOSIO_VISION_PARENT: env.parent,
    COMPOSIO_VISION_TOOL_SLUG: env.toolSlug,
    COMPOSIO_CONNECTED_ACCOUNT_ID: env.connectedAccountId,
  });
  if (!env.apiKey) {
    const failure: ComposioFailure = {
      kind: "missing-api-key",
      status: null,
      message: "COMPOSIO_API_KEY is missing.",
    };
    console.log("[composio]", { step: "skipped", ...failure, setup });
    return { text: null, failure };
  }
  if (composioKeyKind(env.apiKey) === "consumer") {
    return executeConsumerVision(bytes, fileName, env, fetchImpl, setup);
  }
  const slug = env.toolSlug || DEFAULT_SLUG;
  const args = composioVisionArguments(bytes, fileName, env);
  const authHeaders = composioAuthHeaders(env.apiKey);
  console.log("[composio]", {
    step: "request",
    url: `${EXECUTE_URL}/${slug}`,
    transport: "project-api",
    authHeader: Object.keys(authHeaders)[0],
    userId: env.userId || DEFAULT_USER,
    parent: env.parent || DEFAULT_PARENT,
    toolSlug: slug,
    apiKey: setup.apiKeyHint,
    apiKeyKind: setup.apiKeyKind,
    connectedAccount: setup.connectedAccountId,
    argumentKeys: Object.keys(args),
    problems: setup.problems,
    warnings: setup.warnings,
  });
  const response = await fetchImpl(`${EXECUTE_URL}/${slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      user_id: env.userId || DEFAULT_USER,
      ...(env.connectedAccountId
        ? { connected_account_id: env.connectedAccountId }
        : {}),
      arguments: args,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let payload: unknown = raw;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = raw;
    }
  } else {
    payload = null;
  }
  if (!response.ok) {
    const failure = classifyComposioFailure(response.status, payload);
    console.log("[composio]", {
      step: "response",
      status: response.status,
      kind: failure.kind,
      message: failure.message,
      apiKey: setup.apiKeyHint,
    });
    return { text: null, failure };
  }
  if (
    payload &&
    typeof payload === "object" &&
    "successful" in payload &&
    (payload as { successful?: unknown }).successful === false
  ) {
    const reported = statusFromBody(payload, 400);
    const failure = classifyComposioFailure(reported, payload);
    console.log("[composio]", {
      step: "response",
      status: response.status,
      kind: failure.kind,
      message: failure.message,
      apiKey: setup.apiKeyHint,
    });
    return { text: null, failure };
  }
  const text = textFromVisionPayload(payload).trim();
  console.log("[composio]", {
    step: "response",
    status: response.status,
    kind: text ? "ok" : "empty-text",
    characters: text.length,
    apiKey: setup.apiKeyHint,
  });
  return { text: text || null, failure: null };
}

async function executeConsumerVision(
  bytes: Uint8Array,
  fileName: string,
  env: ComposioVisionEnv,
  fetchImpl: typeof fetch,
  setup: ComposioSetupReport,
): Promise<ComposioVisionResult> {
  const slug = env.toolSlug || DEFAULT_SLUG;
  const args = composioVisionArguments(bytes, fileName, env);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...composioAuthHeaders(env.apiKey ?? ""),
  };
  console.log("[composio]", {
    step: "request",
    url: CONSUMER_MCP_URL,
    transport: "consumer-mcp",
    authHeader: "x-consumer-api-key",
    userId: env.userId || DEFAULT_USER,
    parent: env.parent || DEFAULT_PARENT,
    toolSlug: slug,
    apiKey: setup.apiKeyHint,
    apiKeyKind: setup.apiKeyKind,
    connectedAccount: setup.connectedAccountId,
    argumentKeys: Object.keys(args),
    problems: setup.problems,
    warnings: setup.warnings,
  });
  const initialized = await fetchImpl(CONSUMER_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "saltbox", version: "0.1.0" },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const initPayload = await readMcpPayload(initialized);
  if (!initialized.ok) {
    const failure = classifyComposioFailure(initialized.status, initPayload);
    if (initialized.status === 401) {
      failure.kind = "invalid-api-key";
      failure.message =
        "Composio rejected this Connect consumer key (ck_). Copy the current key from For You, Settings, Sessions and API Key. A project API key starts with ak_ and is a different credential.";
    }
    console.log("[composio]", {
      step: "response",
      status: initialized.status,
      kind: failure.kind,
      message: failure.message,
      apiKey: setup.apiKeyHint,
      transport: "consumer-mcp",
    });
    return { text: null, failure };
  }
  const sessionId = initialized.headers.get("mcp-session-id");
  const sessionHeaders = sessionId
    ? { ...headers, "mcp-session-id": sessionId }
    : headers;
  await fetchImpl(CONSUMER_MCP_URL, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const called = await fetchImpl(CONSUMER_MCP_URL, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: {
          tools: [
            {
              tool_slug: slug,
              arguments: args,
              ...(env.connectedAccountId
                ? { account: env.connectedAccountId }
                : {}),
            },
          ],
          sync_response_to_workbench: false,
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readMcpPayload(called);
  if (!called.ok) {
    const failure = classifyComposioFailure(called.status, payload);
    console.log("[composio]", {
      step: "response",
      status: called.status,
      kind: failure.kind,
      message: failure.message,
      apiKey: setup.apiKeyHint,
      transport: "consumer-mcp",
    });
    return { text: null, failure };
  }
  const mcpError = mcpErrorMessage(payload);
  if (mcpError) {
    const failure = classifyComposioFailure(400, { error: { message: mcpError } });
    console.log("[composio]", {
      step: "response",
      status: called.status,
      kind: failure.kind,
      message: failure.message,
      apiKey: setup.apiKeyHint,
      transport: "consumer-mcp",
    });
    return { text: null, failure };
  }
  const text = textFromVisionPayload(payload).trim();
  console.log("[composio]", {
    step: "response",
    status: called.status,
    kind: text ? "ok" : "empty-text",
    characters: text.length,
    apiKey: setup.apiKeyHint,
    transport: "consumer-mcp",
  });
  return { text: text || null, failure: null };
}

async function readMcpPayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = data.at(-1);
    if (!last) return raw;
    try {
      return JSON.parse(last) as unknown;
    } catch {
      return last;
    }
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function mcpErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    error?: { message?: unknown };
    result?: { isError?: unknown; content?: Array<{ text?: unknown }> };
  };
  if (typeof record.error?.message === "string") return record.error.message;
  if (record.result?.isError) {
    const text = (record.result.content ?? [])
      .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
      .filter(Boolean)
      .join(" ");
    return text || "Composio tool call failed.";
  }
  return null;
}

export function composioVisionClient(): (
  bytes: Uint8Array,
  fileName: string,
) => Promise<ComposioVisionResult> {
  return (bytes, fileName) =>
    executeComposioVision(bytes, fileName).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Composio request failed.";
      console.log("[composio]", { step: "threw", message });
      return {
        text: null,
        failure: {
          kind: "unavailable" as const,
          status: null,
          message,
        },
      };
    });
}

function statusFromBody(body: unknown, fallback: number): number {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: { status?: unknown; code?: unknown } }).error;
  if (!error || typeof error !== "object") return fallback;
  if (typeof error.status === "number") return error.status;
  if (typeof error.code === "number") return error.code;
  return fallback;
}

function walkVision(
  value: unknown,
  full: string[],
  paragraphs: string[],
  seen: Set<unknown>,
) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      trimmed.length > 2
    ) {
      try {
        walkVision(JSON.parse(trimmed) as unknown, full, paragraphs, seen);
        return;
      } catch {
        // Plain OCR text, not a JSON envelope.
      }
    }
    if (trimmed.length > 40) paragraphs.push(trimmed);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) walkVision(entry, full, paragraphs, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  const annotation = record.fullTextAnnotation;
  if (annotation && typeof annotation === "object") {
    const text = (annotation as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) full.push(text);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "fullTextAnnotation") continue;
    walkVision(child, full, paragraphs, seen);
  }
}
