import { redirect } from "next/navigation";
import { getSessionUser } from "@/backend/server/dal";
import { LoginForm } from "@/frontend/client/login-form";
import { InstallAppCard } from "@/frontend/client/pwa-install";
import { ThemeToggle } from "@/frontend/client/theme-toggle";
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
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-[max(1rem,env(safe-area-inset-left))] py-[max(2.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))]">
        <ThemeToggle />
      </div>
      <div className="grid w-full max-w-md gap-6">
        <div className="grid gap-1 text-center">
          <p className="text-sm font-semibold tracking-tight">Saltbox Inventory</p>
          <h1 className="font-heading text-xl font-semibold">Account access</h1>
          <p className="text-sm text-muted-foreground">
            Sign in, create a username and password, or recover forgotten credentials.
          </p>
        </div>
        <LoginForm from={nextPath} />
        <InstallAppCard />
      </div>
    </div>
  );
}
