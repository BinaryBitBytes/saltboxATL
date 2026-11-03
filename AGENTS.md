<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Development environment

Cloud Agents run PostgreSQL 16 on the VM. The role, database, and password are `saltbox`, the same values as `.env.example` and `docker-compose.yml`. Boot starts that cluster, copies `.env.example` to `.env` when `.env` is missing, and serves the app with `npm run dev` at http://localhost:3000. Leave the dev server on localhost. Next.js 16 blocks client scripts when the browser host is not the host the dev server was started with, so `--hostname 0.0.0.0` leaves http://127.0.0.1 without hydration.

`npm run dev` loads `.env`. `npm run db:migrate` does not, because `tsx` never reads that file. Export it before migrating:

```bash
set -a
source .env
set +a
npm run db:migrate
```

`npm test` is the automated check (Mocha). It builds Next.js and signs in with the seeded demo accounts. Composio PDF recognition is optional and stays off until `COMPOSIO_API_KEY` is set. Laptop setup can still use `docker compose up -d postgres` from the README.
