import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TestContext } from "node:test";

// Use Wrangler's actual local migration tracking, with an isolated database per test.
export async function createMigrationFixture(context: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "finance-category-upgrade-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "wrangler.json"), JSON.stringify({
    name: "category-upgrade",
    compatibility_date: "2026-09-16",
    d1_databases: [{ binding: "DB", database_name: "category-upgrade", database_id: "00000000-0000-0000-0000-000000000001" }]
  }));
  const runWrangler = async (...args: string[]) => {
    const execution = promisify(execFile)(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args], {
      cwd: directory,
      timeout: 30_000,
      env: {
        ...process.env,
        CI: "true",
        WRANGLER_HIDE_BANNER: "true",
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: path.join(directory, "logs")
      }
    });
    execution.child.stdin?.end();
    return (await execution).stdout;
  };
  const applyMigrations = async (...names: string[]) => {
    for (const name of names)
      await cp(new URL(`../../migrations/${name}`, import.meta.url), path.join(directory, "migrations", name), { recursive: true });
    await runWrangler("d1", "migrations", "apply", "category-upgrade", "--local");
  };
  const execute = async (sql: string) => {
    await writeFile(path.join(directory, "seed.sql"), sql);
    await runWrangler("d1", "execute", "category-upgrade", "--local", "--file", "seed.sql");
  };
  const query = async <Row>(sql: string): Promise<Row[]> => {
    const [result] = JSON.parse(await runWrangler("d1", "execute", "category-upgrade", "--local", "--json", "--command", sql));
    return result.results;
  };
  return { applyMigrations, execute, query };
}
