export type AuthResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function postAuth<T>(
  url: string,
  body: unknown,
): Promise<AuthResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as {
      success?: boolean;
      data?: T;
      error?: string;
    };
    if (!response.ok || !json.success) {
      return {
        ok: false,
        error: json.error || "Unable to complete that request.",
      };
    }
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: "Unable to reach the server. Try again." };
  }
}
