import { T } from "@/frontend/client/language";
import { requirePermission } from "@/backend/server/dal";
import { listPublicUsers } from "@/backend/server/auth-service";
import { UserAdmin } from "@/frontend/client/user-admin";
import { assignableRoles } from "@/lib/divisions";

export default async function UsersPage() {
  const currentUser = await requirePermission("manageUsers");
  const users = await listPublicUsers(currentUser.role);
  const roles = assignableRoles(currentUser.role);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Users</T></h1>
        <p className="text-sm text-muted-foreground"><T>Managers create and deactivate warehouse logins. The admin manager can open both divisions. A Security manager only administers Security logins.</T></p>
      </div>
      <UserAdmin
        users={users}
        currentUserId={currentUser.id}
        assignableRoles={roles}
      />
    </div>
  );
}
