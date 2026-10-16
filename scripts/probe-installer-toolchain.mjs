// Local Task 1 probe. Does not log in, deploy, or execute remote D1 commands.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert(process.argv[2], "Usage: node scripts/probe-installer-toolchain.mjs <scratch-parent-directory>");
const repository = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const scratch = mkdtempSync(path.join(path.resolve(process.argv[2]), "installer-task1-"));
const instance = path.join(scratch, "instance with spaces");
mkdirSync(instance);
cpSync(path.join(repository, "migrations"), path.join(instance, "migrations"), { recursive: true });
writeFileSync(path.join(instance, "empty.env"), "");
writeFileSync(path.join(instance, "wrangler.json"), JSON.stringify({
  name: "installer-offline-proof",
  main: path.join(repository, "src/index.ts"),
  compatibility_date: "2026-09-16",
  account_id: "00000000000000000000000000000000",
  d1_databases: [{
    binding: "DB", database_name: "installer-offline-proof",
    database_id: "00000000-0000-0000-0000-000000000000", migrations_dir: "./migrations"
  }]
}));

// Do not inherit provider credentials, Node preload options, or deployment overrides.
// Preserve OS paths as-is; do not redirect HOME or credential storage.
const environment = {};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
  if (process.env[key] !== undefined)
    environment[key] = process.env[key];
}
Object.assign(environment, {
  WRANGLER_SEND_METRICS: "false", WRANGLER_HIDE_BANNER: "true", WRANGLER_LOG_SANITIZE: "true",
  WRANGLER_LOG_PATH: path.join(scratch, "logs") + path.sep, CI: "true", NO_COLOR: "1"
});

function run(label, args) {
  const result = spawnSync(process.execPath, [
    path.join(repository, "node_modules/wrangler/bin/wrangler.js"), ...args,
    `--config=${path.join(instance, "wrangler.json")}`, `--env-file=${path.join(instance, "empty.env")}`
  ], { cwd: instance, env: environment, encoding: "utf8", shell: false, timeout: 60000 });
  writeFileSync(path.join(scratch, `${label}.txt`), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.equal(result.status, 0, `${label}: ${result.error?.message ?? result.stderr}`);
  console.log(`${label}: passed`);
  return result.stdout;
}

const localDatabase = ["DB", "--local", "--persist-to", path.join(scratch, "d1-state")];
function query(label, sql) {
  const results = JSON.parse(run(label, ["d1", "execute", ...localDatabase, "--json", "--command", sql]));
  assert(results.every(result => result.success));
  return results.at(-1).results;
}

console.log(`Evidence directory: ${scratch}`);
console.log(`Node ${process.version}; ${process.platform}/${process.arch}; Wrangler`,
  JSON.parse(readFileSync(path.join(repository, "node_modules/wrangler/package.json"))).version);
for (const command of [[], ["login"], ["auth", "create"], ["auth", "activate"], ["whoami"], ["d1", "create"],
  ["d1", "list"], ["d1", "info"], ["d1", "execute"], ["d1", "migrations", "apply"], ["d1", "migrations", "list"],
  ["secret", "put"], ["secret", "list"], ["deploy"], ["deployments", "list"], ["versions", "view"]]) {
  run(`help-${command.join("-") || "root"}`, [...command, "--help"]);
}
run("apply-first", ["d1", "migrations", "apply", ...localDatabase]);
assert.deepEqual(query("seed-settings", "SELECT * FROM instance_settings"),
  [{ id: 1, display_currency: "RSD", finance_time_zone: "Europe/Belgrade" }]);
const history = query("history-first", "SELECT name FROM d1_migrations ORDER BY id");
assert.deepEqual(history.map(row => row.name), readdirSync(path.join(instance, "migrations")).filter(name => name.endsWith(".sql")).sort());
assert.deepEqual(query("counts", "SELECT (SELECT COUNT(*) FROM categories) AS categories, " +
  "(SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM expenses) AS expenses"),
  [{ categories: 19, members: 0, expenses: 0 }]);
query("change-settings", "UPDATE instance_settings SET display_currency = 'EUR', finance_time_zone = 'Europe/Budapest' WHERE id = 1");
run("apply-repeat", ["d1", "migrations", "apply", ...localDatabase]);
assert.deepEqual(query("history-repeat", "SELECT name FROM d1_migrations ORDER BY id"), history);
assert.deepEqual(query("settings-repeat", "SELECT * FROM instance_settings"),
  [{ id: 1, display_currency: "EUR", finance_time_zone: "Europe/Budapest" }]);
run("pending", ["d1", "migrations", "list", ...localDatabase]);
run("dry-run", ["deploy", "--dry-run", "--outdir", path.join(scratch, "bundle")]);
console.log("Offline probe passed. Remote provider behavior and Windows packaging remain unverified.");
