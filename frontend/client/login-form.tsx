"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/frontend/client/field";
import { PasswordInput } from "@/frontend/client/password-input";
import { postAuth } from "@/frontend/client/auth-api";
import {
  LoginInputSchema,
  RecoverUsernameInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
} from "@/lib/inventory-schema";
import { flattenError } from "zod";

type FieldErrors = Record<string, string[] | undefined>;

type AuthPanel = "signin" | "register" | "recover-username" | "reset-password";

const PANEL_COPY: Record<
  AuthPanel,
  { title: string; description: string }
> = {
  signin: {
    title: "Sign in",
    description: "Use your username or email. Demo password is saltbox123.",
  },
  register: {
    title: "Create an account",
    description:
      "Choose a username and password for first-time sign-on. New accounts start with view-only access.",
  },
  "recover-username": {
    title: "Recover username",
    description: "Enter the name and email on the account to look up the username.",
  },
  "reset-password": {
    title: "Reset password",
    description:
      "Confirm your name, username, and email, then choose a new password.",
  },
};

function ModeLink({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onClick}>
      {children}
    </Button>
  );
}

export function LoginForm({ from }: { from: string }) {
  const [panel, setPanel] = useState<AuthPanel>("signin");
  const copy = PANEL_COPY[panel];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant={panel === "signin" ? "secondary" : "ghost"}
            onClick={() => setPanel("signin")}
          >
            Sign in
          </Button>
          <Button
            type="button"
            size="sm"
            variant={panel === "register" ? "secondary" : "ghost"}
            onClick={() => setPanel("register")}
          >
            Register
          </Button>
        </div>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {panel === "signin" ? <SignInForm from={from} onChangePanel={setPanel} /> : null}
        {panel === "register" ? (
          <RegisterForm from={from} onChangePanel={setPanel} />
        ) : null}
        {panel === "recover-username" ? (
          <RecoverUsernameForm onChangePanel={setPanel} />
        ) : null}
        {panel === "reset-password" ? (
          <ResetPasswordForm onChangePanel={setPanel} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SignInForm({
  from,
  onChangePanel,
}: {
  from: string;
  onChangePanel: (panel: AuthPanel) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    const parsed = LoginInputSchema.safeParse({
      identifier: form.get("identifier"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      const { fieldErrors: next } = flattenError(parsed.error);
      setFieldErrors({
        identifier: next.identifier,
        password: next.password,
      });
      setError("Enter a valid username or email and password.");
      return;
    }
    setPending(true);
    const result = await postAuth("/api/auth/login", parsed.data);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.assign(from || "/");
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field
        label="Username or email"
        htmlFor="identifier"
        error={fieldErrors?.identifier?.[0] ?? fieldErrors?.email?.[0]}
      >
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          placeholder="manager or manager@saltbox.local"
          required
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={fieldErrors?.password?.[0]}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink onClick={() => onChangePanel("recover-username")}>
          Forgot username?
        </ModeLink>
        <ModeLink onClick={() => onChangePanel("reset-password")}>
          Forgot password?
        </ModeLink>
      </div>
      <ul className="grid gap-1 text-[0.625rem] text-muted-foreground">
        <li>manager · manager@saltbox.local</li>
        <li>associate · associate@saltbox.local</li>
        <li>user · user@saltbox.local · view only</li>
      </ul>
    </form>
  );
}

function RegisterForm({
  from,
  onChangePanel,
}: {
  from: string;
  onChangePanel: (panel: AuthPanel) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    const parsed = RegisterInputSchema.safeParse({
      name: form.get("name"),
      username: form.get("username"),
      email: form.get("email"),
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (!parsed.success) {
      const { fieldErrors: next } = flattenError(parsed.error);
      setFieldErrors({
        name: next.name,
        username: next.username,
        email: next.email,
        password: next.password,
        confirmPassword: next.confirmPassword,
      });
      setError("Check the highlighted fields and try again.");
      return;
    }
    setPending(true);
    const result = await postAuth("/api/auth/register", parsed.data);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.assign(from || "/");
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field label="Full name" htmlFor="register-name" error={fieldErrors?.name?.[0]}>
        <Input
          id="register-name"
          name="name"
          autoComplete="name"
          placeholder="Casey New"
          required
        />
      </Field>
      <Field
        label="Username"
        htmlFor="register-username"
        error={fieldErrors?.username?.[0]}
      >
        <Input
          id="register-username"
          name="username"
          autoComplete="username"
          placeholder="casey"
          required
          minLength={3}
          maxLength={32}
        />
      </Field>
      <Field label="Email" htmlFor="register-email" error={fieldErrors?.email?.[0]}>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="casey@saltbox.local"
          required
        />
      </Field>
      <Field
        label="Password"
        htmlFor="register-password"
        error={fieldErrors?.password?.[0]}
      >
        <PasswordInput
          id="register-password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <Field
        label="Confirm password"
        htmlFor="register-confirm"
        error={fieldErrors?.confirmPassword?.[0]}
      >
        <PasswordInput
          id="register-confirm"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <p className="text-[0.625rem] text-muted-foreground">
        Username: 3–32 characters, start with a letter. Password: at least 8 characters,
        with a letter and a number.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-[0.625rem] text-muted-foreground">
        Already have an account?{" "}
        <ModeLink onClick={() => onChangePanel("signin")}>Sign in</ModeLink>
      </p>
    </form>
  );
}

function RecoverUsernameForm({
  onChangePanel,
}: {
  onChangePanel: (panel: AuthPanel) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUsername(undefined);
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    const parsed = RecoverUsernameInputSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
    });
    if (!parsed.success) {
      const { fieldErrors: next } = flattenError(parsed.error);
      setFieldErrors({ name: next.name, email: next.email });
      setError("Enter the name and email on the account.");
      return;
    }
    setPending(true);
    const result = await postAuth<{ username: string }>(
      "/api/auth/recover-username",
      parsed.data,
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUsername(result.data.username);
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field label="Full name" htmlFor="recover-name" error={fieldErrors?.name?.[0]}>
        <Input id="recover-name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="recover-email" error={fieldErrors?.email?.[0]}>
        <Input
          id="recover-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      {username ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          Your username is <span className="font-medium">{username}</span>.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Looking up…" : "Recover username"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink onClick={() => onChangePanel("signin")}>Back to sign in</ModeLink>
        <ModeLink onClick={() => onChangePanel("reset-password")}>
          Reset password
        </ModeLink>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  onChangePanel,
}: {
  onChangePanel: (panel: AuthPanel) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    const parsed = ResetPasswordInputSchema.safeParse({
      name: form.get("name"),
      username: form.get("username"),
      email: form.get("email"),
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (!parsed.success) {
      const { fieldErrors: next } = flattenError(parsed.error);
      setFieldErrors({
        name: next.name,
        username: next.username,
        email: next.email,
        password: next.password,
        confirmPassword: next.confirmPassword,
      });
      setError("Check the highlighted fields and try again.");
      return;
    }
    setPending(true);
    const result = await postAuth("/api/auth/reset-password", parsed.data);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="grid gap-4">
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          Your password was updated. Sign in with the new password.
        </p>
        <Button type="button" onClick={() => onChangePanel("signin")}>
          Return to sign in
        </Button>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field label="Full name" htmlFor="reset-name" error={fieldErrors?.name?.[0]}>
        <Input id="reset-name" name="name" autoComplete="name" required />
      </Field>
      <Field
        label="Username"
        htmlFor="reset-username"
        error={fieldErrors?.username?.[0]}
      >
        <Input
          id="reset-username"
          name="username"
          autoComplete="username"
          required
        />
      </Field>
      <Field label="Email" htmlFor="reset-email" error={fieldErrors?.email?.[0]}>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      <Field
        label="New password"
        htmlFor="reset-password"
        error={fieldErrors?.password?.[0]}
      >
        <PasswordInput
          id="reset-password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <Field
        label="Confirm new password"
        htmlFor="reset-confirm"
        error={fieldErrors?.confirmPassword?.[0]}
      >
        <PasswordInput
          id="reset-confirm"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Updating password…" : "Reset password"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink onClick={() => onChangePanel("signin")}>Back to sign in</ModeLink>
        <ModeLink onClick={() => onChangePanel("recover-username")}>
          Forgot username?
        </ModeLink>
      </div>
    </form>
  );
}
