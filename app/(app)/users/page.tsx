import { T } from "@/frontend/client/language";
import { requirePermission } from "@/backend/server/dal";
import { listPublicUsers } from "@/backend/server/auth-service";
import { readAccounts } from "@/backend/server/account-store";
import { UserAdmin } from "@/frontend/client/user-admin";
import {
  assignableRoles,
  canAssignDivisions,
  canSwitchDivision,
  divisionForRole,
  divisionOf,
} from "@/lib/divisions";
import { siteLabel } from "@/lib/sites/database";
import { sitesInDivision } from "@/lib/sites/access";
import { hydrateForDom } from "@/lib/validation/dom-hydration";

export default async function UsersPage() {
  const currentUser = await requirePermission("manageUsers");
  const users = await listPublicUsers(currentUser.role);
  const roles = assignableRoles(currentUser.role);
  const accounts = await readAccounts();
  const division = divisionForRole(currentUser.role);
  const visibleSites = canSwitchDivision(currentUser.role)
    ? (accounts.sites ?? [])
    : sitesInDivision(accounts.sites ?? [], division);
  const sites = [...visibleSites]
    .sort((left, right) => left.codename.localeCompare(right.codename))
    .map((site) => ({
      id: site.id,
      label: siteLabel(site),
      division: divisionOf(site),
    }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Users</T></h1>
        <p className="text-sm text-muted-foreground"><T>Managers and IT admins assign roles and choose which work sites and divisions each login can open. A checked site or division is allowed. The home site is the one selected in the dropdown. The home division follows the role and stays checked.</T></p>
      </div>
      <UserAdmin
        users={hydrateForDom(users)}
        currentUserId={currentUser.id}
        assignableRoles={roles}
        sites={sites}
        canAssignDivisions={canAssignDivisions(currentUser.role)}
      />
    </div>
  );
}
