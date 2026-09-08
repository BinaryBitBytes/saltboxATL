import { createClient } from "@neondatabase/neon-js";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

function neonPublicUrl(
  publicValue: string | undefined,
  pulledValue: string | undefined,
  publicName: string,
  pulledName: string,
): string {
  const value = publicValue?.trim() || pulledValue?.trim();
  if (!value) {
    throw new Error(
      `Missing ${publicName}. Run \`neon env pull\`, then copy ${pulledName} to ${publicName} so Next.js can expose it to the browser.`,
    );
  }
  return value;
}

export const neon = createClient({
  auth: {
    url: neonPublicUrl(
      process.env.NEXT_PUBLIC_NEON_AUTH_URL,
      process.env.NEON_AUTH_BASE_URL,
      "NEXT_PUBLIC_NEON_AUTH_URL",
      "NEON_AUTH_BASE_URL",
    ),
    adapter: BetterAuthReactAdapter(),
  },
  dataApi: {
    url: neonPublicUrl(
      process.env.NEXT_PUBLIC_NEON_DATA_API_URL,
      process.env.NEON_DATA_API_URL,
      "NEXT_PUBLIC_NEON_DATA_API_URL",
      "NEON_DATA_API_URL",
    ),
  },
});
