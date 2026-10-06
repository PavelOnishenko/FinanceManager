import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "../src/config/categories";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";

test("keeps new expense categories aligned between configuration and D1", async () => {
  const expectedCategories = [
    { id: "gifts", name: "Подарки", aliases: ["подарки", "подарок"], sortOrder: 16 },
    { id: "lost-money", name: "Потерянные деньги", aliases: ["потерянные деньги", "потеряно"], sortOrder: 17 },
    { id: "subscriptions", name: "Подписки", aliases: ["подписки", "подписка", "сервисы", "сервис"], sortOrder: 18 },
    { id: "communication", name: "Связь", aliases: ["связь"], sortOrder: 19 }
  ];
  assert.deepEqual(categories.slice(-4), expectedCategories.map(({ sortOrder, ...category }) => category));

  const localD1 = await createMigratedLocalD1("new-categories-test");
  try {
    const rows = await localD1.DB.prepare(`
      SELECT id, name, sort_order AS sortOrder FROM categories
      WHERE id IN ('gifts', 'lost-money', 'subscriptions', 'communication') ORDER BY sort_order
    `).many<{ id: string; name: string; sortOrder: number }>();
    assert.deepEqual(rows, expectedCategories.map(({ aliases, ...category }) => category));
  } finally {
    await localD1.dispose();
  }
});
