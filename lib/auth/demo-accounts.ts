import type { UserRole } from "@/lib/inventory-schema";

export const DEMO_PASSWORD = "saltbox123";

export const DEMO_ACCOUNTS: Array<{
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
}> = [
  {
    id: "bbbb1111-1111-4111-8111-111111111111",
    name: "Avery Manager",
    username: "manager",
    email: "manager@saltbox.local",
    role: "manager",
  },
  {
    id: "bbbb2222-2222-4222-8222-222222222222",
    name: "Jordan Associate",
    username: "associate",
    email: "associate@saltbox.local",
    role: "associate",
  },
  {
    id: "bbbb3333-3333-4333-8333-333333333333",
    name: "Riley User",
    username: "user",
    email: "user@saltbox.local",
    role: "user",
  },
  {
    id: "bbbb4444-4444-4444-8444-444444444444",
    name: "Morgan Coordinator",
    username: "coordinator",
    email: "coordinator@saltbox.local",
    role: "coordinator",
  },
  {
    id: "bbbb5555-5555-4555-8555-555555555555",
    name: "Casey Logistics",
    username: "threepl",
    email: "threepl@saltbox.local",
    role: "threepl",
  },
  {
    id: "bbbb6666-6666-4666-8666-666666666666",
    name: "Parker Project",
    username: "project",
    email: "project@saltbox.local",
    role: "project-manager",
  },
  {
    id: "bbbb7777-7777-4777-8777-777777777777",
    name: "Devon Driver",
    username: "driver",
    email: "driver@saltbox.local",
    role: "driver",
  },
];
