import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { instanceConfig } from "../tools/family-installer/package";
import { WRANGLER_VERSION } from "../tools/family-installer/release";
import { runWrangler } from "../tools/family-installer/wrangler";

// Developer acceptance check: only version/help commands, no login or cloud resources.
async function main() {
  assert(process.argv.length === 3, "Usage: npm run installer:verify-wrangler -- <unpacked-package-directory>");
  const packageDirectory = path.resolve(process.argv[2]!);
  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "Family installer check with spaces "));
  try {
    const configFile = path.join(workingDirectory, "wrangler.json");
    await writeFile(configFile, JSON.stringify(instanceConfig(
      "0".repeat(32),
      "00000000-0000-0000-0000-000000000000",
      "installer-offline-check",
      "installer-offline-check"
    )));
    const paths = {
      nodeExecutable: path.join(packageDirectory, "runtime/node.exe"),
      // Run the CLI directly so stopping Node does not leave Wrangler's launcher child running on Windows.
      wranglerScript: path.join(packageDirectory, "wrangler/node_modules/wrangler/wrangler-dist/cli.js"),
      workingDirectory,
      configFile
    };
    const version = await runWrangler(paths, { args: ["--version"], timeoutMs: 30000 });
    assert.equal(version.stdout.trim(), WRANGLER_VERSION, "Unexpected Wrangler version");
    console.log(`Wrangler ${WRANGLER_VERSION}: запуск из пакета работает.`);
    const help = await runWrangler(paths, { args: ["d1", "migrations", "apply", "--help"], timeoutMs: 30000 });
    assert(help.stdout.includes("--remote"), "Wrangler did not return the expected migration help");
    console.log("Справка D1 получена. Вход, миграции и обращения к Cloudflare не выполнялись.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Проверка запуска Wrangler не прошла.");
  process.exitCode = 1;
});
