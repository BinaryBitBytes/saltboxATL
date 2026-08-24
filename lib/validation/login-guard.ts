import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

type AttemptState = {
  failures: number[];
  lockedUntil: number;
};

const attempts = new Map<string, AttemptState>();

function now(): number {
  return Date.now();
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

export function resetLoginGuardForTests(): void {
  attempts.clear();
}

export function getLoginLockRemainingMs(key: string, at = now()): number {
  const state = attempts.get(normalizeKey(key));
  if (!state) return 0;
  return Math.max(0, state.lockedUntil - at);
}

export function assertLoginNotLocked(
  key: string,
  at = now(),
  action = "sign-in",
): void {
  const remaining = getLoginLockRemainingMs(key, at);
  if (remaining > 0) {
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    throw new ValidationError(
      `Too many failed ${action} attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      429,
      "LOGIN_LOCKED",
    );
  }
}

export function recordFailedLogin(key: string, at = now()): void {
  const normalized = normalizeKey(key);
  const state = attempts.get(normalized) ?? { failures: [], lockedUntil: 0 };
  const windowStart = at - LIMITS.loginWindowMs;
  state.failures = [...state.failures.filter((stamp) => stamp >= windowStart), at];
  if (state.failures.length >= LIMITS.loginMaxFailures) {
    state.lockedUntil = at + LIMITS.loginLockMs;
    state.failures = [];
  }
  attempts.set(normalized, state);
}

export function clearFailedLogins(key: string): void {
  attempts.delete(normalizeKey(key));
}
