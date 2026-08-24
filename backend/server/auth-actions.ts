"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { flattenError } from "zod";
import {
  asAuthError,
  createUserRecord,
  authenticateUser,
  recoverUsername,
  registerSelfServeUser,
  resetPasswordWithIdentity,
  updateUserRecord,
} from "@/backend/server/auth-service";
import { requireApiPermission } from "@/backend/server/dal";
import { deleteSession, createSession } from "@/backend/server/session";
import { safeRedirectPath } from "@/lib/auth/permissions";
import {
  LoginInputSchema,
  RecoverUsernameInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
  type PublicUser,
} from "@/lib/inventory-schema";

export type LoginState = {
  error?: string;
  fieldErrors?: {
    identifier?: string[];
    email?: string[];
    password?: string[];
  };
};

export type RegisterState = {
  error?: string;
  fieldErrors?: {
    name?: string[];
    username?: string[];
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
};

export type RecoverUsernameState = {
  error?: string;
  username?: string;
  fieldErrors?: {
    name?: string[];
    email?: string[];
  };
};

export type ResetPasswordState = {
  error?: string;
  success?: boolean;
  fieldErrors?: {
    name?: string[];
    username?: string[];
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
};

export type UserActionResult =
  | { ok: true; data: PublicUser }
  | { ok: false; error: string };

function fieldErrorsFrom(error: unknown): Record<string, string[]> | undefined {
  const { fieldErrors } = flattenError(error as never);
  const next: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const list = Array.isArray(messages)
      ? messages.filter((message): message is string => Boolean(message))
      : [];
    if (list.length > 0) next[key] = list;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export async function loginAction(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInputSchema.safeParse({
    identifier: formData.get("identifier"),
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
    from: formData.get("from") || undefined,
  });

  if (!parsed.success) {
    const errors = fieldErrorsFrom(parsed.error);
    return {
      error: "Enter a valid username or email and password.",
      fieldErrors: {
        identifier: errors?.identifier,
        email: errors?.identifier,
        password: errors?.password,
      },
    };
  }

  try {
    const user = await authenticateUser(
      parsed.data.identifier,
      parsed.data.password,
    );
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

export async function registerAction(
  _state: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = RegisterInputSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    from: formData.get("from") || undefined,
  });

  if (!parsed.success) {
    const errors = fieldErrorsFrom(parsed.error);
    return {
      error: "Check the highlighted fields and try again.",
      fieldErrors: {
        name: errors?.name,
        username: errors?.username,
        email: errors?.email,
        password: errors?.password,
        confirmPassword: errors?.confirmPassword,
      },
    };
  }

  try {
    const user = await registerSelfServeUser(parsed.data);
    await createSession(user);
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { error: message };
    }
    return { error: "Unable to create your account." };
  }

  redirect(safeRedirectPath(parsed.data.from));
}

export async function recoverUsernameAction(
  _state: RecoverUsernameState,
  formData: FormData,
): Promise<RecoverUsernameState> {
  const parsed = RecoverUsernameInputSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const errors = fieldErrorsFrom(parsed.error);
    return {
      error: "Enter the name and email on the account.",
      fieldErrors: {
        name: errors?.name,
        email: errors?.email,
      },
    };
  }

  try {
    const result = await recoverUsername(parsed.data);
    return { username: result.username };
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { error: message };
    }
    return { error: "Unable to recover that username." };
  }
}

export async function resetPasswordAction(
  _state: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = ResetPasswordInputSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const errors = fieldErrorsFrom(parsed.error);
    return {
      error: "Check the highlighted fields and try again.",
      fieldErrors: {
        name: errors?.name,
        username: errors?.username,
        email: errors?.email,
        password: errors?.password,
        confirmPassword: errors?.confirmPassword,
      },
    };
  }

  try {
    await resetPasswordWithIdentity(parsed.data);
    return { success: true };
  } catch (error) {
    const message = asAuthError(error);
    if (message) {
      return { error: message };
    }
    return { error: "Unable to reset that password." };
  }
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
