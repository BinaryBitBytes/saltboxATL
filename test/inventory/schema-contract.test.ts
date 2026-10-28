import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";
import { expect } from "chai";
import { MIGRATIONS } from "@/backend/server/db";
import {
  LOCATION_SITE_COLUMN,
  SITE_COLUMNS,
  SITE_DATABASE_COLUMNS,
  SITE_TRANSFER_COLUMNS,
  SITE_TRANSFER_SQL_COLUMNS,
  USER_SITE_COLUMN,
} from "@/lib/db/persisted-columns";
import { columnsAfterSql, requireColumns } from "@/lib/db/sql-schema";

const DB_DIR = path.join(process.cwd(), "backend/db");

function migrationSql(): string {
  return MIGRATIONS.map((migration) =>
    fs.readFileSync(path.join(DB_DIR, migration.file), "utf8"),
  ).join("\n");
}

describe("persisted schema matches app types", () => {
  const tables = columnsAfterSql(migrationSql());

  it("gives site_transfers every column the SiteTransfer type stores, including ordered_at", () => {
    const missing = requireColumns(
      tables,
      "site_transfers",
      Object.values(SITE_TRANSFER_COLUMNS),
    );
    expect(missing, "site_transfers is missing columns the app reads and writes").to.deep.equal(
      [],
    );
    expect(SITE_TRANSFER_SQL_COLUMNS).to.include("ordered_at");
  });

  it("keeps sites, users, locations, and site databases aligned with their type fields", () => {
    expect(requireColumns(tables, "sites", Object.values(SITE_COLUMNS))).to.deep.equal([]);
    expect(requireColumns(tables, "users", Object.values(USER_SITE_COLUMN))).to.deep.equal([]);
    expect(
      requireColumns(tables, "locations", Object.values(LOCATION_SITE_COLUMN)),
    ).to.deep.equal([]);
    expect(requireColumns(tables, "site_databases", SITE_DATABASE_COLUMNS)).to.deep.equal([]);
  });

  it("adds ordered_at when an older site_transfers table was created without it", () => {
    const drifted = `
      CREATE TABLE site_transfers (
        id UUID PRIMARY KEY,
        sku TEXT NOT NULL
      );
    `;
    expect(
      requireColumns(columnsAfterSql(drifted), "site_transfers", ["ordered_at"]),
    ).to.deep.equal(["ordered_at"]);

    const heal = fs.readFileSync(
      path.join(DB_DIR, "015_site_transfer_columns.sql"),
      "utf8",
    );
    expect(
      requireColumns(columnsAfterSql(`${drifted}\n${heal}`), "site_transfers", [
        ...Object.values(SITE_TRANSFER_COLUMNS),
      ]),
    ).to.deep.equal([]);
  });

  it("loads and writes site transfers with the same columns as the type", () => {
    const store = fs.readFileSync(
      path.join(process.cwd(), "backend/server/pg-store.ts"),
      "utf8",
    );
    for (const column of Object.values(SITE_TRANSFER_COLUMNS)) {
      expect(store, column).to.include(column);
    }
    expect(store).to.include("SITE_TRANSFER_SQL_COLUMNS.join");
    expect(store).to.include("ORDER BY ordered_at");
  });
});
