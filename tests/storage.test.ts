import assert from "node:assert/strict";
import test from "node:test";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository, type CreateExpenseInput } from "../src/storage/D1FinanceRepository";
import type { SqlDatabase } from "../src/storage/SqlDatabase";

async function createTestRepository() {
  const context = await createMigratedLocalD1("storage-test");
  return { ...context, repository: new D1FinanceRepository(context.DB) };
}

async function seedMember(database: SqlDatabase, id: string, name: string, enabled = 1) {
  await database.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, ?)")
    .bind(id, name, enabled).execute();
}

function expenseInput(overrides: Partial<CreateExpenseInput> = {}): CreateExpenseInput {
  return {
    sourceActionKey: "message:100",
    amountRsd: 1200,
    categoryId: "groceries",
    spentOn: "2026-09-15",
    createdBy: "101",
    ...overrides
  };
}

test("returns only enabled members", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна", 1);
    await seedMember(context.DB, "102", "Борис", 0);
    assert.deepEqual(await context.repository.getEnabledMember("101"), { telegramUserId: "101", displayName: "Анна" });
    assert.equal(await context.repository.getEnabledMember("102"), null);
    assert.equal(await context.repository.getEnabledMember("999"), null);
  } finally {
    await context.dispose();
  }
});

test("returns the existing expense for a duplicate source action key", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    const sourceActionKey = "message:100";
    const originalAmountRsd = 1200;
    const first = await context.repository.createExpense(expenseInput({ sourceActionKey, amountRsd: originalAmountRsd }));
    const duplicate = await context.repository.createExpense(expenseInput({ sourceActionKey, amountRsd: 9999, categoryId: "transport" }));
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.expense.id, first.expense.id);
    assert.equal(duplicate.expense.amountRsd, originalAmountRsd);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) AS count FROM expenses").one<{ count: number }>())?.count, 1);
  } finally {
    await context.dispose();
  }
});

test("lists the latest ten expenses with author and category", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    for (let index = 1; index <= 11; index++)
      await context.repository.createExpense(expenseInput({ sourceActionKey: `message:${index}`, amountRsd: index, categoryId: "groceries", createdBy: "101" }));
    const history = await context.repository.getRecentExpenses();
    assert.equal(history.length, 10);
    assert.deepEqual(history.map(expense => expense.amountRsd), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    assert.equal(history[0]?.authorName, "Анна");
    assert.equal(history[0]?.categoryName, "Продукты");
  } finally {
    await context.dispose();
  }
});

test("updates editable expense fields", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    const created = (await context.repository.createExpense(expenseInput({
      amountRsd: 1200, categoryId: "groceries", spentOn: "2026-09-15", comment: "До редактирования"
    }))).expense;
    await context.repository.updateExpenseAmount(created.id, 2400);
    await context.repository.updateExpenseCategory(created.id, "transport");
    await context.repository.updateExpenseDate(created.id, "2026-09-16");
    const edited = await context.repository.updateExpenseComment(created.id, "Такси");
    assert(edited !== null);
    assert.equal(edited.amountRsd, 2400);
    assert.equal(edited.categoryId, "transport");
    assert.equal(edited.spentOn, "2026-09-16");
    assert.equal(edited.comment, "Такси");
  } finally {
    await context.dispose();
  }
});

test("preserves ownership and source action key while editing", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    const sourceActionKey = "message:100";
    const createdBy = "101";
    const created = (await context.repository.createExpense(expenseInput({
      sourceActionKey, createdBy, amountRsd: 1200, categoryId: "groceries", spentOn: "2026-09-15", comment: "До редактирования"
    }))).expense;
    await context.repository.updateExpenseAmount(created.id, 2400);
    await context.repository.updateExpenseCategory(created.id, "transport");
    await context.repository.updateExpenseDate(created.id, "2026-09-16");
    const edited = await context.repository.updateExpenseComment(created.id, "Такси");
    assert(edited !== null);
    assert.equal(edited.sourceActionKey, sourceActionKey);
    assert.equal(edited.createdBy, createdBy);
  } finally {
    await context.dispose();
  }
});

test("deletes an expense and reports that it no longer exists", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    const created = (await context.repository.createExpense(expenseInput())).expense;
    assert.equal(await context.repository.deleteExpense(created.id), true);
    assert.equal(await context.repository.deleteExpense(created.id), false);
    assert.equal(await context.repository.getExpenseById(created.id), null);
  } finally {
    await context.dispose();
  }
});

test("groups statistics by category across inclusive date boundaries", async () => {
  const context = await createTestRepository();
  try {
    await seedMember(context.DB, "101", "Анна");
    const rows: [string, number, CreateExpenseInput["categoryId"], string][] = [
      ["before", 9999, "other", "2026-08-31"],
      ["start", 1000, "groceries", "2026-09-01"],
      ["middle", 500, "transport", "2026-09-15"],
      ["end", 700, "groceries", "2026-09-30"],
      ["after", 9999, "other", "2026-10-01"]
    ];
    for (const [sourceActionKey, amountRsd, categoryId, spentOn] of rows)
      await context.repository.createExpense(expenseInput({ sourceActionKey, amountRsd, categoryId, spentOn }));
    await context.DB.prepare("UPDATE categories SET active = 0 WHERE id = ?").bind("groceries").execute();
    assert.deepEqual(await context.repository.getStatistics("2026-09-01", "2026-09-30"), {
      totalRsd: 2200,
      categoryTotals: [
        { categoryId: "groceries", categoryName: "Продукты", amountRsd: 1700 },
        { categoryId: "transport", categoryName: "Транспорт", amountRsd: 500 }
      ]
    });
  } finally {
    await context.dispose();
  }
});
