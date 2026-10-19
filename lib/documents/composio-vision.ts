/**
 * Composio image recognition for inbound PDFs.
 * Default tool: Google Cloud Vision file annotation (DOCUMENT_TEXT_DETECTION),
 * which reads scanned purchase orders and invoices. Embedded PDF text is used
 * when Composio is not configured or the call does not return text.
 */

const EXECUTE_URL = "https://backend.composio.dev/api/v3.1/tools/execute";
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
): Promise<string | null> {
  if (!env.apiKey) return null;
  const slug = env.toolSlug || DEFAULT_SLUG;
  const response = await fetchImpl(`${EXECUTE_URL}/${slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.apiKey,
    },
    body: JSON.stringify({
      user_id: env.userId || DEFAULT_USER,
      ...(env.connectedAccountId
        ? { connected_account_id: env.connectedAccountId }
        : {}),
      arguments: composioVisionArguments(bytes, fileName, env),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (
    payload &&
    typeof payload === "object" &&
    "successful" in payload &&
    (payload as { successful?: unknown }).successful === false
  ) {
    return null;
  }
  const text = textFromVisionPayload(payload).trim();
  return text || null;
}

export function composioVisionClient(): (
  bytes: Uint8Array,
  fileName: string,
) => Promise<string | null> {
  return (bytes, fileName) =>
    executeComposioVision(bytes, fileName).catch(() => null);
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
