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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resetLoginGuardForTests(): void {
  attempts.clear();
}

export function getLoginLockRemainingMs(email: string, at = now()): number {
  const state = attempts.get(normalizeEmail(email));
  if (!state) return 0;
  return Math.max(0, state.lockedUntil - at);
}

export function assertLoginNotLocked(email: string, at = now()): void {
  const remaining = getLoginLockRemainingMs(email, at);
  if (remaining > 0) {
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    throw new ValidationError(
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      429,
      "LOGIN_LOCKED",
    );
  }
}

export function recordFailedLogin(email: string, at = now()): void {
  const key = normalizeEmail(email);
  const state = attempts.get(key) ?? { failures: [], lockedUntil: 0 };
  const windowStart = at - LIMITS.loginWindowMs;
  state.failures = [...state.failures.filter((stamp) => stamp >= windowStart), at];
  if (state.failures.length >= LIMITS.loginMaxFailures) {
    state.lockedUntil = at + LIMITS.loginLockMs;
    state.failures = [];
  }
  attempts.set(key, state);
}

export function clearFailedLogins(email: string): void {
  attempts.delete(normalizeEmail(email));
}
