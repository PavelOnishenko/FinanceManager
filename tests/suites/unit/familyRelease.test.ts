import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildFamilyRelease } from "../../../scripts/build-family-release";
import { temporaryDirectory } from "../../infrastructure/temporaryDirectory";
import { configTemplate, FIXED_FILES, instanceConfig, migrationSequence, packageFile, validateAppliedMigrations,
  validatePackage } from "../../../tools/family-installer/package";
import { RELEASE_VERSION } from "../../../tools/family-installer/release";
import { windowsWranglerPackages, type Lock } from "../../../tools/family-installer/toolchain";
import { distributionFiles, writeZip } from "../../../tools/family-installer/zip";

test("builder rejects an output inside the toolchain before copying into itself", async context => {
  const root = await temporaryDirectory(context);
  await assert.rejects(buildFamilyRelease(root, path.join(root, "node_modules/wrangler/releases")), /outside toolchain/);
  assert.deepEqual(await readdir(root), []);
});

test("package rejects missing files, duplicate migrations and path traversal", async context => {
  const root = await temporaryDirectory(context);
  const files = [...FIXED_FILES, "wrangler/node_modules/@esbuild/win32-x64/esbuild.exe"];
  for (const name of files) {
    const filePath = path.join(root, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "fixture");
  }
  await writeFile(path.join(root, "wrangler.template.json"), JSON.stringify(configTemplate()));
  await mkdir(path.join(root, "migrations"));
  await writeFile(path.join(root, "migrations/0001_initial.sql"), "SELECT 1;");
  assert.deepEqual(await validatePackage(root, files), ["0001_initial.sql"]);
  for (const relative of ["../secret", "/absolute", "C:/absolute", "worker/../../secret", "worker\\..\\secret"])
    await assert.rejects(packageFile(root, relative));
  await rm(path.join(root, "wrangler/node_modules/@esbuild/win32-x64/esbuild.exe"));
  await assert.rejects(validatePackage(root, files), /ENOENT/);
  assert.throws(() => migrationSequence(["0001_a.sql", "0001_b.sql"]), /duplicate/);
  assert.throws(() => migrationSequence(["0001_a.sql", "0003_c.sql"]), /Missing/);
  assert.throws(() => migrationSequence(["../0001_a.sql"]), /Invalid/);
  assert.throws(() => migrationSequence([]), /No migrations/);
});

test("migration readback accepts only an exact prefix, preserving numeric order", () => {
  const packaged = migrationSequence(["0003_c.sql", "0001_a.sql", "0002_b.sql"]);
  assert.deepEqual(packaged, ["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
  validateAppliedMigrations(packaged, []);
  validateAppliedMigrations(packaged, ["0001_a.sql", "0002_b.sql"]);
  validateAppliedMigrations(packaged, packaged);
  for (const applied of [["0001_renamed.sql"], ["0002_b.sql"], ["0001_a.sql", "0001_a.sql"], [...packaged, "0004_new.sql"]])
    assert.throws(() => validateAppliedMigrations(packaged, applied), /prefix/);
});

test("customer config uses explicit identities and prebuilt code, without developer bindings", () => {
  const config = instanceConfig("abcdef0123456789abcdef0123456789", "12345678-1234-1234-1234-123456789abc", "family-pilot", "family-db");
  assert.equal(config.account_id, "abcdef0123456789abcdef0123456789");
  assert.equal(config.name, "family-pilot");
  assert.equal(config.main, "worker/worker.js");
  assert.equal(config.no_bundle, true);
  assert.equal(config.vars.APP_RELEASE_VERSION, String(RELEASE_VERSION));
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "family-db",
    database_id: "12345678-1234-1234-1234-123456789abc",
    migrations_dir: "migrations"
  }]);
  assert.throws(() => instanceConfig("invalid", config.d1_databases[0]!.database_id, "family-pilot", "family-db"));
});

test("Windows dependency closure retains Wrangler's nested esbuild and omits Linux and developer tools", async () => {
  const lock = JSON.parse(await readFile(new URL("../../../package-lock.json", import.meta.url), "utf8")) as Lock;
  const selected = windowsWranglerPackages(lock);
  assert(selected.includes("node_modules/wrangler/node_modules/esbuild"));
  assert(selected.includes("node_modules/wrangler/node_modules/@esbuild/win32-x64"));
  assert(selected.includes("node_modules/@cloudflare/workerd-windows-64"));
  assert(!selected.some(name => /linux|typescript|tsx/.test(name)));
  assert(!selected.includes("node_modules/esbuild"));
});

test("ZIP preserves spaces, Unicode and bytes and refuses private files before publication", async context => {
  const root = await temporaryDirectory(context);
  await mkdir(path.join(root, "package"));
  await writeFile(path.join(root, "package/Start setup.cmd"), "@echo off\r\n");
  await writeFile(path.join(root, "package/заметки.txt"), "Комплект проверен\n");
  const files = await distributionFiles(path.join(root, "package"));
  writeZip(path.join(root, "package"), files, path.join(root, "release.zip"));
  writeZip(path.join(root, "package"), files, path.join(root, "repeat.zip"));
  assert.deepEqual(await readFile(path.join(root, "release.zip")), await readFile(path.join(root, "repeat.zip")));
  // Independent standard-library reader, available on the Linux verification host.
  if (process.platform !== "win32") {
    const result = spawnSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; " +
      "assert z.read('заметки.txt').decode() == 'Комплект проверен\\n'; assert z.read('Start setup.cmd') == b'@echo off\\r\\n'", path.join(root, "release.zip")],
    { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
  }
  await writeFile(path.join(root, "package/.env.local"), "PRIVATE=fixture");
  await assert.rejects(distributionFiles(path.join(root, "package")), /Forbidden/);
});
