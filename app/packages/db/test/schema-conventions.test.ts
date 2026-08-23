/**
 * Phase 2 fitness tests.
 *
 * There is no application code yet, so what is worth testing is that the design
 * rules recorded in the ADRs actually hold in the schema — and keep holding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableColumns, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as identity from "../src/schema/identity.js";
import * as fleet from "../src/schema/fleet.js";
import * as service from "../src/schema/service.js";
import * as ops from "../src/schema/ops.js";

const MODULES = { identity, fleet, service, ops } as Record<string, Record<string, unknown>>;

function tablesOf(mod: Record<string, unknown>): PgTable[] {
  return Object.values(mod).filter((v): v is PgTable => v instanceof PgTable);
}

const ALL: Array<{ module: string; table: PgTable }> = Object.entries(MODULES)
  .flatMap(([module, mod]) => tablesOf(mod).map((table) => ({ module, table })));

test("the schema actually defines tables", () => {
  assert.ok(ALL.length >= 40, `expected at least 40 tables, found ${ALL.length}`);
});

test("every table carries the universal columns (docs §Phase 3 conventions)", () => {
  const required = ["id", "createdAt", "updatedAt", "deletedAt", "version"];
  const missing: string[] = [];
  for (const { table } of ALL) {
    const cols = Object.keys(getTableColumns(table));
    for (const r of required) {
      if (!cols.includes(r)) missing.push(`${getTableName(table)}.${r}`);
    }
  }
  assert.deepEqual(missing, [], `tables missing universal columns: ${missing.join(", ")}`);
});

test("every table has a primary key", () => {
  const noPk = ALL.filter(({ table }) => {
    const cols = Object.values(getTableColumns(table));
    return !cols.some((c) => c.primary);
  }).map(({ table }) => getTableName(table));
  assert.deepEqual(noPk, [], `tables without a primary key: ${noPk.join(", ")}`);
});

test("table and column names are snake_case", () => {
  const bad: string[] = [];
  const snake = /^[a-z][a-z0-9_]*$/;
  for (const { table } of ALL) {
    const t = getTableName(table);
    if (!snake.test(t)) bad.push(`table ${t}`);
    for (const col of Object.values(getTableColumns(table))) {
      if (!snake.test(col.name)) bad.push(`${t}.${col.name}`);
    }
  }
  assert.deepEqual(bad, [], `non snake_case identifiers: ${bad.join(", ")}`);
});

test("soft delete is nullable and version is not (optimistic concurrency)", () => {
  const bad: string[] = [];
  for (const { table } of ALL) {
    const cols = getTableColumns(table) as Record<string, { notNull: boolean }>;
    if (cols.deletedAt?.notNull) bad.push(`${getTableName(table)}.deleted_at must be nullable`);
    if (!cols.version?.notNull) bad.push(`${getTableName(table)}.version must be NOT NULL`);
  }
  assert.deepEqual(bad, [], bad.join("; "));
});

test("money is stored as integer paise, never floating point", () => {
  const bad: string[] = [];
  for (const { table } of ALL) {
    for (const col of Object.values(getTableColumns(table))) {
      if (!/paise$/.test(col.name)) continue;
      if (col.columnType !== "PgInteger") {
        bad.push(`${getTableName(table)}.${col.name} is ${col.columnType}, expected PgInteger`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("; "));
});

test("ADR-0005: an incident records who confirmed it before any dispatch", () => {
  const cols = Object.keys(getTableColumns(ops.incidents));
  for (const c of ["detectedByModel", "modelConfidence", "confirmedBy", "confirmedAt", "handedOffTo112At"]) {
    assert.ok(cols.includes(c), `incidents.${c} is required by ADR-0005`);
  }
});

test("ADR-0004: offline replay is idempotent and conflicts are logged", () => {
  const sync = Object.keys(getTableColumns(ops.syncOperations));
  assert.ok(sync.includes("opId"), "sync_operations.op_id is the client idempotency key");
  assert.ok(sync.includes("clientUpdatedAt"), "sync_operations.client_updated_at drives LWW");
  const conflict = Object.keys(getTableColumns(ops.conflictLog));
  for (const c of ["rule", "serverValue", "clientValue", "resolvedValue"]) {
    assert.ok(conflict.includes(c), `conflict_log.${c} is required to audit a resolution`);
  }
});

test("every AI prediction is auditable without storing the input", () => {
  const cols = Object.keys(getTableColumns(ops.modelPredictions));
  for (const c of ["capability", "modelVersion", "inputHash", "usedFallback"]) {
    assert.ok(cols.includes(c), `model_predictions.${c} is required`);
  }
  assert.ok(!cols.includes("input"), "raw model input must never be stored — hash only");
});
