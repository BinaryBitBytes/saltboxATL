import "server-only";

import { createId, nowIso } from "@/backend/server/helperUtils";
import { toPublicUser } from "@/lib/validation/user-security";
import { ServiceError } from "@/backend/server/inventory-service";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { readAccounts } from "@/backend/server/account-store";
import { updateSystem } from "@/backend/server/store";
import {
  canAssignDivisions,
  canAssignRole,
  canManageUser,
  divisionForRole,
  divisionOf,
  resolveAssignedDivisions,
} from "@/lib/divisions";
import {
  homeSiteForDivision,
  resolveAssignedSites,
  sitesForAssignment,
} from "@/lib/sites/access";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  accountLoginLockKeys,
  findUserByLoginIdentifier,
  findUserForPasswordReset,
  findUserForUsernameRecovery,
  passwordResetLockKey,
  usernameRecoveryLockKey,
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
  type Division,
  type PublicUser,
  type Site,
  type UserRole,
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
  let system;
  try {
    system = await readAccounts();
  } catch {
    throw new ServiceError(
      "Unable to load accounts right now. Try signing in again.",
    );
  }
  const user = findUserByLoginIdentifier(system.users, loginId);
  const lockKeys = user ? accountLoginLockKeys(user, loginId) : [loginId];
  for (const key of lockKeys) {
    assertLoginNotLocked(key);
  }

  if (!user || !user.isActive) {
    await consumePasswordCheck(parsed.data.password);
    for (const key of lockKeys) {
      recordFailedLogin(key);
    }
    throw new ServiceError("Invalid username or password.", 401);
  }

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) {
    for (const key of lockKeys) {
      recordFailedLogin(key);
    }
    throw new ServiceError("Invalid username or password.", 401);
  }

  for (const key of lockKeys) {
    clearFailedLogins(key);
  }
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
      division: divisionForRole("user"),
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

  const lockKey = usernameRecoveryLockKey(parsed.data.email);
  assertLoginNotLocked(lockKey, Date.now(), "username recovery");

  const system = await readAccounts();
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

  const lockKey = passwordResetLockKey(parsed.data.email);
  assertLoginNotLocked(lockKey, Date.now(), "password reset");

  const current = await readAccounts();
  const matched = findUserForPasswordReset(current.users, parsed.data);
  if (!matched) {
    await consumePasswordCheck(parsed.data.password);
    recordFailedLogin(lockKey);
    throw new ServiceError("No matching account was found.");
  }

  await updateSystem(async (system) => {
    const user = findUserForPasswordReset(system.users, parsed.data);
    if (!user) {
      throw new ServiceError("No matching account was found.");
    }

    user.passwordHash = await hashPassword(parsed.data.password);
    user.updatedAt = nowIso();
    clearFailedLogins(lockKey);
    for (const key of accountLoginLockKeys(user)) {
      clearFailedLogins(key);
    }
  });
}

export async function listPublicUsers(actorRole: UserRole): Promise<PublicUser[]> {
  const system = await readAccounts();
  return system.users
    .filter((user) => canManageUser(actorRole, user.role))
    .map(toPublicUser);
}

async function registrySites(): Promise<Site[]> {
  const accounts = await readAccounts();
  return accounts.sites ?? [];
}

export async function createUserRecord(
  rawData: unknown,
  actor: { name: string; role: UserRole },
): Promise<PublicUser> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(CreateUserInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  if (!canAssignRole(actor.role, parsed.data.role)) {
    throw new ServiceError("You cannot assign that role.", 403);
  }

  const knownSites = await registrySites();
  return updateSystem(async (system) => {
    claimUsernameAndEmail(system.users, parsed.data);

    const now = nowIso();
    const division = divisionForRole(parsed.data.role);
    const sites = sitesForAssignment(system.sites, knownSites);
    const home = homeSiteForDivision(sites, division);
    let siteId = home?.id;
    let allowedSiteIds: string[] | undefined;
    if (home) {
      const granted = resolveAssignedSites({
        sites,
        division,
        allowedSiteIds: parsed.data.allowedSiteIds ?? [home.id],
        siteId: parsed.data.siteId ?? home.id,
      });
      if (!granted.ok) throw new ServiceError(granted.error);
      siteId = granted.siteId;
      allowedSiteIds = granted.allowedSiteIds;
    }
    let allowedDivisions: Division[] | undefined;
    if (parsed.data.allowedDivisions) {
      if (!canAssignDivisions(actor.role)) {
        throw new ServiceError("You cannot assign divisions.", 403);
      }
      const divisions = resolveAssignedDivisions({
        role: parsed.data.role,
        allowedDivisions: parsed.data.allowedDivisions,
      });
      if (!divisions.ok) throw new ServiceError(divisions.error);
      allowedDivisions = divisions.allowedDivisions;
    }
    const user = {
      id: createId(),
      name: parsed.data.name,
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: parsed.data.role,
      division,
      siteId,
      allowedSiteIds,
      allowedDivisions,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.name,
    };
    system.users.push(user);
    return toPublicUser(user);
  });
}

export async function updateUserRecord(
  rawData: unknown,
  actor: { id: string; role: UserRole },
): Promise<PublicUser> {
  assertNoSensitiveUserFields(rawData);
  const parsed = parseWithSchema(UpdateUserInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const touchesSites = Boolean(
    parsed.data.allowedSiteIds || parsed.data.siteId || parsed.data.role,
  );
  const knownSites = touchesSites ? await registrySites() : [];
  return updateSystem(async (system) => {
    const user = system.users.find((entry) => entry.id === parsed.data.id);
    if (!user) {
      throw new ServiceError("User was not found.", 404);
    }
    if (!canManageUser(actor.role, user.role)) {
      throw new ServiceError("You can only manage users in your division.", 403);
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
    if (parsed.data.role) {
      if (!canAssignRole(actor.role, parsed.data.role)) {
        throw new ServiceError("You cannot assign that role.", 403);
      }
      user.role = parsed.data.role;
      user.division = divisionForRole(parsed.data.role);
    }

    if (parsed.data.allowedDivisions) {
      if (!canAssignDivisions(actor.role)) {
        throw new ServiceError("You cannot assign divisions.", 403);
      }
      if (user.id === actor.id) {
        throw new ServiceError("You cannot change your own division access.");
      }
      const divisions = resolveAssignedDivisions({
        role: user.role,
        allowedDivisions: parsed.data.allowedDivisions,
      });
      if (!divisions.ok) throw new ServiceError(divisions.error);
      user.allowedDivisions = divisions.allowedDivisions;
    } else if (parsed.data.role && user.allowedDivisions != null) {
      const divisions = resolveAssignedDivisions({
        role: user.role,
        allowedDivisions: user.allowedDivisions,
      });
      user.allowedDivisions = divisions.ok
        ? divisions.allowedDivisions
        : [divisionForRole(user.role)];
    }

    if (parsed.data.allowedSiteIds) {
      const sites = sitesForAssignment(system.sites, knownSites);
      const granted = resolveAssignedSites({
        sites,
        division: divisionForRole(user.role),
        allowedSiteIds: parsed.data.allowedSiteIds,
        siteId: parsed.data.siteId ?? user.siteId,
      });
      if (!granted.ok) throw new ServiceError(granted.error);
      user.allowedSiteIds = granted.allowedSiteIds;
      user.siteId = granted.siteId;
    } else if (parsed.data.role) {
      const division = divisionForRole(user.role);
      const sites = sitesForAssignment(system.sites, knownSites);
      const home = homeSiteForDivision(sites, division);
      if (user.allowedSiteIds != null) {
        const granted = resolveAssignedSites({
          sites,
          division,
          allowedSiteIds: user.allowedSiteIds,
          siteId: user.siteId,
        });
        if (granted.ok) {
          user.allowedSiteIds = granted.allowedSiteIds;
          user.siteId = granted.siteId;
        } else if (home) {
          user.allowedSiteIds = [home.id];
          user.siteId = home.id;
        }
      } else if (home && user.siteId !== home.id) {
        const stillValid = sites.some(
          (site) => site.id === user.siteId && divisionOf(site) === division,
        );
        if (!stillValid) user.siteId = home.id;
      }
    }

    if (parsed.data.password) {
      user.passwordHash = await hashPassword(parsed.data.password);
    }

    if (parsed.data.isActive !== undefined) {
      if (parsed.data.isActive === false && user.id === actor.id) {
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
