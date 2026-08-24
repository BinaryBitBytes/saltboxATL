import { LIMITS } from "@/lib/validation/limits";
import { isUsername } from "@/lib/validation/sanitize";

function allocateUsername(candidate: string, taken: Set<string>): string | null {
  if (
    candidate.length >= LIMITS.usernameMin &&
    candidate.length <= LIMITS.usernameMax &&
    isUsername(candidate) &&
    !taken.has(candidate)
  ) {
    taken.add(candidate);
    return candidate;
  }
  return null;
}

export function uniqueUsernameFromEmail(
  email: string,
  taken: Set<string>,
): string {
  const local = (email.split("@")[0] ?? "user").toLowerCase();
  const cleaned = local.replace(/[^a-z0-9._-]/g, "");
  let lettersStart = cleaned.replace(/^[^a-z]+/, "");
  if (lettersStart.length < LIMITS.usernameMin) {
    lettersStart = `user${lettersStart.replace(/[^a-z0-9]/g, "")}`;
  }
  const base = (lettersStart || "user").slice(0, LIMITS.usernameMax);

  const direct = allocateUsername(base, taken);
  if (direct) return direct;

  for (let n = 2; n < 10_000; n += 1) {
    const suffix = String(n);
    const prefixLen = Math.max(1, LIMITS.usernameMax - suffix.length);
    const allocated = allocateUsername(`${base.slice(0, prefixLen)}${suffix}`, taken);
    if (allocated) return allocated;
  }

  const fallback = `user${Math.random().toString(36).slice(2, 10)}`.slice(
    0,
    LIMITS.usernameMax,
  );
  taken.add(fallback);
  return fallback;
}

export function backfillUsernames(
  users: Array<Record<string, unknown>>,
): boolean {
  const taken = new Set<string>();
  let changed = false;
  const keep = users.map(() => false);

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    if (typeof user.username !== "string" || !user.username.trim()) continue;
    const normalized = user.username.trim().toLowerCase();
    if (!isUsername(normalized) || taken.has(normalized)) continue;
    if (normalized !== user.username) {
      user.username = normalized;
      changed = true;
    }
    taken.add(normalized);
    keep[index] = true;
  }

  for (let index = 0; index < users.length; index += 1) {
    if (keep[index]) continue;
    const user = users[index];
    const email = typeof user.email === "string" ? user.email : "";
    user.username = uniqueUsernameFromEmail(email, taken);
    changed = true;
  }

  return changed;
}
