import "server-only";

import { createId, nowIso } from "@/backend/server/helperUtils";
import { toPublicUser } from "@/lib/validation/user-security";
import { ServiceError } from "@/backend/server/inventory-service";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { readSystem, updateSystem } from "@/backend/server/store";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  findUserByLoginIdentifier,
  findUserForPasswordReset,
  findUserForUsernameRecovery,
} from "@/lib/auth/account-identity";
import {
  assertLoginNotLocked,
  clearFailedLogins,
  recordFailedLogin,
} from "@/lib/validation/login-guard";
import { assertNoSensitiveUserFields } from "@/lib/validation/user-security";
import { ValidationError } from "@/lib/validation/errors";
import {
  CreateUserInputSchema,
  LoginInputSchema,
  RecoverUsernameInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
  UpdateUserInputSchema,
  type PublicUser,
} from "@/lib/inventory-schema";

let dummyPasswordHash: string | undefined;

async function consumePasswordCheck(password: string): Promise<void> {
  dummyPasswordHash ??= await hashPassword("timing-dummy-not-a-user");
  await verifyPassword(password, dummyPasswordHash);
}

function claimUsernameAndEmail(
  users: Array<{ id: string; username: string; email: string }>,
  input: { username: string; email: string },
  userId?: string,
): void {
  const usernameTaken = users.some(
    (user) => user.username === input.username && user.id !== userId,
  );
  if (usernameTaken) {
    throw new ServiceError("That username is already taken.");
  }
  const emailTaken = users.some(
    (user) => user.email === input.email && user.id !== userId,
  );
  if (emailTaken) {
    throw new ServiceError("A user with that email already exists.");
  }
}

export async function authenticateUser(
  identifier: string,
  password: string,
): Promise<PublicUser> {
  const parsed = parseWithSchema(LoginInputSchema, { identifier, password });
  if (!parsed.success) {
    throw new ServiceError("Enter a valid username or email and password.");
  }

  const loginId = parsed.data.identifier;
  assertLoginNotLocked(loginId);

  const system = await readSystem();
  const user = findUserByLoginIdentifier(system.users, loginId);
  if (!user || !user.isActive) {
    await consumePasswordCheck(parsed.data.password);
    recordFailedLogin(loginId);
    throw new ServiceError("Invalid username or password.", 401);
  }

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) {
    recordFailedLogin(loginId);
    throw new ServiceError("Invalid username or password.", 401);
  }

  clearFailedLogins(loginId);
  clearFailedLogins(user.email);
  clearFailedLogins(user.username);
  return toPublicUser(user);
}

export async function registerSelfServeUser(
  rawData: unknown,
): Promise<PublicUser> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(RegisterInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem(async (system) => {
    claimUsernameAndEmail(system.users, parsed.data);

    const now = nowIso();
    const user = {
      id: createId(),
      name: parsed.data.name,
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "user" as const,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: "self-register",
    };
    system.users.push(user);
    return toPublicUser(user);
  });
}

export async function recoverUsername(
  rawData: unknown,
): Promise<{ username: string }> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(RecoverUsernameInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const lockKey = `recover-username:${parsed.data.email}`;
  assertLoginNotLocked(lockKey, Date.now(), "username recovery");

  const system = await readSystem();
  const user = findUserForUsernameRecovery(
    system.users,
    parsed.data.name,
    parsed.data.email,
  );
  if (!user) {
    await consumePasswordCheck("recovery-dummy");
    recordFailedLogin(lockKey);
    throw new ServiceError("No matching account was found.");
  }

  clearFailedLogins(lockKey);
  return { username: user.username };
}

export async function resetPasswordWithIdentity(
  rawData: unknown,
): Promise<void> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(ResetPasswordInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const lockKey = `reset-password:${parsed.data.username}:${parsed.data.email}`;
  assertLoginNotLocked(lockKey, Date.now(), "password reset");

  await updateSystem(async (system) => {
    const user = findUserForPasswordReset(system.users, parsed.data);
    if (!user) {
      await consumePasswordCheck(parsed.data.password);
      recordFailedLogin(lockKey);
      throw new ServiceError("No matching account was found.");
    }

    user.passwordHash = await hashPassword(parsed.data.password);
    user.updatedAt = nowIso();
    clearFailedLogins(lockKey);
    clearFailedLogins(user.email);
    clearFailedLogins(user.username);
  });
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  const system = await readSystem();
  return system.users.map(toPublicUser);
}

export async function createUserRecord(
  rawData: unknown,
  actorName: string,
): Promise<PublicUser> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(CreateUserInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem(async (system) => {
    claimUsernameAndEmail(system.users, parsed.data);

    const now = nowIso();
    const user = {
      id: createId(),
      name: parsed.data.name,
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: parsed.data.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: actorName,
    };
    system.users.push(user);
    return toPublicUser(user);
  });
}

export async function updateUserRecord(
  rawData: unknown,
  actorId: string,
): Promise<PublicUser> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(UpdateUserInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem(async (system) => {
    const user = system.users.find((entry) => entry.id === parsed.data.id);
    if (!user) {
      throw new ServiceError("User was not found.", 404);
    }

    if (parsed.data.email && parsed.data.email !== user.email) {
      claimUsernameAndEmail(
        system.users,
        { username: parsed.data.username ?? user.username, email: parsed.data.email },
        user.id,
      );
      user.email = parsed.data.email;
    }

    if (parsed.data.username && parsed.data.username !== user.username) {
      claimUsernameAndEmail(
        system.users,
        { username: parsed.data.username, email: parsed.data.email ?? user.email },
        user.id,
      );
      user.username = parsed.data.username;
    }

    if (parsed.data.name) user.name = parsed.data.name;
    if (parsed.data.role) user.role = parsed.data.role;

    if (parsed.data.password) {
      user.passwordHash = await hashPassword(parsed.data.password);
    }

    if (parsed.data.isActive !== undefined) {
      if (parsed.data.isActive === false && user.id === actorId) {
        throw new ServiceError("You cannot deactivate your own account.");
      }
      if (parsed.data.isActive === false && user.role === "manager") {
        const otherManagers = system.users.filter(
          (entry) =>
            entry.id !== user.id &&
            entry.role === "manager" &&
            entry.isActive,
        );
        if (otherManagers.length === 0) {
          throw new ServiceError("Keep at least one active manager.");
        }
      }
      user.isActive = parsed.data.isActive;
    }

    if (parsed.data.role && parsed.data.role !== "manager") {
      const remainingManagers = system.users.filter(
        (entry) => entry.role === "manager" && entry.isActive,
      );
      if (remainingManagers.length === 0) {
        throw new ServiceError("Keep at least one active manager.");
      }
    }

    user.updatedAt = nowIso();
    return toPublicUser(user);
  });
}

export function asAuthError(error: unknown): string | undefined {
  if (error instanceof ServiceError || error instanceof ValidationError) {
    return error.message;
  }
  return undefined;
}
