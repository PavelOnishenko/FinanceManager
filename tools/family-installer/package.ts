import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { COMPATIBILITY_DATE, RELEASE_VERSION } from "./release";

export const FIXED_FILES = [
  "installer/installer.cjs",
  "worker/worker.js",
  "wrangler.template.json",
  "runtime/node.exe",
  "runtime/LICENSE",
  "wrangler/node_modules/wrangler/bin/wrangler.js",
  "wrangler/node_modules/wrangler/wrangler-dist/cli.js",
  "Start setup.cmd",
  "RELEASE_NOTES.ru.md",
  "THIRD_PARTY_NOTICES.txt"
] as const;

export async function resolvePackageFile(root: string, relative: string): Promise<string> {
  const filename = path.resolve(root, relative);
  assert((await stat(filename)).isFile(), `Not a package file: ${relative}`);
  return filename;
}

export function migrationSequence(names: string[]): string[] {
  assert(names.length > 0, "No migrations in package");
  const numbered = names.map(name => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    assert(match, `Invalid migration name: ${name}`);
    return { name, number: Number(match[1]) };
  }).sort((a, b) => a.number - b.number);
  for (const [index, migration] of numbered.entries())
    assert.equal(migration.number, index + 1, `Missing or duplicate migration number: ${migration.name}`);
  return numbered.map(migration => migration.name);
}

export function validateAppliedMigrations(packaged: string[], applied: string[]): void {
  assert(applied.length <= packaged.length && applied.every((name, index) => name === packaged[index]),
    "Applied migrations are not a prefix of the package; stop and inspect the installed release");
}

// todo I want return type here
export function instanceConfig(accountId: string, databaseId: string, workerName: string, databaseName: string) {
  assert(/^[a-f0-9]{32}$/.test(accountId), "Invalid Cloudflare account ID");
  assert(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId), "Invalid D1 database ID");
  assert(/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName), "Invalid Worker name");
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(databaseName), "Invalid database name");
  return {
    name: workerName,
    account_id: accountId,
    main: "worker/worker.js",
    no_bundle: true,
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: true,
    vars: { APP_RELEASE_VERSION: String(RELEASE_VERSION) },
    d1_databases: [{
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "migrations"
    }]
  };
}

export function configTemplate() {
  const config = instanceConfig("0".repeat(32), "00000000-0000-0000-0000-000000000000", "template", "template");
  config.name = "__WORKER_NAME__";
  config.account_id = "__ACCOUNT_ID__";
  config.d1_databases[0]!.database_id = "__DATABASE_ID__";
  config.d1_databases[0]!.database_name = "__DATABASE_NAME__";
  return config;
}

export async function validatePackage(root: string, files: readonly string[]): Promise<string[]> {
  for (const name of files)
    await resolvePackageFile(root, name);
  const configFileContents = await readFile((await resolvePackageFile(root, "wrangler.template.json")), "utf8");
  assert.deepEqual(JSON.parse(configFileContents), configTemplate(), "Invalid or mismatched release configuration template");
  const migrations = migrationSequence(await readdir(path.join(root, "migrations")));
  for (const name of migrations)
    await resolvePackageFile(root, `migrations/${name}`);
  return migrations;
}
