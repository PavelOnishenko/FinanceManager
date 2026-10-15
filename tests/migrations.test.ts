import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("Wrangler upgrades existing data and preserves customer settings when migrations are reapplied", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "finance-category-upgrade-"));
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
    name: "category-upgrade", compatibility_date: "2026-09-16",
    d1_databases: [{ binding: "DB", database_name: "category-upgrade", database_id: "00000000-0000-0000-0000-000000000001" }]
  }));
  for (const migration of ["0001_initial.sql", "0002_add_expense_categories.sql", "0003_add_communication_category.sql"])
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
  await runWrangler("d1", "migrations", "apply", "category-upgrade", "--local");
  await writeFile(path.join(directory, "seed.sql"), `
    INSERT INTO members (telegram_user_id, display_name, enabled) VALUES ('${memberId}', '${memberName}', 1);
    INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, comment, created_by, created_at, updated_at)
    VALUES ('${sourceActionKey}', ${amountRsd}, '${categoryId}', '${spentOn}', '${comment}', '${memberId}', '${createdAt}', '${updatedAt}');`);
  await runWrangler("d1", "execute", "category-upgrade", "--local", "--file", "seed.sql");
  for (const migration of ["0004_category_name_keys.sql", "0005_instance_settings.sql"]) {
    await cp(new URL(`../migrations/${migration}`, import.meta.url), path.join(directory, "migrations", migration));
    await runWrangler("d1", "migrations", "apply", "category-upgrade", "--local");
  }
  assert.match(await runWrangler("d1", "migrations", "apply", "category-upgrade", "--local"), /No migrations to apply/);
  const [expenses, members, migrations, categories, settings] = JSON.parse(await runWrangler("d1", "execute", "category-upgrade", "--local", "--json", "--command", `
    SELECT * FROM expenses;
    SELECT * FROM members;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT id, name, name_key FROM categories ORDER BY sort_order;
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
  assert.equal(categories.results.length, 19);
  assert.deepEqual(categories.results.slice(-4).map(({ id, name }: { id: string; name: string }) => ({ id, name })), [
    { id: "gifts", name: "Подарки" }, { id: "lost-money", name: "Потерянные деньги" },
    { id: "subscriptions", name: "Подписки" }, { id: "communication", name: "Связь" }
  ]);
  for (const category of categories.results)
    assert.equal(category.name_key, category.name.toLowerCase());

  const displayCurrency = "EUR";
  const financeTimeZone = "America/New_York";
  await writeFile(path.join(directory, "settings.sql"), `
    UPDATE instance_settings SET display_currency = '${displayCurrency}', finance_time_zone = '${financeTimeZone}' WHERE id = 1;`);
  await runWrangler("d1", "execute", "category-upgrade", "--local", "--file", "settings.sql");
  assert.match(await runWrangler("d1", "migrations", "apply", "category-upgrade", "--local"), /No migrations to apply/);
  assert.deepEqual(JSON.parse(await runWrangler("d1", "execute", "category-upgrade", "--local", "--json", "--command",
    "SELECT * FROM instance_settings;"))[0].results, [{ id: 1, display_currency: displayCurrency, finance_time_zone: financeTimeZone }]);
});
