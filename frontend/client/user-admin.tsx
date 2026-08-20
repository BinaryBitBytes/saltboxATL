"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  createManagedUser,
  updateManagedUser,
} from "@/backend/server/auth-actions";
import {
  USER_ROLES,
  type PublicUser,
  type UserRole,
} from "@/lib/inventory-schema";
import {
  PasswordSchema,
  PersonNameSchema,
  EmailSchema,
} from "@/lib/validation/fields";
import { roleLabel } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Field, NativeSelect } from "@/frontend/client/field";

const CreateUserFormSchema = z.object({
  name: PersonNameSchema,
  email: EmailSchema,
  password: PasswordSchema,
  role: z.enum(USER_ROLES),
});

type CreateUserFormValues = z.infer<typeof CreateUserFormSchema>;

export function UserAdmin({
  users,
  currentUserId,
}: {
  users: PublicUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(CreateUserFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "associate",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await createManagedUser(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      form.reset({ name: "", email: "", password: "", role: "associate" });
      router.refresh();
    });
  });

  function patchUser(payload: {
    id: string;
    role?: UserRole;
    isActive?: boolean;
  }) {
    setError(null);
    startTransition(async () => {
      const result = await updateManagedUser(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add teammate</CardTitle>
          <CardDescription>
            Managers can create users, associates, and additional managers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
              <Input id="name" {...form.register("name")} />
            </Field>
            <Field
              label="Email"
              htmlFor="email"
              error={form.formState.errors.email?.message}
            >
              <Input id="email" type="email" {...form.register("email")} />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              error={form.formState.errors.password?.message}
            >
              <Input id="password" type="password" {...form.register("password")} />
            </Field>
            <Field label="Role" htmlFor="role" error={form.formState.errors.role?.message}>
              <NativeSelect id="role" {...form.register("role")}>
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-2">
              {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Create user"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <NativeSelect
                  value={user.role}
                  disabled={pending || user.id === currentUserId}
                  onChange={(event) =>
                    patchUser({
                      id: user.id,
                      role: event.target.value as UserRole,
                    })
                  }
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </NativeSelect>
              </TableCell>
              <TableCell>
                <Badge variant={user.isActive ? "secondary" : "destructive"}>
                  {user.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending || user.id === currentUserId}
                  onClick={() =>
                    patchUser({ id: user.id, isActive: !user.isActive })
                  }
                >
                  {user.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
