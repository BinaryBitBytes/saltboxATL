const COLUMN_TYPES =
  /^(uuid|text|integer|int|bigint|smallint|boolean|double|jsonb|timestamptz|timestamp|numeric|real|date)\b/i;

/**
 * Columns present after applying SQL in order.
 * `CREATE TABLE IF NOT EXISTS` does not add columns to a table that already
 * exists, so later `ADD COLUMN` statements are what heal that drift.
 */
export function columnsAfterSql(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
  let current: string | null = null;

  for (const rawLine of stripped.split("\n")) {
    const line = rawLine.trim();
    const opened = /^CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(/i.exec(line);
    if (opened) {
      current = opened[1]?.toLowerCase() ?? null;
      if (current && !tables.has(current)) tables.set(current, new Set());
      continue;
    }
    if (current && /^\)\s*;?\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const column = /^([a-z_][a-z0-9_]*)\s+(.+)$/i.exec(line);
      const name = column?.[1]?.toLowerCase();
      const rest = column?.[2] ?? "";
      if (
        name &&
        COLUMN_TYPES.test(rest) &&
        !name.startsWith("constraint") &&
        name !== "primary" &&
        name !== "unique" &&
        name !== "check" &&
        name !== "foreign"
      ) {
        tables.get(current)?.add(name);
      }
    }

    const added =
      /^ALTER TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/i.exec(
        line,
      );
    if (added) {
      const table = added[1]?.toLowerCase();
      const column = added[2]?.toLowerCase();
      if (!table || !column) continue;
      const columns = tables.get(table) ?? new Set<string>();
      columns.add(column);
      tables.set(table, columns);
    }
  }

  return tables;
}

export function requireColumns(
  tables: Map<string, Set<string>>,
  table: string,
  columns: readonly string[],
): string[] {
  const present = tables.get(table) ?? new Set<string>();
  return columns.filter((column) => !present.has(column));
}
