import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("Wrangler settings migration upgrades once without changing expenses or members", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "finance-settings-upgrade-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const memberId = "246";
  const memberName = "Анна";
  const amountRsd = 765;
  const categoryId = "groceries";
  const sourceActionKey = "expense:7650";
  const spentOn = "2026-10-01";
  const comment = "До обновления";
  const createdAt = "2026-10-01T08:00:00.000Z";
  const updatedAt = "2026-10-02T08:00:00.000Z";
  await writeFile(path.join(directory, "wrangler.json"), JSON.stringify({
    name: "settings-upgrade", compatibility_date: "2026-09-16",
    d1_databases: [{ binding: "DB", database_name: "settings-upgrade", database_id: "00000000-0000-0000-0000-000000000001" }]
  }));
  for (const migration of ["0001_initial.sql", "0002_add_expense_categories.sql", "0003_add_communication_category.sql", "0004_category_name_keys.sql"])
    await cp(new URL(`../migrations/${migration}`, import.meta.url), path.join(directory, "migrations", migration), { recursive: true });
  const runWrangler = async (...args: string[]) => {
    const execution = promisify(execFile)(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args], {
      cwd: directory, timeout: 30_000,
      env: {
        ...process.env, CI: "true", WRANGLER_HIDE_BANNER: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(directory, "logs")
      }
    });
    execution.child.stdin?.end();
    return (await execution).stdout;
  };
  await runWrangler("d1", "migrations", "apply", "settings-upgrade", "--local");
  await writeFile(path.join(directory, "seed.sql"), `
    INSERT INTO members (telegram_user_id, display_name, enabled) VALUES ('${memberId}', '${memberName}', 1);
    INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, comment, created_by, created_at, updated_at)
    VALUES ('${sourceActionKey}', ${amountRsd}, '${categoryId}', '${spentOn}', '${comment}', '${memberId}', '${createdAt}', '${updatedAt}');`);
  await runWrangler("d1", "execute", "settings-upgrade", "--local", "--file", "seed.sql");
  await cp(new URL("../migrations/0005_instance_settings.sql", import.meta.url), path.join(directory, "migrations/0005_instance_settings.sql"));
  await runWrangler("d1", "migrations", "apply", "settings-upgrade", "--local");
  assert.match(await runWrangler("d1", "migrations", "apply", "settings-upgrade", "--local"), /No migrations to apply/);
  const [expenses, members, migrations, settings] = JSON.parse(await runWrangler("d1", "execute", "settings-upgrade", "--local", "--json", "--command", `
    SELECT * FROM expenses;
    SELECT * FROM members;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT * FROM instance_settings;`));
  assert.deepEqual(expenses.results, [{
    id: 1, source_action_key: sourceActionKey, amount_rsd: amountRsd, category_id: categoryId, spent_on: spentOn, comment,
    created_by: memberId, created_at: createdAt, updated_at: updatedAt
  }]);
  assert.deepEqual(members.results, [{ telegram_user_id: memberId, display_name: memberName, enabled: 1 }]);
  assert.deepEqual(migrations.results.map((row: { name: string }) => row.name), [
    "0001_initial.sql", "0002_add_expense_categories.sql", "0003_add_communication_category.sql", "0004_category_name_keys.sql", "0005_instance_settings.sql"
  ]);
  assert.deepEqual(settings.results, [{ id: 1, display_currency: "RSD", finance_time_zone: "Europe/Belgrade" }]);
});

test("reapplying migrations preserves the customer's chosen currency and timezone", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "finance-settings-preserve-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const displayCurrency = "EUR";
  const financeTimeZone = "America/New_York";
  await writeFile(path.join(directory, "wrangler.json"), JSON.stringify({
    name: "settings-preserve", compatibility_date: "2026-09-16",
    d1_databases: [{ binding: "DB", database_name: "settings-preserve", database_id: "00000000-0000-0000-0000-000000000001" }]
  }));
  await cp(new URL("../migrations/", import.meta.url), path.join(directory, "migrations"), { recursive: true });
  const runWrangler = async (...args: string[]) => {
    const execution = promisify(execFile)(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args], {
      cwd: directory, timeout: 30_000,
      env: {
        ...process.env, CI: "true", WRANGLER_HIDE_BANNER: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(directory, "logs")
      }
    });
    execution.child.stdin?.end();
    return (await execution).stdout;
  };
  await runWrangler("d1", "migrations", "apply", "settings-preserve", "--local");
  assert.deepEqual(JSON.parse(await runWrangler("d1", "execute", "settings-preserve", "--local", "--json", "--command",
    "SELECT * FROM instance_settings;"))[0].results, [{ id: 1, display_currency: "RSD", finance_time_zone: "Europe/Belgrade" }]);
  await writeFile(path.join(directory, "settings.sql"), `
    UPDATE instance_settings SET display_currency = '${displayCurrency}', finance_time_zone = '${financeTimeZone}' WHERE id = 1;`);
  await runWrangler("d1", "execute", "settings-preserve", "--local", "--file", "settings.sql");
  assert.match(await runWrangler("d1", "migrations", "apply", "settings-preserve", "--local"), /No migrations to apply/);
  assert.deepEqual(JSON.parse(await runWrangler("d1", "execute", "settings-preserve", "--local", "--json", "--command",
    "SELECT * FROM instance_settings;"))[0].results, [{ id: 1, display_currency: displayCurrency, finance_time_zone: financeTimeZone }]);
});
