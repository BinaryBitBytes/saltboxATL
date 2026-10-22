This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Authentication

Saltbox uses credential login with httpOnly session cookies. Roles:

| Role | Access |
| --- | --- |
| **User** | Dashboard, on-hand inventory, the transaction log, and placing orders |
| **Associate** | Warehouse execution: receiving, putaway, cubing, shipping, and order fulfillment, plus a read-only inbound forecast |
| **3PL** | Same warehouse execution as an associate, without placing customer orders, adjusting inventory, or changing buyer POs and job IDs |
| **Coordinator** | Upload buyer purchase orders (vendor, carrier, project, and expected lines) for inbound forecasting |
| **Project Manager** | On-hand inventory and assigning job IDs to buyer purchase orders the coordinator uploaded |
| **Driver** | Manifest and pack list for a load, delivery scans, proof photos, and delivery notes |
| **Manager** | Every process, including adjustments, locations, and user admin. This is the admin who can switch between both division inventories |
| **Security Associate** | Same warehouse execution as an associate, limited to the Security division inventory |
| **Security Manager** | Same processes as a manager, limited to the Security division inventory and Security logins |

Divisions keep inventory in separate rows:

| Division | Name | Who sees it |
| --- | --- | --- |
| **Division_1** | Hyperscale | Existing Hyperscale roles, and the admin manager when that division is selected |
| **Division_2** | Security | Security associate, Security manager, and the admin manager when that division is selected |

The manager uses the division menu at the top right of the navigation bar to change which inventory is on screen. Every other login stays in its own division, even if a division cookie is present.

Demo accounts (password `saltbox123`) are seeded on first boot:

- `manager@saltbox.local`
- `associate@saltbox.local`
- `user@saltbox.local`
- `coordinator@saltbox.local`
- `threepl@saltbox.local`
- `project@saltbox.local`
- `driver@saltbox.local`
- `security@saltbox.local`
- `secmanager@saltbox.local`

Set `SESSION_SECRET` in production. If it is missing, the app writes a generated secret to `data/.session-secret`.

## PostgreSQL

Warehouse data (rooms, locations, on-hand items, orders, stock log, users, and photo metadata) is stored in PostgreSQL when `DATABASE_URL` is set. Photo image files stay under `data/photos/`.

```bash
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
npm run dev
```

Without `DATABASE_URL`, the app keeps using `data/inventory.json`. The first PostgreSQL boot imports that JSON file if it exists, otherwise it seeds demo rooms, bins, and accounts.

Check storage with `GET /api/health`.

## Inventory spreadsheets

On-hand inventory can be exported as a CSV spreadsheet from **Inventory**. Excel and Google Sheets open the file directly. Managers can import the same columns (`SKU`, `UPC`, `Description`, `Batch`, `Qty`, `Location`) to load existing stock:

- **Set on-hand quantities** replaces the quantity for each SKU + batch + location in the file.
- **Add to existing quantities** increases those lines.

Location codes must already exist and be active. Save Excel workbooks as **CSV UTF-8** before importing, and format SKU/UPC/Location as text so leading zeros are kept.

## Install as an app

Saltbox is a Progressive Web App. On a phone or desktop, open the site in Chrome, Edge, or Safari and use **Install app**, **Add to Dock**, or **Add to Home Screen**. The sign-in page also shows install help, and Chromium browsers get an **Install app** button after the install prompt is available.

Installed windows open in standalone mode (no browser chrome) and still use the same sign-in session.

## Validation and tests

Input is checked with Zod plus inventory/auth safeguards:

- User records never return `passwordHash`; create/update payloads reject secret fields
- `passwordHash` and invoice prices stay on the Zod schema. Page data, server actions, and JSON responses are hydrated before they reach the browser, which drops credential keys and strips HTML from text
- Passwords need 8+ characters with a letter and a number; sign-in locks after 5 failures
- HTML/control characters, oversized fields, and unsafe SKU/UPC values are rejected. Location, room, cube, adjustment, and case-item text rejects markup on the way in
- Shipping, shortages, and damage cannot take more than on-hand stock or use inactive locations
- Quantities at or above 500 units (200 for shipments, 20 pallets on a receiving header) require a confirmation checkbox and a matching re-entered amount
- Spreadsheet import is atomic: invalid rows block the whole file, and unknown or inactive locations are rejected

```bash
npm test
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
