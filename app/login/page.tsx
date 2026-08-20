import { redirect } from "next/navigation";
import { getSessionUser } from "@/backend/server/dal";
import { LoginForm } from "@/frontend/client/login-form";
import { safeRedirectPath } from "@/lib/auth/permissions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const nextPath = safeRedirectPath(from);
  const user = await getSessionUser();
  if (user) {
    redirect(nextPath);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-md gap-6">
        <div className="grid gap-1 text-center">
          <p className="text-sm font-semibold tracking-tight">Saltbox Inventory</p>
          <h1 className="font-heading text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Warehouse access for users, associates, and managers.
          </p>
        </div>
        <LoginForm from={nextPath} />
      </div>
    </div>
  );
}
