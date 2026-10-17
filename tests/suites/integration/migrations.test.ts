import assert from "node:assert/strict";
import test from "node:test";
import { createMigrationFixture } from "../../infrastructure/migrationFixture";

test("Wrangler upgrades an existing database without changing expenses or members", async context => {
  const database = await createMigrationFixture(context);
  const memberId = "246";
  const memberName = "Анна";
  const amountRsd = 765;
  const categoryId = "groceries";
  const sourceActionKey = "expense:7650";
  const spentOn = "2026-10-01";
  const comment = "До обновления";
  const createdAt = "2026-10-01T08:00:00.000Z";
  const updatedAt = "2026-10-02T08:00:00.000Z";
  // Start with the schema used before category name keys and instance settings existed.
  await database.applyMigrations("0001_initial.sql", "0002_add_expense_categories.sql", "0003_add_communication_category.sql");
  await database.execute(`
    INSERT INTO members (telegram_user_id, display_name, enabled) VALUES ('${memberId}', '${memberName}', 1);
    INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, comment, created_by, created_at, updated_at)
    VALUES ('${sourceActionKey}', ${amountRsd}, '${categoryId}', '${spentOn}', '${comment}', '${memberId}', '${createdAt}', '${updatedAt}');`);
  // Upgrade the same persisted database through Wrangler's migration tracking.
  await database.applyMigrations("0004_category_name_keys.sql", "0005_instance_settings.sql");
  const expenses = await database.query("SELECT * FROM expenses");
  const members = await database.query("SELECT * FROM members");
  const categories = await database.query<{ id: string; name: string; name_key: string }>(
    "SELECT id, name, name_key FROM categories ORDER BY sort_order"
  );

  assert.deepEqual(expenses, [{
    id: 1,
    source_action_key: sourceActionKey,
    amount_rsd: amountRsd,
    category_id: categoryId,
    spent_on: spentOn,
    comment,
    created_by: memberId,
    created_at: createdAt,
    updated_at: updatedAt
  }]);
  assert.deepEqual(members, [{ telegram_user_id: memberId, display_name: memberName, enabled: 1 }]);
  assert.equal(categories.length, 19);
  assert.deepEqual(categories.slice(-4).map(({ id, name }) => ({ id, name })), [
    { id: "gifts", name: "Подарки" },
    { id: "lost-money", name: "Потерянные деньги" },
    { id: "subscriptions", name: "Подписки" },
    { id: "communication", name: "Связь" }
  ]);
  for (const category of categories)
    assert.equal(category.name_key, category.name.toLowerCase());
});
