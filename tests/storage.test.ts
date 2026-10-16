import { expectRepositorySuccess } from "./repositoryAssertions";
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

test("returns only enabled members", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна", 1);
  await seedMember(context.DB, "102", "Борис", 0);
  assert.deepEqual(await context.repository.getEnabledMember("101"), { telegramUserId: "101", displayName: "Анна" });
  assert.equal(await context.repository.getEnabledMember("102"), null);
  assert.equal(await context.repository.getEnabledMember("999"), null);
});

test("returns the existing expense for a duplicate source action key", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  const sourceActionKey = "message:100";
  const originalAmountRsd = 1200;
  const input = { sourceActionKey, amountRsd: originalAmountRsd, categoryId: "groceries", spentOn: "2026-09-15", createdBy: "101" };
  const first = expectRepositorySuccess(await context.repository.createExpense(input));
  const duplicate = expectRepositorySuccess(await context.repository.createExpense({ ...input, amountRsd: 9999, categoryId: "transport" }));
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.expense.id, first.expense.id);
  assert.equal(duplicate.expense.amountRsd, originalAmountRsd);
  assert.equal((await context.DB.prepare("SELECT COUNT(*) AS count FROM expenses").one<{ count: number }>())?.count, 1);
});

test("lists the latest ten expenses with author and category", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  for (let index = 1; index <= 11; index++)
    expectRepositorySuccess(await context.repository.createExpense({
      sourceActionKey: `message:${index}`, amountRsd: index, categoryId: "groceries", spentOn: "2026-09-15", createdBy: "101" }));
  const history = await context.repository.getRecentExpenses();
  assert.equal(history.length, 10);
  assert.deepEqual(history.map(expense => expense.amountRsd), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(history[0]?.authorName, "Анна");
  assert.equal(history[0]?.categoryName, "Продукты");
});

test("period history includes both boundaries and archived categories, and refreshes pages after edits and deletions", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  await seedMember(context.DB, "102", "Борис");
  const range = { fromDate: "2026-01-01", toDate: "2026-01-31" };
  const expenses = [];
  for (let index = 0; index < 12; index++) {
    expenses.push(expectRepositorySuccess(await context.repository.createExpense({
      sourceActionKey: `period:${index}`, amountRsd: index + 1, categoryId: "groceries",
      spentOn: index === 0 ? range.fromDate : range.toDate, createdBy: index % 2 ? "101" : "102"
    })).expense);
  }
  for (const spentOn of ["2025-12-31", "2026-02-01"])
    expectRepositorySuccess(await context.repository.createExpense({
      sourceActionKey: spentOn, amountRsd: 999, categoryId: "transport", spentOn, createdBy: "101"
    }));
  expectRepositorySuccess(await context.repository.setCategoryActive("groceries", false));
  const first = await context.repository.getExpensesForRange(range, 0);
  assert.deepEqual(first.expenses.map(expense => expense.amountRsd), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(first.hasNext, true);
  const second = await context.repository.getExpensesForRange(range, 1);
  assert.deepEqual(second.expenses, [expenses[1], expenses[0]]);
  assert.equal(second.page, 1);
  assert.equal(second.hasNext, false);

  await context.repository.updateExpenseDate(expenses[0]!.id, "2026-02-01");
  await context.repository.deleteExpense(expenses[1]!.id);
  const refreshed = await context.repository.getExpensesForRange(range, 1);
  assert.equal(refreshed.page, 0);
  assert.equal(refreshed.expenses.length, 10);
  assert.equal(refreshed.hasNext, false);
  for (const expense of expenses.slice(2))
    await context.repository.deleteExpense(expense.id);
  assert.deepEqual(await context.repository.getExpensesForRange(range, 1), { expenses: [], page: 0, hasNext: false });
});

test("updates editable fields without changing ownership or the source action key", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  const created = expectRepositorySuccess(await context.repository.createExpense({
    sourceActionKey: "message:100", createdBy: "101", amountRsd: 1200, categoryId: "groceries", spentOn: "2026-09-15", comment: "До редактирования"
  })).expense;
  await context.repository.updateExpenseAmount(created.id, 2400);
  expectRepositorySuccess(await context.repository.updateExpenseCategory(created.id, "transport"));
  await context.repository.updateExpenseDate(created.id, "2026-09-16");
  const edited = await context.repository.updateExpenseComment(created.id, "Такси");
  assert(edited !== null);
  assert.equal(edited.amountRsd, 2400);
  assert.equal(edited.categoryId, "transport");
  assert.equal(edited.spentOn, "2026-09-16");
  assert.equal(edited.comment, "Такси");
  assert.equal(edited.createdBy, "101");
  assert.equal(edited.sourceActionKey, "message:100");
});

test("deletes an expense and reports that it no longer exists", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  const created = expectRepositorySuccess(await context.repository.createExpense({
    sourceActionKey: "message:100", amountRsd: 1200, categoryId: "groceries", spentOn: "2026-09-15", createdBy: "101"
  })).expense;
  assert.equal(await context.repository.deleteExpense(created.id), true);
  assert.equal(await context.repository.deleteExpense(created.id), false);
  assert.equal(await context.repository.getExpenseById(created.id), null);
});

test("groups statistics by category across inclusive date boundaries", async testContext => {
  const context = await createTestRepository();
  testContext.after(() => context.dispose());
  await seedMember(context.DB, "101", "Анна");
  const rows: [string, number, CreateExpenseInput["categoryId"], string][] = [
    ["before", 9999, "other", "2026-08-31"],
    ["start", 1000, "groceries", "2026-09-01"],
    ["middle", 500, "transport", "2026-09-15"],
    ["end", 700, "groceries", "2026-09-30"],
    ["after", 9999, "other", "2026-10-01"]
  ];
  for (const [sourceActionKey, amountRsd, categoryId, spentOn] of rows)
    expectRepositorySuccess(await context.repository.createExpense({ sourceActionKey, amountRsd, categoryId, spentOn, createdBy: "101" }));
  await context.DB.prepare("UPDATE categories SET active = 0 WHERE id = ?").bind("groceries").execute();
  assert.deepEqual(await context.repository.getStatistics("2026-09-01", "2026-09-30"), {
    totalRsd: 2200,
    categoryTotals: [
      { categoryId: "groceries", categoryName: "Продукты", amountRsd: 1700 },
      { categoryId: "transport", categoryName: "Транспорт", amountRsd: 500 }
    ]
  });
});
