import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "../src/config/categories";
import {
  ApplicationResultKind, checkAccess, createExpenseAfterCategorySelection, deleteExpense, editExpense, getExpenseDetails, getExpenseHistory,
  getPreviousMonthStatistics, getStatisticsForRange, processExpenseMessage
} from "../src/application/financeApplication";
import { getCalendarMonthRange, getDateInFinanceTimeZone, getPreviousCalendarMonthRange, isValidCalendarDate, shiftCalendarMonth } from "../src/application/dateRange";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import type { SqlDatabase } from "../src/storage/SqlDatabase";

let testDatabaseNumber = 0;

async function createApplicationTestContext() {
  const context = await createMigratedLocalD1(`application-test-${++testDatabaseNumber}`);
  return { ...context, repository: new D1FinanceRepository(context.DB) };
}

async function seedMember(database: SqlDatabase, telegramUserId: string, displayName: string, enabled: number) {
  await database.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, ?)")
    .bind(telegramUserId, displayName, enabled).execute();
}

test("checks access against enabled family members", async () => {
  const context = await createApplicationTestContext();
  try {
    const enabledUserId = "101";
    const disabledUserId = "102";
    const unknownUserId = "999";
    await seedMember(context.DB, enabledUserId, "Анна", 1);
    await seedMember(context.DB, disabledUserId, "Борис", 0);
    assert.deepEqual(await checkAccess(context.repository, enabledUserId), {
      kind: ApplicationResultKind.AccessAllowed, member: { telegramUserId: enabledUserId, displayName: "Анна" }
    });
    assert.deepEqual(await checkAccess(context.repository, disabledUserId), { kind: ApplicationResultKind.AccessDenied, telegramUserId: disabledUserId });
    assert.deepEqual(await checkAccess(context.repository, unknownUserId), { kind: ApplicationResultKind.AccessDenied, telegramUserId: unknownUserId });
  } finally {
    await context.dispose();
  }
});

test("creates an expense from a full message with the Belgrade local date", async () => {
  const context = await createApplicationTestContext();
  try {
    const telegramUserId = "201";
    const sourceUpdateId = 4100;
    const currentTime = new Date("2026-03-28T23:30:00.000Z");
    await seedMember(context.DB, telegramUserId, "Анна", 1);
    const result = await processExpenseMessage(context.repository, {
      telegramUserId, sourceUpdateId, text: "2490 продукты Lidl", currentTime
    });
    assert(result.kind === ApplicationResultKind.ExpenseSaved);
    assert.equal(result.created, true);
    assert.equal(result.expense.sourceActionKey, `expense:${sourceUpdateId}`);
    assert.equal(result.expense.amountRsd, 2490);
    assert.equal(result.expense.categoryId, "groceries");
    assert.equal(result.expense.comment, "Lidl");
    assert.equal(result.expense.spentOn, "2026-03-29");
    assert.equal(result.expense.createdBy, telegramUserId);
  } finally {
    await context.dispose();
  }
});

test("prepares every category after an amount-only message without creating a draft", async () => {
  const context = await createApplicationTestContext();
  try {
    const telegramUserId = "301";
    const sourceUpdateId = 5100;
    const amountRsd = 2490;
    await seedMember(context.DB, telegramUserId, "Анна", 1);
    const result = await processExpenseMessage(context.repository, {
      telegramUserId, sourceUpdateId, text: amountRsd.toString(), currentTime: new Date("2026-09-18T10:00:00.000Z")
    });
    assert.deepEqual(result, {
      kind: ApplicationResultKind.CategorySelection, sourceUpdateId, amountRsd,
      categories: categories.map(({ id, name }) => ({ id, name }))
    });
    assert.deepEqual(await context.repository.getRecentExpenses(), []);
  } finally {
    await context.dispose();
  }
});

test("creates only one expense when category selection is delivered twice", async () => {
  const context = await createApplicationTestContext();
  try {
    const telegramUserId = "401";
    const sourceUpdateId = 6100;
    const amountRsd = 700;
    const currentTime = new Date("2026-09-18T10:00:00.000Z");
    await seedMember(context.DB, telegramUserId, "Анна", 1);
    const first = await createExpenseAfterCategorySelection(context.repository, {
      telegramUserId, sourceUpdateId, amountRsd, categoryId: "transport", currentTime
    });
    const duplicate = await createExpenseAfterCategorySelection(context.repository, {
      telegramUserId, sourceUpdateId, amountRsd, categoryId: "groceries", currentTime
    });
    assert(first.kind === ApplicationResultKind.ExpenseSaved);
    assert(duplicate.kind === ApplicationResultKind.ExpenseSaved);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.expense.id, first.expense.id);
    assert.equal(duplicate.expense.categoryId, "transport");
    assert.equal((await context.repository.getRecentExpenses()).length, 1);
  } finally {
    await context.dispose();
  }
});

test("returns shared history and expense details to another enabled member", async () => {
  const context = await createApplicationTestContext();
  try {
    const authorId = "501";
    const viewerId = "502";
    await seedMember(context.DB, authorId, "Анна", 1);
    await seedMember(context.DB, viewerId, "Борис", 1);
    const saved = await processExpenseMessage(context.repository, {
      telegramUserId: authorId, sourceUpdateId: 7100, text: "800 рестораны Ужин", currentTime: new Date("2026-09-18T10:00:00.000Z")
    });
    assert(saved.kind === ApplicationResultKind.ExpenseSaved);
    const history = await getExpenseHistory(context.repository, viewerId);
    const details = await getExpenseDetails(context.repository, viewerId, saved.expense.id);
    assert(history.kind === ApplicationResultKind.ExpenseHistory);
    assert.deepEqual(history.expenses.map(expense => expense.id), [saved.expense.id]);
    assert.deepEqual(details, { kind: ApplicationResultKind.ExpenseDetails, expense: saved.expense });
  } finally {
    await context.dispose();
  }
});

test("edits every mutable field and deletes a shared expense", async () => {
  const context = await createApplicationTestContext();
  try {
    const authorId = "601";
    const editorId = "602";
    await seedMember(context.DB, authorId, "Анна", 1);
    await seedMember(context.DB, editorId, "Борис", 1);
    const saved = await processExpenseMessage(context.repository, {
      telegramUserId: authorId, sourceUpdateId: 8100, text: "1200 продукты Старое", currentTime: new Date("2026-09-18T10:00:00.000Z")
    });
    assert(saved.kind === ApplicationResultKind.ExpenseSaved);
    const expenseId = saved.expense.id;
    await editExpense(context.repository, editorId, expenseId, { field: "amount", amountRsd: 2400 });
    await editExpense(context.repository, editorId, expenseId, { field: "category", categoryId: "transport" });
    await editExpense(context.repository, editorId, expenseId, { field: "date", spentOn: "2026-09-16" });
    const edited = await editExpense(context.repository, editorId, expenseId, { field: "comment", comment: "Такси" });
    assert(edited.kind === ApplicationResultKind.ExpenseUpdated);
    assert.equal(edited.expense.amountRsd, 2400);
    assert.equal(edited.expense.categoryId, "transport");
    assert.equal(edited.expense.spentOn, "2026-09-16");
    assert.equal(edited.expense.comment, "Такси");
    assert.equal(edited.expense.createdBy, authorId);
    assert.equal(edited.expense.sourceActionKey, "expense:8100");
    assert.deepEqual(await deleteExpense(context.repository, editorId, expenseId), { kind: ApplicationResultKind.ExpenseDeleted, expenseId });
    assert.deepEqual(await getExpenseDetails(context.repository, authorId, expenseId), { kind: ApplicationResultKind.ExpenseNotFound, expenseId });
  } finally {
    await context.dispose();
  }
});

test("calculates the previous Belgrade calendar month", async () => {
  const context = await createApplicationTestContext();
  try {
    const telegramUserId = "701";
    await seedMember(context.DB, telegramUserId, "Анна", 1);
    await context.repository.createExpense({
      sourceActionKey: "previous-start", amountRsd: 1000, categoryId: "groceries", spentOn: "2026-02-01", createdBy: telegramUserId
    });
    await context.repository.createExpense({
      sourceActionKey: "previous-end", amountRsd: 500, categoryId: "transport", spentOn: "2026-02-28", createdBy: telegramUserId
    });
    await context.repository.createExpense({
      sourceActionKey: "current", amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: telegramUserId
    });
    const result = await getPreviousMonthStatistics(context.repository, telegramUserId, new Date("2026-03-15T12:00:00.000Z"));
    assert.deepEqual(result, {
      kind: ApplicationResultKind.ExpenseStatistics, range: { fromDate: "2026-02-01", toDate: "2026-02-28" },
      statistics: {
        totalRsd: 1500,
        categoryTotals: [
          { categoryId: "groceries", categoryName: "Продукты", amountRsd: 1000 },
          { categoryId: "transport", categoryName: "Транспорт", amountRsd: 500 }
        ]
      }
    });
  } finally {
    await context.dispose();
  }
});

test("uses inclusive custom date ranges and rejects invalid calendar ranges", async () => {
  const context = await createApplicationTestContext();
  try {
    const telegramUserId = "801";
    await seedMember(context.DB, telegramUserId, "Анна", 1);
    await context.repository.createExpense({
      sourceActionKey: "range-start", amountRsd: 400, categoryId: "groceries", spentOn: "2026-09-10", createdBy: telegramUserId
    });
    await context.repository.createExpense({
      sourceActionKey: "range-end", amountRsd: 600, categoryId: "transport", spentOn: "2026-09-12", createdBy: telegramUserId
    });
    const result = await getStatisticsForRange(context.repository, telegramUserId, { fromDate: "2026-09-10", toDate: "2026-09-12" });
    assert(result.kind === ApplicationResultKind.ExpenseStatistics);
    assert.equal(result.statistics.totalRsd, 1000);
    assert.equal((await getStatisticsForRange(context.repository, telegramUserId, { fromDate: "2026-09-31", toDate: "2026-10-01" })).kind, ApplicationResultKind.InvalidInput);
    assert.equal((await getStatisticsForRange(context.repository, telegramUserId, { fromDate: "2026-09-12", toDate: "2026-09-10" })).kind, ApplicationResultKind.InvalidInput);
  } finally {
    await context.dispose();
  }
});

// todo move time tests to diff suite?
test("handles Belgrade dates and leap-year month boundaries", () => {
  assert.equal(getDateInFinanceTimeZone(new Date("2026-01-01T00:30:00.000Z")), "2026-01-01");
  assert.deepEqual(getPreviousCalendarMonthRange(new Date("2026-01-15T12:00:00.000Z")), { fromDate: "2025-12-01", toDate: "2025-12-31" });
  assert.deepEqual(getPreviousCalendarMonthRange(new Date("2024-03-15T12:00:00.000Z")), { fromDate: "2024-02-01", toDate: "2024-02-29" });
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("2026-02-29"), false);
});

test("statistics month navigation stops at 2026", () => {
  assert.equal(getCalendarMonthRange("2025-12"), undefined);
  assert.equal(getCalendarMonthRange("0000-01"), undefined);
  assert.deepEqual(getCalendarMonthRange("2026-01"), { fromDate: "2026-01-01", toDate: "2026-01-31" });
  assert.equal(shiftCalendarMonth("2026-01", -1), undefined);
  assert.equal(shiftCalendarMonth("2025-12", 1), undefined);
  assert.equal(shiftCalendarMonth("2026-01", 1), "2026-02");
});
