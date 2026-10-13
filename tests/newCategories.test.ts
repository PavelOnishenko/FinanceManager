import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "./defaultCategories";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";

test("keeps new expense categories aligned between configuration and D1", async () => {
  const expectedCategories = [
    { id: "gifts", name: "Подарки", sortOrder: 16 },
    { id: "lost-money", name: "Потерянные деньги", sortOrder: 17 },
    { id: "subscriptions", name: "Подписки", sortOrder: 18 },
    { id: "communication", name: "Связь", sortOrder: 19 }
  ];
  assert.deepEqual(categories.slice(-4), expectedCategories.map(({ sortOrder, ...category }) => category));

  const localD1 = await createMigratedLocalD1("new-categories-test");
  try {
    const rows = await localD1.DB.prepare(`
      SELECT id, name, sort_order AS sortOrder FROM categories
      WHERE id IN ('gifts', 'lost-money', 'subscriptions', 'communication') ORDER BY sort_order
    `).many<{ id: string; name: string; sortOrder: number }>();
    assert.deepEqual(rows, expectedCategories);
  } finally {
    await localD1.dispose();
  }
});
