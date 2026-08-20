"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { flattenError } from "zod";
import {
  asAuthError,
  createUserRecord,
  authenticateUser,
  updateUserRecord,
} from "@/backend/server/auth-service";
import { requireApiPermission } from "@/backend/server/dal";
import { deleteSession, createSession } from "@/backend/server/session";
import { safeRedirectPath } from "@/lib/auth/permissions";
import { LoginInputSchema, type PublicUser } from "@/lib/inventory-schema";

export type LoginState = {
  error?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
  };
};

export type UserActionResult =
  | { ok: true; data: PublicUser }
  | { ok: false; error: string };

export async function loginAction(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    from: formData.get("from") || undefined,
  });

  if (!parsed.success) {
    const { fieldErrors } = flattenError(parsed.error);
    return {
      error: "Enter a valid email and password.",
      fieldErrors: {
        email: fieldErrors.email,
        password: fieldErrors.password,
      },
    };
  }

  try {
    const user = await authenticateUser(parsed.data.email, parsed.data.password);
    await createSession(user);
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { error: message };
    }
    return { error: "Unable to sign in." };
  }

  redirect(safeRedirectPath(parsed.data.from));
}

export async function logoutAction(): Promise<void> {
  await deleteSession();
  redirect("/login");
}

export async function createManagedUser(
  rawData: unknown,
): Promise<UserActionResult> {
  try {
    const actor = await requireApiPermission("manageUsers");
    const data = await createUserRecord(rawData, actor.name);
    revalidatePath("/users");
    return { ok: true, data };
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { ok: false, error: message };
    }
    return { ok: false, error: "Unable to create user." };
  }
}

export async function updateManagedUser(
  rawData: unknown,
): Promise<UserActionResult> {
  try {
    const actor = await requireApiPermission("manageUsers");
    const data = await updateUserRecord(rawData, actor.id);
    revalidatePath("/users");
    return { ok: true, data };
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { ok: false, error: message };
    }
    return { ok: false, error: "Unable to update user." };
  }
}
