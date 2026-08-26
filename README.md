This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Authentication

Saltbox uses credential login with httpOnly session cookies. Roles:

| Role | Access |
| --- | --- |
| **User** | Dashboard, on-hand inventory, and the transaction log |
| **Associate** | User access plus receiving and shipping |
| **Manager** | Associate access plus adjustments, spreadsheet import, rooms/locations, and user admin |

Demo accounts (password `saltbox123`) are seeded on first boot:

- `manager@saltbox.local`
- `associate@saltbox.local`
- `user@saltbox.local`

Set `SESSION_SECRET` in production. If it is missing, the app writes a generated secret to `data/.session-secret`.

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
- Passwords need 8+ characters with a letter and a number; sign-in locks after 5 failures
- HTML/control characters, oversized fields, and unsafe SKU/UPC values are rejected
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
