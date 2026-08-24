import type { z } from "zod";
import { passwordMatchesIdentity } from "@/lib/auth/account-identity";

export function refineConfirmPassword(
  data: { password: string; confirmPassword: string },
  ctx: z.RefinementCtx,
): void {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match.",
    });
  }
}

export function refinePasswordNotIdentity(
  data: { password: string; username: string; email: string },
  ctx: z.RefinementCtx,
): void {
  if (passwordMatchesIdentity(data.password, data.username, data.email)) {
    ctx.addIssue({
      code: "custom",
      path: ["password"],
      message: "Password cannot match your username or email.",
    });
  }
}
