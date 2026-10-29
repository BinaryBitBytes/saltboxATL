"use client";

import { T } from "@/frontend/client/language";
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
  type Division,
  type PublicUser,
  type UserRole,
} from "@/lib/inventory-schema";
import {
  PasswordSchema,
  PersonNameSchema,
  EmailSchema,
  UsernameSchema,
} from "@/lib/validation/fields";
import { roleLabel } from "@/lib/auth/permissions";
import {
  DIVISION_CATALOG,
  divisionForRole,
  divisionLabel,
  viewableDivisions,
} from "@/lib/divisions";
import { canAccessMultiSite } from "@/lib/sites/access";
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
  username: UsernameSchema,
  email: EmailSchema,
  password: PasswordSchema,
  role: z.enum(USER_ROLES),
});

type CreateUserFormValues = z.infer<typeof CreateUserFormSchema>;

export type AssignableSite = {
  id: string;
  label: string;
  division: Division;
};

function sitesForRole(role: UserRole, sites: readonly AssignableSite[]): AssignableSite[] {
  const division = divisionForRole(role);
  return sites.filter((site) => site.division === division);
}

function defaultGrant(role: UserRole, sites: readonly AssignableSite[]): {
  siteId: string;
  allowedSiteIds: string[];
} {
  const home = sitesForRole(role, sites)[0];
  return { siteId: home?.id ?? "", allowedSiteIds: home ? [home.id] : [] };
}

function effectiveAllowed(user: PublicUser, sites: readonly AssignableSite[]): string[] {
  const list = sitesForRole(user.role, sites);
  if (user.allowedSiteIds != null) {
    const allowed = new Set(user.allowedSiteIds);
    return list.filter((site) => allowed.has(site.id)).map((site) => site.id);
  }
  if (canAccessMultiSite(user.role)) return list.map((site) => site.id);
  const home = list.find((site) => site.id === user.siteId) ?? list[0];
  return home ? [home.id] : [];
}

function DivisionAccessEditor({
  role,
  allowedDivisions,
  disabled,
  onChange,
}: {
  role: UserRole;
  allowedDivisions: readonly Division[];
  disabled?: boolean;
  onChange: (next: Division[]) => void;
}) {
  const home = divisionForRole(role);
  const allowed = new Set(allowedDivisions);
  return (
    <ul className="grid min-w-40 gap-0.5">
      {DIVISION_CATALOG.map((entry) => {
        const checked = allowed.has(entry.id) || entry.id === home;
        const locked = entry.id === home;
        return (
          <li key={entry.id}>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="size-3.5 accent-foreground"
                checked={checked}
                disabled={disabled || locked}
                aria-label={divisionLabel(entry.id)}
                onChange={() => {
                  const next = checked
                    ? allowedDivisions.filter((id) => id !== entry.id)
                    : [...allowedDivisions, entry.id];
                  if (!next.includes(home)) return;
                  onChange(next);
                }}
              />
              <span><T>{divisionLabel(entry.id)}</T></span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function SiteAccessEditor({
  sites,
  siteId,
  allowedSiteIds,
  disabled,
  onChange,
}: {
  sites: readonly AssignableSite[];
  siteId: string;
  allowedSiteIds: readonly string[];
  disabled?: boolean;
  onChange: (next: { siteId: string; allowedSiteIds: string[] }) => void;
}) {
  const allowed = new Set(allowedSiteIds);
  const homeOptions = sites.filter((site) => allowed.has(site.id));
  const homeValue = homeOptions.some((site) => site.id === siteId)
    ? siteId
    : (homeOptions[0]?.id ?? "");
  return (
    <div className="grid min-w-44 gap-1">
      <span className="text-[0.625rem] text-muted-foreground"><T>Home site</T></span>
      <NativeSelect
        aria-label="Home site"
        value={homeValue}
        disabled={disabled || homeOptions.length === 0}
        onChange={(event) =>
          onChange({ siteId: event.target.value, allowedSiteIds: [...allowedSiteIds] })
        }
      >
        {homeOptions.map((site) => (
          <option key={site.id} value={site.id}>
            {site.label}
          </option>
        ))}
      </NativeSelect>
      <ul className="grid gap-0.5">
        {sites.map((site) => {
          const checked = allowed.has(site.id);
          return (
            <li key={site.id}>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={checked}
                  disabled={disabled}
                  aria-label={site.label}
                  onChange={() => {
                    const next = checked
                      ? allowedSiteIds.filter((id) => id !== site.id)
                      : [...allowedSiteIds, site.id];
                    if (next.length === 0) return;
                    onChange({
                      siteId: next.includes(siteId) ? siteId : next[0]!,
                      allowedSiteIds: next,
                    });
                  }}
                />
                <span>{site.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function UserAdmin({
  users,
  currentUserId,
  assignableRoles,
  sites,
  canAssignDivisions,
}: {
  users: PublicUser[];
  currentUserId: string;
  assignableRoles: readonly UserRole[];
  sites: readonly AssignableSite[];
  canAssignDivisions: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const defaultRole = assignableRoles.includes("associate")
    ? "associate"
    : (assignableRoles[0] ?? "associate");
  const initialGrant = defaultGrant(defaultRole, sites);
  const [createRole, setCreateRole] = useState<UserRole>(defaultRole);
  const [createGrant, setCreateGrant] = useState(initialGrant);
  const [createDivisions, setCreateDivisions] = useState<Division[]>(
    viewableDivisions({ role: defaultRole }),
  );
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(CreateUserFormSchema),
    defaultValues: {
      name: "",
      username: "",
      email: "",
      password: "",
      role: defaultRole,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const grant = createGrant.allowedSiteIds.length
        ? createGrant
        : defaultGrant(values.role, sites);
      const result = await createManagedUser({
        ...values,
        siteId: grant.siteId || undefined,
        allowedSiteIds: grant.allowedSiteIds.length ? grant.allowedSiteIds : undefined,
        allowedDivisions: canAssignDivisions ? createDivisions : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      form.reset({ name: "", username: "", email: "", password: "", role: defaultRole });
      setCreateRole(defaultRole);
      setCreateGrant(defaultGrant(defaultRole, sites));
      setCreateDivisions(viewableDivisions({ role: defaultRole }));
      router.refresh();
    });
  });

  function patchUser(payload: {
    id: string;
    role?: UserRole;
    isActive?: boolean;
    siteId?: string;
    allowedSiteIds?: string[];
    allowedDivisions?: Division[];
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
          <CardTitle><T>Add teammate</T></CardTitle>
          <CardDescription><T>Assign Hyperscale or Security roles. Security associate and Security manager sign in to the Security inventory only.</T></CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
              <Input id="name" {...form.register("name")} />
            </Field>
            <Field
              label="Username"
              htmlFor="username"
              error={form.formState.errors.username?.message}
            >
              <Input id="username" autoComplete="username" {...form.register("username")} />
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
              <NativeSelect
                id="role"
                {...form.register("role", {
                  onChange: (event) => {
                    const role = event.target.value as UserRole;
                    setCreateRole(role);
                    const nextSites = sitesForRole(role, sites);
                    if (!nextSites.some((site) => site.id === createGrant.siteId)) {
                      setCreateGrant(defaultGrant(role, sites));
                    }
                    const home = divisionForRole(role);
                    setCreateDivisions((current) =>
                      current.includes(home) ? [...current] : [home],
                    );
                  },
                })}
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    <T>{roleLabel(role)}</T>
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {canAssignDivisions ? (
              <div className="sm:col-span-2">
                <span className="text-[0.625rem] text-muted-foreground"><T>Division access</T></span>
                <DivisionAccessEditor
                  role={createRole}
                  allowedDivisions={createDivisions}
                  disabled={pending}
                  onChange={setCreateDivisions}
                />
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <SiteAccessEditor
                sites={sitesForRole(createRole, sites)}
                siteId={createGrant.siteId}
                allowedSiteIds={createGrant.allowedSiteIds}
                disabled={pending}
                onChange={setCreateGrant}
              />
            </div>
            <div className="sm:col-span-2">
              {error ? (
                <p className="mb-2 text-xs text-destructive">
                  <T>{error}</T>
                </p>
              ) : null}
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
            <TableHead><T>Name</T></TableHead>
            <TableHead><T>Username</T></TableHead>
            <TableHead><T>Email</T></TableHead>
            <TableHead><T>Role</T></TableHead>
            <TableHead><T>Site access</T></TableHead>
            <TableHead><T>Division access</T></TableHead>
            <TableHead><T>Status</T></TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.name}</TableCell>
              <TableCell>{user.username}</TableCell>
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
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      <T>{roleLabel(role)}</T>
                    </option>
                  ))}
                </NativeSelect>
              </TableCell>
              <TableCell>
                <SiteAccessEditor
                  sites={sitesForRole(user.role, sites)}
                  siteId={user.siteId ?? ""}
                  allowedSiteIds={effectiveAllowed(user, sites)}
                  disabled={pending || user.id === currentUserId}
                  onChange={(next) =>
                    patchUser({
                      id: user.id,
                      siteId: next.siteId,
                      allowedSiteIds: next.allowedSiteIds,
                    })
                  }
                />
              </TableCell>
              <TableCell>
                {canAssignDivisions ? (
                  <DivisionAccessEditor
                    role={user.role}
                    allowedDivisions={viewableDivisions(user)}
                    disabled={pending || user.id === currentUserId}
                    onChange={(next) =>
                      patchUser({
                        id: user.id,
                        allowedDivisions: next,
                      })
                    }
                  />
                ) : (
                  <T>{divisionLabel(divisionForRole(user.role))}</T>
                )}
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
