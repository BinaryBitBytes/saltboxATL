import "server-only";

import { createId, nowIso } from "@/backend/server/helperUtils";
import { toPublicUser } from "@/backend/server/dal";
import { ServiceError } from "@/backend/server/inventory-service";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { readSystem, updateSystem } from "@/backend/server/store";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  CreateUserInputSchema,
  LoginInputSchema,
  UpdateUserInputSchema,
  type PublicUser,
} from "@/lib/inventory-schema";

export async function authenticateUser(
  email: string,
  password: string,
): Promise<PublicUser> {
  const parsed = parseWithSchema(LoginInputSchema, { email, password });
  if (!parsed.success) {
    throw new ServiceError("Enter a valid email and password.");
  }

  const system = await readSystem();
  const user = system.users.find(
    (entry) => entry.email === parsed.data.email,
  );
  if (!user || !user.isActive) {
    throw new ServiceError("Invalid email or password.", 401);
  }

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) {
    throw new ServiceError("Invalid email or password.", 401);
  }

  return toPublicUser(user);
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  const system = await readSystem();
  return system.users.map(toPublicUser);
}

export async function createUserRecord(
  rawData: unknown,
  actorName: string,
): Promise<PublicUser> {
  const parsed = parseWithSchema(CreateUserInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem(async (system) => {
    const email = parsed.data.email;
    if (system.users.some((user) => user.email === email)) {
      throw new ServiceError("A user with that email already exists.");
    }

    const now = nowIso();
    const user = {
      id: createId(),
      name: parsed.data.name,
      email,
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
      const duplicate = system.users.some(
        (entry) => entry.email === parsed.data.email && entry.id !== user.id,
      );
      if (duplicate) {
        throw new ServiceError("A user with that email already exists.");
      }
      user.email = parsed.data.email;
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
