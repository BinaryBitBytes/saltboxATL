import { requirePermission } from "@/backend/server/dal";
import { listPublicUsers } from "@/backend/server/auth-service";
import { UserAdmin } from "@/frontend/client/user-admin";

export default async function UsersPage() {
  const currentUser = await requirePermission("manageUsers");
  const users = await listPublicUsers();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Managers create and deactivate warehouse logins. Roles control who
          can receive, put away, ship, and post adjustments.
        </p>
      </div>
      <UserAdmin users={users} currentUserId={currentUser.id} />
    </div>
  );
}
