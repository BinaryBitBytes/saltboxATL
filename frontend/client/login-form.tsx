"use client";

import { T, useT } from "@/frontend/client/language";
import { useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
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
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth/demo-accounts";
import {
  authPageHref,
  type AuthPanel,
} from "@/lib/auth/login-page";
import { roleLabel } from "@/lib/auth/permissions";
import {
  LoginInputSchema,
  RecoverUsernameInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
} from "@/lib/inventory-schema";
import { flattenError } from "zod";
import { cn } from "@/lib/utils";

function AuthTextInput({
  id,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
  maxLength,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <input
      id={id}
      name={name}
      type={type}
      autoComplete={autoComplete}
      required={required}
      minLength={minLength}
      maxLength={maxLength}
      placeholder={placeholder ? t(placeholder) : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={(event) => onChange(event.currentTarget.value)}
      className={cn(inputClassName)}
    />
  );
}

type FieldErrors = Record<string, string[] | undefined>;

const PANEL_COPY: Record<AuthPanel, { title: string; description: string }> = {
  signin: {
    title: "Sign in",
    description: `Use your username or email. Every demo account uses ${DEMO_PASSWORD}.`,
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

function ModeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        buttonVariants({ variant: "link", size: "xs" }),
        "h-auto px-0",
      )}
    >
      {children}
    </a>
  );
}

function PanelTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
      )}
    >
      {children}
    </a>
  );
}

export function LoginForm({
  from,
  initialPanel,
  initialError,
  recoveredUsername,
  passwordReset,
}: {
  from: string;
  initialPanel: AuthPanel;
  initialError?: string;
  recoveredUsername?: string;
  passwordReset?: boolean;
}) {
  const copy = PANEL_COPY[initialPanel];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap gap-1">
          <PanelTab href={authPageHref("signin", from)} active={initialPanel === "signin"}><T>Sign in</T></PanelTab>
          <PanelTab
            href={authPageHref("register", from)}
            active={initialPanel === "register"}
          ><T>Register</T></PanelTab>
        </div>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {initialPanel === "signin" ? (
          <SignInForm
            from={from}
            initialError={initialError}
            passwordReset={passwordReset}
          />
        ) : null}
        {initialPanel === "register" ? (
          <RegisterForm from={from} initialError={initialError} />
        ) : null}
        {initialPanel === "recover-username" ? (
          <RecoverUsernameForm
            from={from}
            initialError={initialError}
            recoveredUsername={recoveredUsername}
          />
        ) : null}
        {initialPanel === "reset-password" ? (
          <ResetPasswordForm from={from} initialError={initialError} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SignInForm({
  from,
  initialError,
  passwordReset,
}: {
  from: string;
  initialError?: string;
  passwordReset?: boolean;
}) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = LoginInputSchema.safeParse({
      identifier: String(data.get("identifier") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    if (!parsed.success) {
      event.preventDefault();
      const { fieldErrors: next } = flattenError(parsed.error);
      setFieldErrors({
        identifier: next.identifier,
        password: next.password,
      });
      setError("Enter a valid username or email and password.");
      return;
    }
    setError(null);
    setFieldErrors(undefined);
  }

  return (
    <form
      method="post"
      action="/api/auth/login"
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
    >
      <input type="hidden" name="from" value={from} />
      {passwordReset ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"><T>Your password was updated. Sign in with the new password.</T></p>
      ) : null}
      <Field
        label="Username or email"
        htmlFor="identifier"
        error={fieldErrors?.identifier?.[0] ?? fieldErrors?.email?.[0]}
      >
        <AuthTextInput
          id="identifier"
          name="identifier"
          autoComplete="username"
          placeholder="manager or manager@saltbox.local"
          required
          value={identifier}
          onChange={setIdentifier}
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
          value={password}
          onChange={setPassword}
        />
      </Field>
      {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
      <Button type="submit"><T>Sign in</T></Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink href={authPageHref("recover-username", from)}><T>Forgot username?</T></ModeLink>
        <ModeLink href={authPageHref("reset-password", from)}><T>Forgot password?</T></ModeLink>
      </div>
      <div className="grid gap-1">
        <p className="text-[0.625rem] text-muted-foreground">
          <T>Demo accounts · password</T> {DEMO_PASSWORD}
        </p>
        <ul className="grid gap-1 text-[0.625rem] text-muted-foreground">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                className="w-full rounded-md px-1 py-0.5 text-left hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  flushSync(() => {
                    setIdentifier(account.email);
                    setPassword(DEMO_PASSWORD);
                    setError(null);
                    setFieldErrors(undefined);
                  });
                  form?.requestSubmit();
                }}
              >
                <T>{roleLabel(account.role)}</T> · {account.username} · {account.email}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}

function RegisterForm({
  from,
  initialError,
}: {
  from: string;
  initialError?: string;
}) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    const parsed = RegisterInputSchema.safeParse({
      name,
      username,
      email,
      password,
      confirmPassword,
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
    <form
      method="post"
      action="/api/auth/register"
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
    >
      <input type="hidden" name="from" value={from} />
      <Field label="Full name" htmlFor="register-name" error={fieldErrors?.name?.[0]}>
        <AuthTextInput
          id="register-name"
          name="name"
          autoComplete="name"
          placeholder="Casey New"
          required
          value={name}
          onChange={setName}
        />
      </Field>
      <Field
        label="Username"
        htmlFor="register-username"
        error={fieldErrors?.username?.[0]}
      >
        <AuthTextInput
          id="register-username"
          name="username"
          autoComplete="username"
          placeholder="casey"
          required
          minLength={3}
          maxLength={32}
          value={username}
          onChange={setUsername}
        />
      </Field>
      <Field label="Email" htmlFor="register-email" error={fieldErrors?.email?.[0]}>
        <AuthTextInput
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="casey@saltbox.local"
          required
          value={email}
          onChange={setEmail}
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
          value={password}
          onChange={setPassword}
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
          value={confirmPassword}
          onChange={setConfirmPassword}
        />
      </Field>
      <p className="text-[0.625rem] text-muted-foreground"><T>Username: 3–32 characters, start with a letter. Password: at least 8 characters, with a letter and a number.</T></p>
      {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-[0.625rem] text-muted-foreground">
        <T>Already have an account?</T>{" "}
        <ModeLink href={authPageHref("signin", from)}><T>Sign in</T></ModeLink>
      </p>
    </form>
  );
}

function RecoverUsernameForm({
  from,
  initialError,
  recoveredUsername,
}: {
  from: string;
  initialError?: string;
  recoveredUsername?: string;
}) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [username, setUsername] = useState<string | undefined>(recoveredUsername);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUsername(undefined);
    setFieldErrors(undefined);
    const parsed = RecoverUsernameInputSchema.safeParse({
      name,
      email,
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
    <form
      method="post"
      action="/api/auth/recover-username"
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
    >
      <Field label="Full name" htmlFor="recover-name" error={fieldErrors?.name?.[0]}>
        <AuthTextInput
          id="recover-name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={setName}
        />
      </Field>
      <Field label="Email" htmlFor="recover-email" error={fieldErrors?.email?.[0]}>
        <AuthTextInput
          id="recover-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
        />
      </Field>
      {username ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"><T>Your username is</T><span className="font-medium">{username}</span>.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Looking up…" : "Recover username"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink href={authPageHref("signin", from)}><T>Back to sign in</T></ModeLink>
        <ModeLink href={authPageHref("reset-password", from)}><T>Reset password</T></ModeLink>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  from,
  initialError,
}: {
  from: string;
  initialError?: string;
}) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    const parsed = ResetPasswordInputSchema.safeParse({
      name,
      username,
      email,
      password,
      confirmPassword,
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
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"><T>Your password was updated. Sign in with the new password.</T></p>
        <a
          href={authPageHref("signin", from)}
          className={cn(buttonVariants({ variant: "default" }))}
        ><T>Return to sign in</T></a>
      </div>
    );
  }

  return (
    <form
      method="post"
      action="/api/auth/reset-password"
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
    >
      <Field label="Full name" htmlFor="reset-name" error={fieldErrors?.name?.[0]}>
        <AuthTextInput
          id="reset-name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={setName}
        />
      </Field>
      <Field
        label="Username"
        htmlFor="reset-username"
        error={fieldErrors?.username?.[0]}
      >
        <AuthTextInput
          id="reset-username"
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={setUsername}
        />
      </Field>
      <Field label="Email" htmlFor="reset-email" error={fieldErrors?.email?.[0]}>
        <AuthTextInput
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
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
          value={password}
          onChange={setPassword}
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
          value={confirmPassword}
          onChange={setConfirmPassword}
        />
      </Field>
      {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Updating password…" : "Reset password"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem]">
        <ModeLink href={authPageHref("signin", from)}><T>Back to sign in</T></ModeLink>
        <ModeLink href={authPageHref("recover-username", from)}><T>Forgot username?</T></ModeLink>
      </div>
    </form>
  );
}
