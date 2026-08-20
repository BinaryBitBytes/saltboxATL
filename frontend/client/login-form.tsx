"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/backend/server/auth-actions";
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

const initialState: LoginState = {};

export function LoginForm({ from }: { from: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credentials</CardTitle>
        <CardDescription>
          Demo accounts all use password <code>saltbox123</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="from" value={from} />
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email?.[0]}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="associate@saltbox.local"
              required
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            error={state.fieldErrors?.password?.[0]}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {state.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <ul className="grid gap-1 text-[0.625rem] text-muted-foreground">
            <li>manager@saltbox.local · manager</li>
            <li>associate@saltbox.local · associate</li>
            <li>user@saltbox.local · view only</li>
          </ul>
        </form>
      </CardContent>
    </Card>
  );
}
