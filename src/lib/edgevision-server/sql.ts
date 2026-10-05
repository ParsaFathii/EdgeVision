// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { Prisma } from "@prisma/client";

/**
 * Raw-SQL condition builders for ISO-text DateTime columns.
 *
 * WHY raw SQL: the engine-service writes every DateTime column as an
 * ISO-8601 UTC TEXT string ("2026-10-05T05:45:20.486Z" — frozen contract),
 * while Prisma's query engine binds DateTime filter parameters to SQLite as
 * numeric epoch values. SQLite's cross-type ordering (numbers sort before
 * ALL text) then silently corrupts the filters: `ts >= ?` matches EVERY row
 * regardless of the date and `ts <= ?` matches NONE. Binding ISO strings
 * through $queryRaw compares text-to-text and is exact, so every time-range
 * filter (and the routes that combine it with other filters) is built here.
 *
 * Column names passed to these helpers are hardcoded by the calling routes
 * (never user input); values are always bound as parameters.
 */

/** `column = ?` condition with a parameter-bound value. */
export function eqCond(column: string, value: string | number): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`\`${column}\``)} = ${value}`;
}

/** `column >= ?` / `column <= ?` conditions from a Date range. */
export function timeConds(column: string, from: Date | null, to: Date | null): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  const col = Prisma.raw(`\`${column}\``);
  if (from) conds.push(Prisma.sql`${col} >= ${from.toISOString()}`);
  if (to) conds.push(Prisma.sql`${col} <= ${to.toISOString()}`);
  return conds;
}

/** Assemble `WHERE 1=1 AND ...` from a list of conditions. */
export function whereSql(conds: Prisma.Sql[]): Prisma.Sql {
  return Prisma.sql`WHERE ${Prisma.join([Prisma.sql`1=1`, ...conds], " AND ")}`;
}

/** Whitelisted ORDER BY direction fragment. */
export function dirSql(asc: boolean): Prisma.Sql {
  return Prisma.raw(asc ? "ASC" : "DESC");
}
